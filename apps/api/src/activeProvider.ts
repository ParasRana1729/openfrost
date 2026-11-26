import {
  FakeProvider,
  GeminiProvider,
  OpenAIProvider,
  OpenRouterProvider,
  TokenFactoryProvider,
  PROJECT_FILE_INVENTORY_HEADING,
  RECENT_UPDATES_HEADING,
  type LlmProvider,
  type ProviderStepRequest,
  type ProviderStepResult,
} from '@openfrost/agent';
import { providerIdSchema, type ProviderId } from '@openfrost/domain';
import {
  providerKeyExists,
  readProviderKey,
  type Store,
} from '@openfrost/db';
import type { ApiConfig } from './config.js';
import {
  fakeProjectUpdateScript,
  fakeResearchScript,
  fakeWeeklyPlanScript,
} from './fakeProviderScript.js';

export const ACTIVE_PROVIDER_KEY = 'provider.active';
export const providerModelKey = (provider: ProviderId): string => `provider.model.${provider}`;

/** Maps a stored `appState` value to a valid `ProviderId`, defaulting to `'openai'`. */
export function parseStoredProvider(value: string | null | undefined): ProviderId {
  const parsed = providerIdSchema.safeParse(value);
  return parsed.success ? parsed.data : 'openai';
}

/** Resolves the configured default model for one built-in provider. */
export function defaultModelForProvider(config: ApiConfig, provider: ProviderId): string {
  switch (provider) {
    case 'openai':
      return config.openaiModel;
    case 'gemini':
      return config.geminiModel;
    case 'openrouter':
      return config.openrouterModel;
    case 'tokenfactory':
      return config.tokenfactoryModel;
  }
}

export interface ActiveProviderDeps {
  config: ApiConfig;
  store: Store;
}

/**
 * The provider the executor actually talks to. Resolution order per step:
 * the `OPENFROST_PROVIDER=fake` dev hook wins; otherwise the owner's active
 * provider from Settings (appState) with its configured model. Adapters are
 * cached per provider+model and decrypted keys per provider; key routes
 * invalidate the key cache so saving a key takes effect without a restart.
 */
export class ActiveProvider implements LlmProvider {
  readonly #deps: ActiveProviderDeps;
  readonly #adapters = new Map<string, LlmProvider>();
  readonly #keys = new Map<ProviderId, string | null>();
  /** Scripted fake run in progress; a new run (step 1) starts a new script. */
  #fake: FakeProvider | null = null;

  constructor(deps: ActiveProviderDeps) {
    this.#deps = deps;
  }

  get name(): string {
    if (this.#isFakeHook()) {
      return 'fake';
    }
    return this.#activeProvider();
  }

  /** Which provider the next run would use, plus its effective model. */
  current(): { provider: ProviderId; model: string } {
    const provider = this.#activeProvider();
    const override = this.#deps.store.state.getValue(providerModelKey(provider));
    const trimmed = override?.trim() ?? '';
    const model =
      trimmed.length > 0 ? trimmed : defaultModelForProvider(this.#deps.config, provider);
    return { provider, model };
  }

  /** Clears the memoized key for one provider (after save/remove). */
  invalidateKey(provider: ProviderId): void {
    this.#keys.delete(provider);
  }

  /** Non-empty memoized provider keys for log redaction; never returned directly. */
  knownSecrets(): string[] {
    const secrets: string[] = [];
    for (const key of this.#keys.values()) {
      if (key && key.trim().length > 0) {
        secrets.push(key);
      }
    }
    return secrets;
  }

  async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
    if (this.#isFakeHook()) {
      // One fresh scripted run per agent run; the kind follows the task's
      // first user message (weekly plans carry the recent-updates heading,
      // project updates the granted-file inventory).
      if (request.step === 1 || this.#fake === null) {
        const hasHeading = (heading: string): boolean =>
          request.messages.some(
            (message) =>
              message.role === 'user' && message.content.includes(heading),
          );
        const script = hasHeading(RECENT_UPDATES_HEADING)
          ? fakeWeeklyPlanScript()
          : hasHeading(PROJECT_FILE_INVENTORY_HEADING)
            ? fakeProjectUpdateScript()
            : fakeResearchScript();
        this.#fake = new FakeProvider(script);
      }
      return this.#fake.step(request);
    }
    const { provider, model } = this.current();
    const adapter = this.#adapterFor(provider, model);
    return adapter.step(request);
  }

  #isFakeHook(): boolean {
    return this.#deps.config.provider === 'fake';
  }

  #activeProvider(): ProviderId {
    return parseStoredProvider(this.#deps.store.state.getValue(ACTIVE_PROVIDER_KEY));
  }

  #adapterFor(provider: ProviderId, model: string): LlmProvider {
    // Keyed by provider AND model: a saved model override takes effect on the
    // next run without a restart, instead of reusing a stale adapter.
    const cacheKey = `${provider}:${model}`;
    const cached = this.#adapters.get(cacheKey);
    if (cached) {
      return cached;
    }
    let adapter: LlmProvider;
    switch (provider) {
      case 'gemini':
        adapter = new GeminiProvider({ model, getApiKey: () => this.#key(provider) });
        break;
      case 'openrouter':
        adapter = new OpenRouterProvider({
          model,
          maxOutputTokens: this.#deps.config.openrouterMaxTokens,
          getApiKey: () => this.#key(provider),
        });
        break;
      case 'tokenfactory':
        adapter = new TokenFactoryProvider({
          model,
          maxOutputTokens: this.#deps.config.tokenfactoryMaxTokens,
          getApiKey: () => this.#key(provider),
        });
        break;
      case 'openai':
        adapter = new OpenAIProvider({ model, getApiKey: () => this.#key(provider) });
        break;
    }
    this.#adapters.set(cacheKey, adapter);
    return adapter;
  }

  async #key(provider: ProviderId): Promise<string | null> {
    const cached = this.#keys.get(provider);
    if (cached !== undefined) {
      return cached;
    }
    const key = providerKeyExists(this.#deps.config.homeDir, provider)
      ? await readProviderKey(this.#deps.config.homeDir, provider)
      : null;
    this.#keys.set(provider, key);
    return key;
  }
}

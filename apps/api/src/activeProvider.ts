import {
  FakeProvider,
  GeminiProvider,
  OpenAIProvider,
  OpenRouterProvider,
  PROJECT_FILE_INVENTORY_HEADING,
  type LlmProvider,
  type ProviderStepRequest,
  type ProviderStepResult,
} from '@openfrost/agent';
import type { ProviderId } from '@openfrost/domain';
import {
  providerKeyExists,
  readProviderKey,
  type Store,
} from '@openfrost/db';
import type { ApiConfig } from './config.js';
import { fakeProjectUpdateScript, fakeResearchScript } from './fakeProviderScript.js';

const ACTIVE_PROVIDER_KEY = 'provider.active';
const modelKey = (provider: ProviderId): string => `provider.model.${provider}`;

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
    const override = this.#deps.store.state.getValue(modelKey(provider));
    const model =
      override ??
      (provider === 'gemini'
        ? this.#deps.config.geminiModel
        : provider === 'openrouter'
          ? this.#deps.config.openrouterModel
          : this.#deps.config.openaiModel);
    return { provider, model };
  }

  /** Clears the memoized key for one provider (after save/remove). */
  invalidateKey(provider: ProviderId): void {
    this.#keys.delete(provider);
  }

  async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
    if (this.#isFakeHook()) {
      // One fresh scripted run per agent run; the kind follows the task's
      // first user message (project updates carry the granted-file inventory).
      if (request.step === 1 || this.#fake === null) {
        const script = request.messages.some(
          (message) =>
            message.role === 'user' &&
            message.content.includes(PROJECT_FILE_INVENTORY_HEADING),
        )
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
    const value = this.#deps.store.state.getValue(ACTIVE_PROVIDER_KEY);
    return value === 'gemini' || value === 'openrouter' ? value : 'openai';
  }

  #adapterFor(provider: ProviderId, model: string): LlmProvider {
    // Keyed by provider AND model: a saved model override takes effect on the
    // next run without a restart, instead of reusing a stale adapter.
    const cacheKey = `${provider}:${model}`;
    const cached = this.#adapters.get(cacheKey);
    if (cached) {
      return cached;
    }
    const adapter =
      provider === 'gemini'
        ? new GeminiProvider({ model, getApiKey: () => this.#key(provider) })
        : provider === 'openrouter'
          ? new OpenRouterProvider({ model, getApiKey: () => this.#key(provider) })
          : new OpenAIProvider({ model, getApiKey: () => this.#key(provider) });
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

export { ACTIVE_PROVIDER_KEY, modelKey };

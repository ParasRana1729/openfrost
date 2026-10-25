import {
  FakeProvider,
  GeminiProvider,
  OpenAIProvider,
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
import { fakeResearchScript } from './fakeProviderScript.js';

const ACTIVE_PROVIDER_KEY = 'provider.active';
const modelKey = (provider: ProviderId): string => `provider.model.${provider}`;

export interface ActiveProviderDeps {
  config: ApiConfig;
  store: Store;
}

/**
 * The provider the executor actually talks to. Resolution order per step:
 * the `OPENFROST_PROVIDER=fake` dev hook wins; otherwise the owner's active
 * provider from Settings (appState) with its configured model. Adapters and
 * decrypted keys are cached per provider; key routes invalidate the cache so
 * saving a key takes effect without a restart.
 */
export class ActiveProvider implements LlmProvider {
  readonly #deps: ActiveProviderDeps;
  readonly #adapters = new Map<ProviderId, LlmProvider>();
  readonly #keys = new Map<ProviderId, string | null>();
  readonly #fake: FakeProvider;

  constructor(deps: ActiveProviderDeps) {
    this.#deps = deps;
    this.#fake = new FakeProvider(fakeResearchScript());
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
      override ?? (provider === 'gemini'
        ? this.#deps.config.geminiModel
        : this.#deps.config.openaiModel);
    return { provider, model };
  }

  /** Clears the memoized key for one provider (after save/remove). */
  invalidateKey(provider: ProviderId): void {
    this.#keys.delete(provider);
  }

  async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
    if (this.#isFakeHook()) {
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
    return this.#deps.store.state.getValue(ACTIVE_PROVIDER_KEY) === 'gemini'
      ? 'gemini'
      : 'openai';
  }

  #adapterFor(provider: ProviderId, model: string): LlmProvider {
    const cached = this.#adapters.get(provider);
    if (cached) {
      return cached;
    }
    const adapter =
      provider === 'gemini'
        ? new GeminiProvider({ model, getApiKey: () => this.#key(provider) })
        : new OpenAIProvider({ model, getApiKey: () => this.#key(provider) });
    this.#adapters.set(provider, adapter);
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

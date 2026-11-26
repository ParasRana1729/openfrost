import {
  chatErrorDetail,
  parseChatCompletionResponse,
  postChatCompletion,
  toChatMessages,
  toChatTools,
} from './chatCompletions.js';
import {
  ProviderError,
  ProviderMissingError,
  type LlmProvider,
  type ProviderStepRequest,
  type ProviderStepResult,
} from './provider.js';

export const TOKENFACTORY_CHAT_URL =
  'https://developer.amd.com.cn/radeon/api/v1/chat/completions';

export interface TokenFactoryProviderOptions {
  model: string;
  /** Resolves the DPAPI-protected key per call; null when unconfigured. */
  getApiKey: () => Promise<string | null>;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

/**
 * AMD Radeon Token Factory adapter (`developer.amd.com.cn/radeon/tokenfactory`)
 * over its OpenAI-compatible chat completions API. Token Factory does not
 * expose a provider-hosted web search plugin, so web-grounded runs report that
 * hosted search was skipped and rely on startingUrls + fetch_page. The API key
 * is sent only in the Authorization header and never appears in logs or errors.
 */
export class TokenFactoryProvider implements LlmProvider {
  readonly name = 'tokenfactory';

  readonly #model: string;
  readonly #getApiKey: () => Promise<string | null>;
  readonly #maxOutputTokens: number;
  readonly #fetchImpl: typeof fetch;

  constructor(options: TokenFactoryProviderOptions) {
    this.#model = options.model;
    this.#getApiKey = options.getApiKey;
    this.#maxOutputTokens = options.maxOutputTokens ?? 8_192;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
    const apiKey = await this.#getApiKey();
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ProviderMissingError(
        'No AMD Token Factory key is configured. Store one in Settings to enable model-backed runs.',
      );
    }

    const body: Record<string, unknown> = {
      model: this.#model,
      messages: toChatMessages(request.messages),
      max_tokens: this.#maxOutputTokens,
      ...(request.tools.length > 0 ? { tools: toChatTools(request.tools) } : {}),
    };

    const response = await postChatCompletion({
      fetchImpl: this.#fetchImpl,
      url: TOKENFACTORY_CHAT_URL,
      apiKey,
      providerLabel: 'AMD Token Factory',
      body,
      signal: request.signal,
    });

    if (!response.ok) {
      const detail = await chatErrorDetail(response, apiKey);
      if (response.status === 429 || response.status === 402) {
        throw new ProviderError(
          `AMD Token Factory request failed with HTTP ${response.status}: ${detail} Check your daily Token Factory quota or switch providers in Settings.`,
        );
      }
      throw new ProviderError(
        `AMD Token Factory request failed with HTTP ${response.status}: ${detail}`,
      );
    }

    const webSearchSkippedReason = request.webSearch
      ? 'AMD Token Factory does not offer hosted web search; only startingUrls and fetch_page were used.'
      : undefined;

    return parseChatCompletionResponse({
      response,
      providerLabel: 'AMD Token Factory',
      maxOutputTokens: this.#maxOutputTokens,
      ...(webSearchSkippedReason ? { webSearchSkippedReason } : {}),
    });
  }
}

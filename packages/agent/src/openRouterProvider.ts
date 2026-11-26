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

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterProviderOptions {
  model: string;
  /** Resolves the DPAPI-protected key per call; null when unconfigured. */
  getApiKey: () => Promise<string | null>;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

/**
 * OpenRouter adapter over the OpenAI-compatible chat completions API. Hosted
 * web search is the `web` plugin; its `url_citation` annotations surface as
 * citations and search counts, mirroring the other adapters' shape. The API
 * key is sent only in the Authorization header and never appears in logs or
 * errors. Requests transit OpenRouter to the model's upstream provider.
 */
export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter';

  readonly #model: string;
  readonly #getApiKey: () => Promise<string | null>;
  readonly #maxOutputTokens: number;
  readonly #fetchImpl: typeof fetch;

  constructor(options: OpenRouterProviderOptions) {
    this.#model = options.model;
    this.#getApiKey = options.getApiKey;
    this.#maxOutputTokens = options.maxOutputTokens ?? 8_192;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
    const apiKey = await this.#getApiKey();
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ProviderMissingError(
        'No OpenRouter key is configured. Store one in Settings to enable model-backed runs.',
      );
    }

    // The hosted `web` plugin bills per executed search even on free models,
    // so on a creditless account a request carrying it fails with HTTP 402;
    // when that happens we retry once without `plugins` so startingUrls +
    // fetch_page can still complete the brief.
    const baseBody: Record<string, unknown> = {
      model: this.#model,
      messages: toChatMessages(request.messages),
      tools: toChatTools(request.tools),
      max_tokens: this.#maxOutputTokens,
    };

    const post = (body: Record<string, unknown>): Promise<Response> =>
      postChatCompletion({
        fetchImpl: this.#fetchImpl,
        url: OPENROUTER_CHAT_URL,
        apiKey,
        providerLabel: 'OpenRouter',
        body,
        signal: request.signal,
      });

    let webSearchSkippedReason: string | undefined;
    let response = await post(
      request.webSearch ? { ...baseBody, plugins: [{ id: 'web' }] } : baseBody,
    );

    if (response.status === 402 && request.webSearch) {
      void response.body?.cancel?.().catch(() => {});
      webSearchSkippedReason =
        'Hosted web search was skipped due to OpenRouter HTTP 402; only startingUrls and fetch_page were used.';
      response = await post(baseBody);
    }

    if (!response.ok) {
      const detail = await chatErrorDetail(response, apiKey);
      if (response.status === 402) {
        throw new ProviderError(
          `OpenRouter request failed with HTTP 402: ${detail} Switch to a :free model such as openrouter/free in Settings, or add OpenRouter credits.`,
        );
      }
      throw new ProviderError(
        `OpenRouter request failed with HTTP ${response.status}: ${detail}`,
      );
    }

    return parseChatCompletionResponse({
      response,
      providerLabel: 'OpenRouter',
      maxOutputTokens: this.#maxOutputTokens,
      ...(webSearchSkippedReason ? { webSearchSkippedReason } : {}),
    });
  }
}

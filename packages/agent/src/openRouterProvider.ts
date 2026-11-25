import {
  ProviderError,
  ProviderMissingError,
  redactSecret,
  type LlmProvider,
  type ProviderCitation,
  type ProviderStepRequest,
  type ProviderStepResult,
  type ProviderUsage,
} from './provider.js';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_ERROR_DETAIL_CHARS = 300;

export interface OpenRouterProviderOptions {
  model: string;
  /** Resolves the DPAPI-protected key per call; null when unconfigured. */
  getApiKey: () => Promise<string | null>;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
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

    // Abort and network errors from fetch propagate unchanged; the executor
    // classifies AbortError against cancellation and the wall-clock limit.
    // The hosted `web` plugin bills per executed search even on free models,
    // so on a creditless account a request carrying it fails with HTTP 402;
    // when that happens we retry once without `plugins` so startingUrls +
    // fetch_page can still complete the brief.
    const baseBody: Record<string, unknown> = {
      model: this.#model,
      messages: toChatMessages(request.messages),
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      max_tokens: this.#maxOutputTokens,
    };

    const postCompletion = async (body: Record<string, unknown>): Promise<Response> => {
      try {
        return await this.#fetchImpl(OPENROUTER_CHAT_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new ProviderError(`OpenRouter request failed: ${redactSecret(message, apiKey)}`);
      }
    };

    let webSearchSkippedReason: string | undefined;
    let response = await postCompletion(
      request.webSearch ? { ...baseBody, plugins: [{ id: 'web' }] } : baseBody,
    );

    if (response.status === 402 && request.webSearch) {
      void response.body?.cancel?.().catch(() => {});
      webSearchSkippedReason =
        'Hosted web search was skipped due to OpenRouter HTTP 402; only startingUrls and fetch_page were used.';
      response = await postCompletion(baseBody);
    }

    if (!response.ok) {
      const detail = await errorDetail(response, apiKey);
      if (response.status === 402) {
        throw new ProviderError(
          `OpenRouter request failed with HTTP 402: ${detail} Switch to a :free model such as openrouter/free in Settings, or add OpenRouter credits.`,
        );
      }
      throw new ProviderError(
        `OpenRouter request failed with HTTP ${response.status}: ${detail}`,
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(await response.text());
    } catch {
      throw new ProviderError('OpenRouter returned a non-JSON response body.');
    }
    const body = asRecord(parsedBody);
    if (!body) {
      throw new ProviderError('OpenRouter returned a non-object response body.');
    }

    const choice = asArray(body.choices).map(asRecord).find(Boolean) ?? null;
    if (!choice) {
      throw new ProviderError('OpenRouter returned no choices.');
    }
    const finishReason = asString(choice.finish_reason);
    if (finishReason === 'content_filter') {
      throw new ProviderError('OpenRouter response blocked by a content filter.');
    }

    const message = asRecord(choice.message);
    const text = asString(message?.content) ?? '';
    const rawToolCalls = asArray(message?.tool_calls);
    const calls: Array<{ id: string; name: string; argsJson: string }> = [];
    for (const rawCall of rawToolCalls) {
      const call = asRecord(rawCall);
      const function_ = asRecord(call?.function);
      const id = asString(call?.id);
      const name = asString(function_?.name);
      if (!id || !name) {
        continue;
      }
      calls.push({ id, name, argsJson: asString(function_?.arguments) ?? '{}' });
    }

    const citations: ProviderCitation[] = [];
    for (const rawAnnotation of asArray(message?.annotations)) {
      const annotation = asRecord(rawAnnotation);
      if (asString(annotation?.type) !== 'url_citation') {
        continue;
      }
      const citation = asRecord(annotation?.url_citation);
      const url = asString(citation?.url);
      if (!url) {
        continue;
      }
      const title = asString(citation?.title);
      citations.push(title === null ? { url } : { url, title });
    }

    const warnings: string[] = [];
    if (webSearchSkippedReason) {
      warnings.push(webSearchSkippedReason);
    }

    const usage = toUsage(body.usage);
    if (finishReason === 'length') {
      if (rawToolCalls.length > 0 || calls.length > 0 || text.trim().length === 0) {
        throw new ProviderError('OpenRouter response incomplete: stopped for max_tokens.');
      }
      const truncationNote = `Response truncated at max_tokens (${this.#maxOutputTokens}).`;
      warnings.push(truncationNote);
      return {
        kind: 'final',
        text: `${text}\n\n> [!WARNING]\n> ${truncationNote}`,
        citations,
        usage,
        ...(webSearchSkippedReason ? { webSearchSkippedReason } : {}),
        warnings,
      };
    }

    if (calls.length > 0) {
      return {
        kind: 'tool_calls',
        calls,
        searches: citations.length,
        usage,
        ...(webSearchSkippedReason ? { webSearchSkippedReason } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }
    if (text.length === 0) {
      throw new ProviderError('OpenRouter returned an empty response.');
    }
    return {
      kind: 'final',
      text,
      citations,
      usage,
      ...(webSearchSkippedReason ? { webSearchSkippedReason } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}

function toChatMessages(
  messages: ProviderStepRequest['messages'],
): Array<Record<string, unknown>> {
  const chatMessages: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    switch (message.role) {
      case 'system':
      case 'user':
      case 'assistant':
        chatMessages.push({ role: message.role, content: message.content });
        break;
      case 'tool_calls':
        chatMessages.push({
          role: 'assistant',
          content: null,
          tool_calls: message.calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.argsJson },
          })),
        });
        break;
      case 'tool_result':
        chatMessages.push({
          role: 'tool',
          tool_call_id: message.callId,
          content: message.content,
        });
        break;
    }
  }
  return chatMessages;
}

function toUsage(value: unknown): ProviderUsage {
  const record = asRecord(value);
  return {
    inputTokens: asNumber(record?.prompt_tokens),
    outputTokens: asNumber(record?.completion_tokens),
  };
}

async function errorDetail(response: Response, apiKey: string): Promise<string> {
  let raw = '';
  try {
    raw = redactSecret(await response.text(), apiKey);
  } catch {
    return 'no response body';
  }
  try {
    const parsed = asRecord(JSON.parse(raw));
    const message = asString(asRecord(parsed?.error)?.message);
    if (message) {
      return truncate(message, MAX_ERROR_DETAIL_CHARS);
    }
  } catch {
    // Not JSON; fall through to the raw body excerpt.
  }
  return raw.length > 0 ? truncate(raw, MAX_ERROR_DETAIL_CHARS) : 'no response body';
}

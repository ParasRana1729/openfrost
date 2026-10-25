import {
  ProviderError,
  ProviderMissingError,
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
    this.#maxOutputTokens = options.maxOutputTokens ?? 4_000;
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
    // so it is attached only to web-grounded workflows — on a creditless
    // account any request carrying it fails outright (HTTP 402).
    const requestBody: Record<string, unknown> = {
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
    if (request.webSearch) {
      requestBody.plugins = [{ id: 'web' }];
    }
    const response = await this.#fetchImpl(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new ProviderError(
        `OpenRouter request failed with HTTP ${response.status}: ${await errorDetail(response)}`,
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
    if (finishReason === 'length') {
      throw new ProviderError('OpenRouter response incomplete: stopped for max_tokens.');
    }
    if (finishReason === 'content_filter') {
      throw new ProviderError('OpenRouter response blocked by a content filter.');
    }

    const message = asRecord(choice.message);
    const text = asString(message?.content) ?? '';
    const calls: Array<{ id: string; name: string; argsJson: string }> = [];
    for (const rawCall of asArray(message?.tool_calls)) {
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

    const usage = toUsage(body.usage);
    if (calls.length > 0) {
      return { kind: 'tool_calls', calls, searches: citations.length, usage };
    }
    if (text.length === 0) {
      throw new ProviderError('OpenRouter returned an empty response.');
    }
    return { kind: 'final', text, citations, usage };
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

async function errorDetail(response: Response): Promise<string> {
  let raw = '';
  try {
    raw = await response.text();
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

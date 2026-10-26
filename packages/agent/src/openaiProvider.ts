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

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_ERROR_DETAIL_CHARS = 300;

export interface OpenAIProviderOptions {
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
 * OpenAI adapter over the Responses API. Tool calls come back as
 * `function_call` items for the executor to run; hosted web search shows up
 * as `web_search_call` items and is surfaced as a count. The API key is sent
 * only in the Authorization header and never appears in logs or errors.
 */
export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai';

  readonly #model: string;
  readonly #getApiKey: () => Promise<string | null>;
  readonly #maxOutputTokens: number;
  readonly #fetchImpl: typeof fetch;

  constructor(options: OpenAIProviderOptions) {
    this.#model = options.model;
    this.#getApiKey = options.getApiKey;
    this.#maxOutputTokens = options.maxOutputTokens ?? 4_000;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
    const apiKey = await this.#getApiKey();
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ProviderMissingError(
        'No OpenAI key is configured. Store one in Settings to enable model-backed runs.',
      );
    }

    const instructions = request.messages.find((m) => m.role === 'system')?.content ?? '';
    const input = toResponseItems(request.messages);
    // Hosted web search rides along only for web-grounded workflows.
    const tools: Array<Record<string, unknown>> = request.webSearch
      ? [{ type: 'web_search' }]
      : [];
    for (const tool of request.tools) {
      tools.push({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      });
    }

    // Abort and network errors from fetch propagate unchanged; the executor
    // classifies AbortError against cancellation and the wall-clock limit.
    const response = await this.#fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.#model,
        instructions,
        input,
        tools,
        max_output_tokens: this.#maxOutputTokens,
        store: false,
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new ProviderError(
        `OpenAI request failed with HTTP ${response.status}: ${await errorDetail(response, apiKey)}`,
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(await response.text());
    } catch {
      throw new ProviderError('OpenAI returned a non-JSON response body.');
    }
    const body = asRecord(parsedBody);
    if (!body) {
      throw new ProviderError('OpenAI returned a non-object response body.');
    }
    const status = asString(body.status);
    if (status === 'incomplete') {
      const reason =
        asString(asRecord(body.incomplete_details)?.reason) ?? 'the response was incomplete';
      throw new ProviderError(`OpenAI response incomplete: ${reason}`);
    }

    const calls: Array<{ id: string; name: string; argsJson: string }> = [];
    let searches = 0;
    const texts: string[] = [];
    const citations: ProviderCitation[] = [];
    for (const item of asArray(body.output)) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const type = asString(record.type);
      if (type === 'function_call') {
        const id = asString(record.call_id);
        const name = asString(record.name);
        if (!id || !name) {
          continue;
        }
        calls.push({ id, name, argsJson: asString(record.arguments) ?? '{}' });
      } else if (type === 'web_search_call') {
        searches += 1;
      } else if (type === 'message') {
        for (const part of asArray(record.content)) {
          const partRecord = asRecord(part);
          if (!partRecord || asString(partRecord.type) !== 'output_text') {
            continue;
          }
          texts.push(asString(partRecord.text) ?? '');
          collectCitations(partRecord.annotations, citations);
        }
      }
    }

    const usage = toUsage(body.usage);
    if (calls.length > 0) {
      return { kind: 'tool_calls', calls, searches, usage };
    }
    return { kind: 'final', text: texts.join(''), citations, usage };
  }
}

function toResponseItems(messages: ProviderStepRequest['messages']): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    switch (message.role) {
      case 'system':
        break; // Mapped to top-level `instructions`.
      case 'user':
        items.push({ role: 'user', content: [{ type: 'input_text', text: message.content }] });
        break;
      case 'assistant':
        items.push({ role: 'assistant', content: [{ type: 'output_text', text: message.content }] });
        break;
      case 'tool_calls':
        for (const call of message.calls) {
          items.push({
            type: 'function_call',
            call_id: call.id,
            name: call.name,
            arguments: call.argsJson,
          });
        }
        break;
      case 'tool_result':
        items.push({
          type: 'function_call_output',
          call_id: message.callId,
          output: message.content,
        });
        break;
    }
  }
  return items;
}

function collectCitations(annotations: unknown, citations: ProviderCitation[]): void {
  for (const annotation of asArray(annotations)) {
    const record = asRecord(annotation);
    if (!record || asString(record.type) !== 'url_citation') {
      continue;
    }
    const url = asString(record.url);
    if (!url) {
      continue;
    }
    const title = asString(record.title);
    citations.push(title === null ? { url } : { url, title });
  }
}

function toUsage(value: unknown): ProviderUsage {
  const record = asRecord(value);
  return {
    inputTokens: asNumber(record?.input_tokens),
    outputTokens: asNumber(record?.output_tokens),
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

import {
  ProviderError,
  redactSecret,
  type AgentMessage,
  type ProviderCitation,
  type ProviderStepResult,
  type ProviderUsage,
  type ToolDefinition,
} from './provider.js';

const MAX_ERROR_DETAIL_CHARS = 300;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

/** Maps internal agent messages onto the OpenAI Chat Completions wire format. */
export function toChatMessages(messages: AgentMessage[]): Array<Record<string, unknown>> {
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

/** Maps internal tool definitions onto OpenAI Chat Completions function tools. */
export function toChatTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/** Extracts token usage from an OpenAI Chat Completions response payload. */
export function toChatUsage(value: unknown): ProviderUsage {
  const record = asRecord(value);
  return {
    inputTokens: asNumber(record?.prompt_tokens),
    outputTokens: asNumber(record?.completion_tokens),
  };
}

/**
 * Posts a JSON request to an OpenAI-compatible `/chat/completions` endpoint.
 * Propagates `AbortError` unchanged and redacts `apiKey` from transport failures.
 */
export async function postChatCompletion(options: {
  fetchImpl: typeof fetch;
  url: string;
  apiKey: string;
  providerLabel: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
}): Promise<Response> {
  try {
    return await options.fetchImpl(options.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ProviderError(
      `${options.providerLabel} request failed: ${redactSecret(message, options.apiKey)}`,
    );
  }
}

/** Extracts a bounded, key-redacted error summary from a failed HTTP response. */
export async function chatErrorDetail(response: Response, apiKey: string): Promise<string> {
  let raw = '';
  try {
    raw = redactSecret(await response.text(), apiKey);
  } catch {
    return 'no response body';
  }
  try {
    const parsed = asRecord(JSON.parse(raw));
    const message = asString(asRecord(parsed?.error)?.message) ?? asString(parsed?.detail);
    if (message) {
      return truncate(message, MAX_ERROR_DETAIL_CHARS);
    }
  } catch {
    // Not JSON; fall through to the raw body excerpt.
  }
  return raw.length > 0 ? truncate(raw, MAX_ERROR_DETAIL_CHARS) : 'no response body';
}

/**
 * Parses an OpenAI-compatible Chat Completions JSON response into a
 * `ProviderStepResult`, handling content filters, truncation, tool calls, and
 * `url_citation` annotations.
 */
export async function parseChatCompletionResponse(options: {
  response: Response;
  providerLabel: string;
  maxOutputTokens: number;
  webSearchSkippedReason?: string;
}): Promise<ProviderStepResult> {
  const { response, providerLabel, maxOutputTokens, webSearchSkippedReason } = options;

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(await response.text());
  } catch {
    throw new ProviderError(`${providerLabel} returned a non-JSON response body.`);
  }
  const body = asRecord(parsedBody);
  if (!body) {
    throw new ProviderError(`${providerLabel} returned a non-object response body.`);
  }

  const choice = asArray(body.choices).map(asRecord).find(Boolean) ?? null;
  if (!choice) {
    throw new ProviderError(`${providerLabel} returned no choices.`);
  }
  const finishReason = asString(choice.finish_reason);
  if (finishReason === 'content_filter') {
    throw new ProviderError(`${providerLabel} response blocked by a content filter.`);
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

  const usage = toChatUsage(body.usage);
  if (finishReason === 'length') {
    if (rawToolCalls.length > 0 || calls.length > 0 || text.trim().length === 0) {
      throw new ProviderError(`${providerLabel} response incomplete: stopped for max_tokens.`);
    }
    const truncationNote = `Response truncated at max_tokens (${maxOutputTokens}).`;
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
    throw new ProviderError(`${providerLabel} returned an empty response.`);
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

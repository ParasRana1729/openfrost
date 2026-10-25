import type {
  AgentMessage,
  LlmProvider,
  ProviderStepRequest,
  ProviderStepResult,
  ProviderUsage,
  ToolDefinition,
} from './provider.js';
import { ProviderError, ProviderMissingError } from './provider.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const ERROR_MESSAGE_MAX_CHARS = 300;

export interface GeminiProviderOptions {
  model: string;
  /** Returns the DPAPI-decrypted key, or null when none is configured. */
  getApiKey: () => Promise<string | null>;
  maxOutputTokens?: number;
  /** Injectable for tests; production uses global fetch. */
  fetchImpl?: typeof fetch;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response?: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string };
}

function truncate(text: string): string {
  return text.length > ERROR_MESSAGE_MAX_CHARS ? `${text.slice(0, ERROR_MESSAGE_MAX_CHARS)}...` : text;
}

/** Keys the OpenAI/JSON-Schema world accepts that Gemini's function
 * declaration subset rejects with HTTP 400. */
const UNSUPPORTED_SCHEMA_KEYS = new Set(['additionalProperties', '$schema']);

function stripUnsupportedSchemaKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUnsupportedSchemaKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!UNSUPPORTED_SCHEMA_KEYS.has(key)) {
        cleaned[key] = stripUnsupportedSchemaKeys(item);
      }
    }
    return cleaned;
  }
  return value;
}

/**
 * Google Gemini adapter over the native `generateContent` API. Web search is
 * Gemini's hosted Google Search grounding; grounding chunks surface as
 * citations and search counts, mirroring the OpenAI adapter's shape. The API
 * key travels only in the `x-goog-api-key` header and never appears in logs
 * or errors.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  readonly #model: string;
  readonly #getApiKey: () => Promise<string | null>;
  readonly #maxOutputTokens: number;
  readonly #fetchImpl: typeof fetch;

  constructor(options: GeminiProviderOptions) {
    this.#model = options.model;
    this.#getApiKey = options.getApiKey;
    this.#maxOutputTokens = options.maxOutputTokens ?? 4000;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
    const apiKey = await this.#getApiKey();
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ProviderMissingError(
        `No Gemini key is configured. Store one in Settings to enable model-backed execution (${this.#model}).`,
      );
    }

    const body = this.#buildRequestBody(request);
    let response: Response;
    try {
      response = await this.#fetchImpl(
        `${GEMINI_API_BASE}/models/${encodeURIComponent(this.#model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
          signal: request.signal,
        },
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      throw new ProviderError(`Gemini request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const parsed = (await response.json()) as GeminiResponse;
        if (parsed.error?.message) {
          detail = `HTTP ${response.status}: ${truncate(parsed.error.message)}`;
        }
      } catch {
        // Non-JSON error body; the status line is enough.
      }
      throw new ProviderError(`Gemini request failed (${detail})`);
    }

    let parsed: GeminiResponse;
    try {
      parsed = (await response.json()) as GeminiResponse;
    } catch {
      throw new ProviderError('Gemini returned a non-JSON response body.');
    }

    if (parsed.promptFeedback?.blockReason) {
      throw new ProviderError(`Gemini blocked the request: ${parsed.promptFeedback.blockReason}`);
    }

    const candidate = parsed.candidates?.[0];
    if (!candidate) {
      throw new ProviderError('Gemini returned no candidates.');
    }
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      throw new ProviderError(
        `Gemini response incomplete: ${candidate.finishReason.toLowerCase()}`,
      );
    }

    const calls: Array<{ id: string; name: string; argsJson: string }> = [];
    let text = '';
    for (const part of candidate.content?.parts ?? []) {
      if (part.functionCall) {
        calls.push({
          id: `call-${calls.length}`,
          name: part.functionCall.name,
          argsJson: JSON.stringify(part.functionCall.args ?? {}),
        });
      } else if (typeof part.text === 'string') {
        text += part.text;
      }
    }

    const grounding = candidate.groundingMetadata;
    const searches =
      grounding?.webSearchQueries && grounding.webSearchQueries.length > 0
        ? grounding.webSearchQueries.length
        : grounding
          ? 1
          : 0;
    const citations = (grounding?.groundingChunks ?? [])
      .map((chunk) => ({ url: chunk.web?.uri ?? '', title: chunk.web?.title }))
      .filter((citation) => citation.url.length > 0);

    const usage: ProviderUsage = {
      inputTokens: parsed.usageMetadata?.promptTokenCount ?? null,
      outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? null,
    };

    if (calls.length > 0) {
      return { kind: 'tool_calls', calls, searches, usage };
    }
    if (text.length === 0) {
      throw new ProviderError('Gemini returned an empty response.');
    }
    return { kind: 'final', text, citations, usage };
  }

  #buildRequestBody(request: ProviderStepRequest): Record<string, unknown> {
    const system = request.messages.find((message) => message.role === 'system');
    const contents = this.#buildContents(request.messages);
    return {
      systemInstruction: { parts: [{ text: system?.content ?? '' }] },
      contents,
      tools: [
        { google_search: {} },
        { function_declarations: request.tools.map((tool) => this.#declaration(tool)) },
      ],
      generationConfig: { maxOutputTokens: this.#maxOutputTokens },
    };
  }

  #declaration(tool: ToolDefinition): Record<string, unknown> {
    return {
      name: tool.name,
      description: tool.description,
      // Gemini's function-declaration schema subset rejects keys like
      // `additionalProperties` that OpenAI accepts; strip them per call.
      parameters: stripUnsupportedSchemaKeys(tool.parameters),
    };
  }

  /** Maps AgentMessages to `contents`; consecutive tool_result messages are
   * merged into one user turn with one functionResponse part each, as the
   * Gemini API expects. */
  #buildContents(messages: AgentMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = [];
    const pushPart = (role: 'user' | 'model', part: GeminiPart): void => {
      const last = contents[contents.length - 1];
      if (last && last.role === role) {
        last.parts.push(part);
        return;
      }
      contents.push({ role, parts: [part] });
    };

    for (const message of messages) {
      switch (message.role) {
        case 'system':
          break; // mapped to systemInstruction
        case 'user':
          pushPart('user', { text: message.content });
          break;
        case 'assistant':
          pushPart('model', { text: message.content });
          break;
        case 'tool_calls':
          for (const call of message.calls) {
            let args: Record<string, unknown> = {};
            try {
              const parsed: unknown = JSON.parse(call.argsJson);
              if (typeof parsed === 'object' && parsed !== null) {
                args = parsed as Record<string, unknown>;
              }
            } catch {
              args = {};
            }
            pushPart('model', { functionCall: { name: call.name, args } });
          }
          break;
        case 'tool_result':
          pushPart('user', {
            functionResponse: {
              name: message.name,
              response: {
                result: message.ok ? message.content : `Error: ${message.content}`,
              },
            },
          });
          break;
      }
    }
    return contents;
  }
}

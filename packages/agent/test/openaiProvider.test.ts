import { describe, expect, it } from 'vitest';
import { OpenAIProvider, ProviderError, ProviderMissingError } from '../src/index.js';

const FAKE_KEY = 'sk-test-secret-key-do-not-leak';

interface CapturedRequest {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Captures the request and returns a scripted response. */
function scriptedFetch(
  respond: (captured: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const requestInit = init ?? {};
    const body = JSON.parse(String(requestInit.body ?? '{}')) as Record<string, unknown>;
    const captured: CapturedRequest = { url, init: requestInit, body };
    requests.push(captured);
    return respond(captured);
  };
  return { fetchImpl, requests };
}

const stepRequest = {
  messages: [
    {
      role: 'system' as const,
      content: 'You produce a saved research brief for the OpenFrost owner.',
    },
    { role: 'user' as const, content: 'Task: Compare databases' },
  ],
  tools: [
    {
      name: 'fetch_page',
      description: 'Retrieve one public http(s) page.',
      parameters: { type: 'object', properties: { url: { type: 'string' } } },
    },
  ],
  step: 1,
  signal: new AbortController().signal,
  webSearch: true,
};

describe('OpenAIProvider request shape', () => {
  it('posts the Responses API request with mapped messages and tools', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Brief body', annotations: [] }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    );
    const provider = new OpenAIProvider({
      model: 'gpt-test',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step(stepRequest);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe('https://api.openai.com/v1/responses');
    expect(request?.init.method).toBe('POST');
    // Presence only: the key value must never be asserted or logged.
    const headers = new Headers(request?.init.headers);
    expect(headers.has('authorization')).toBe(true);
    expect(request?.body.model).toBe('gpt-test');
    expect(request?.body.instructions).toBe('You produce a saved research brief for the OpenFrost owner.');
    expect(request?.body.max_output_tokens).toBe(4_000);
    expect(request?.body.store).toBe(false);
    expect(request?.body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Task: Compare databases' }] },
    ]);
    expect(request?.body.tools).toEqual([
      { type: 'web_search' },
      {
        type: 'function',
        name: 'fetch_page',
        description: 'Retrieve one public http(s) page.',
        parameters: { type: 'object', properties: { url: { type: 'string' } } },
      },
    ]);

    expect(result).toMatchObject({ kind: 'final', text: 'Brief body' });
  });

  it('drops the hosted web_search tool for file-grounded runs (webSearch false)', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }] }),
    );
    const provider = new OpenAIProvider({
      model: 'gpt-test',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await provider.step({ ...stepRequest, webSearch: false });

    const tools = requests[0]?.body.tools as Array<Record<string, unknown>>;
    expect(tools.some((tool) => tool.type === 'web_search')).toBe(false);
    expect(tools).toHaveLength(1);
  });
});

describe('OpenAIProvider response mapping', () => {
  it('maps web_search_call and function_call items to a tool_calls step', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse({
        status: 'completed',
        output: [
          { type: 'web_search_call', id: 'ws_1' },
          {
            type: 'function_call',
            call_id: 'call_abc',
            name: 'fetch_page',
            arguments: '{"url":"https://example.com/"}',
          },
        ],
        usage: { input_tokens: 100, output_tokens: 14 },
      }),
    );
    const provider = new OpenAIProvider({
      model: 'gpt-test',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step(stepRequest);

    expect(result.kind).toBe('tool_calls');
    if (result.kind !== 'tool_calls') {
      throw new Error('expected tool_calls');
    }
    expect(result.searches).toBe(1);
    expect(result.calls).toEqual([
      { id: 'call_abc', name: 'fetch_page', argsJson: '{"url":"https://example.com/"}' },
    ]);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 14 });
  });

  it('maps message text and url_citation annotations to a final result', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'The answer.',
                annotations: [
                  { type: 'url_citation', url: 'https://example.com/a', title: 'Source A' },
                  { type: 'url_citation', url: 'https://example.com/b' },
                ],
              },
            ],
          },
        ],
        usage: { input_tokens: 7, output_tokens: 9 },
      }),
    );
    const provider = new OpenAIProvider({
      model: 'gpt-test',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step(stepRequest);

    expect(result).toEqual({
      kind: 'final',
      text: 'The answer.',
      citations: [
        { url: 'https://example.com/a', title: 'Source A' },
        { url: 'https://example.com/b' },
      ],
      usage: { inputTokens: 7, outputTokens: 9 },
    });
  });

  it('throws ProviderError for incomplete responses', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
      }),
    );
    const provider = new OpenAIProvider({
      model: 'gpt-test',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await expect(provider.step(stepRequest)).rejects.toThrowError(ProviderError);
    await expect(provider.step(stepRequest)).rejects.toThrowError(/max_output_tokens/);
  });
});

describe('OpenAIProvider error handling', () => {
  it('throws ProviderError on non-2xx without leaking the API key', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse({ error: { message: `Incorrect API key provided: ${FAKE_KEY}` } }, 401),
    );
    const provider = new OpenAIProvider({
      model: 'gpt-test',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const err = await provider.step(stepRequest).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProviderError);
    const message = err instanceof Error ? err.message : '';
    expect(message).toContain('HTTP 401');
    expect(message).toContain('Incorrect API key provided');
    expect(message).toContain('[redacted]');
    expect(message).not.toContain(FAKE_KEY);
  });

  it('throws ProviderMissingError when no key is configured', async () => {
    const { fetchImpl, requests } = scriptedFetch(() => jsonResponse({ output: [] }));
    const provider = new OpenAIProvider({
      model: 'gpt-test',
      getApiKey: async () => null,
      fetchImpl,
    });

    await expect(provider.step(stepRequest)).rejects.toThrowError(ProviderMissingError);
    await expect(provider.step(stepRequest)).rejects.toThrowError(/Store one in Settings/);
    expect(requests).toHaveLength(0); // no request is sent without a key
  });

  it('propagates abort errors unchanged', async () => {
    const abortError = new Error('provider step aborted');
    abortError.name = 'AbortError';
    const fetchImpl: typeof fetch = async (_input, init) => {
      void init;
      throw abortError;
    };
    const provider = new OpenAIProvider({
      model: 'gpt-test',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await expect(provider.step(stepRequest)).rejects.toBe(abortError);
  });
});

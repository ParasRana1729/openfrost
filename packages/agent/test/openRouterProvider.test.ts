import { describe, expect, it } from 'vitest';
import { OpenRouterProvider, ProviderError, ProviderMissingError } from '../src/index.js';

const FAKE_KEY = 'sk-or-test-secret-key-do-not-leak';

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
};

function completion(
  message: Record<string, unknown>,
  finishReason = 'stop',
  usage: Record<string, unknown> = { prompt_tokens: 100, completion_tokens: 14 },
): Record<string, unknown> {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: 'openrouter/auto',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage,
  };
}

describe('OpenRouterProvider request shape', () => {
  it('posts the chat completions request with mapped messages, tools, and the web plugin', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'Brief body' })),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step(stepRequest);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request?.init.method).toBe('POST');
    // Presence only: the key value must never be asserted or logged.
    const headers = new Headers(request?.init.headers);
    expect(headers.has('authorization')).toBe(true);
    expect(request?.body.model).toBe('openrouter/auto');
    expect(request?.body.max_tokens).toBe(4_000);
    expect(request?.body.plugins).toEqual([{ id: 'web' }]);
    expect(request?.body.messages).toEqual([
      { role: 'system', content: 'You produce a saved research brief for the OpenFrost owner.' },
      { role: 'user', content: 'Task: Compare databases' },
    ]);
    expect(request?.body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'fetch_page',
          description: 'Retrieve one public http(s) page.',
          parameters: { type: 'object', properties: { url: { type: 'string' } } },
        },
      },
    ]);

    expect(result).toMatchObject({ kind: 'final', text: 'Brief body' });
  });

  it('maps tool-call history onto assistant tool_calls and tool-role messages', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'Done.' })),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await provider.step({
      ...stepRequest,
      messages: [
        ...stepRequest.messages,
        {
          role: 'tool_calls',
          calls: [{ id: 'call_1', name: 'fetch_page', argsJson: '{"url":"https://a/"}' }],
        },
        { role: 'tool_result', callId: 'call_1', name: 'fetch_page', ok: true, content: 'page' },
      ],
    });

    const messages = requests[0]?.body.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'fetch_page', arguments: '{"url":"https://a/"}' },
        },
      ],
    });
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'page',
    });
  });
});

describe('OpenRouterProvider response mapping', () => {
  it('maps tool_calls to a tool_calls step with usage', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(
        completion(
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'fetch_page', arguments: '{"url":"https://example.com/"}' },
              },
            ],
          },
          'tool_calls',
        ),
      ),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step(stepRequest);

    expect(result.kind).toBe('tool_calls');
    if (result.kind !== 'tool_calls') {
      throw new Error('expected tool_calls');
    }
    expect(result.searches).toBe(0);
    expect(result.calls).toEqual([
      { id: 'call_abc', name: 'fetch_page', argsJson: '{"url":"https://example.com/"}' },
    ]);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 14 });
  });

  it('maps url_citation annotations to citations on a final result', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(
        completion({
          role: 'assistant',
          content: 'The answer.',
          annotations: [
            {
              type: 'url_citation',
              url_citation: { url: 'https://example.com/a', title: 'Source A' },
            },
            {
              type: 'url_citation',
              url_citation: { url: 'https://example.com/b' },
            },
          ],
        }),
      ),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
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
      usage: { inputTokens: 100, outputTokens: 14 },
    });
  });

  it('counts annotations as hosted searches on a tool_calls step', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(
        completion(
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'fetch_page', arguments: '{}' },
              },
            ],
            annotations: [
              {
                type: 'url_citation',
                url_citation: { url: 'https://example.com/src', title: 'Looked up' },
              },
            ],
          },
          'tool_calls',
        ),
      ),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step(stepRequest);
    expect(result.kind).toBe('tool_calls');
    if (result.kind !== 'tool_calls') {
      throw new Error('expected tool_calls');
    }
    expect(result.searches).toBe(1);
  });
});

describe('OpenRouterProvider error handling', () => {
  it('throws ProviderError when finish_reason is length', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'trunc' }, 'length')),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await expect(provider.step(stepRequest)).rejects.toThrowError(ProviderError);
    await expect(provider.step(stepRequest)).rejects.toThrowError(/max_tokens/);
  });

  it('throws ProviderError when finish_reason is content_filter', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: '' }, 'content_filter')),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await expect(provider.step(stepRequest)).rejects.toThrowError(/content filter/);
  });

  it('throws ProviderError on an empty final response', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: '' })),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await expect(provider.step(stepRequest)).rejects.toThrowError(/empty response/);
  });

  it('throws ProviderError on non-2xx without leaking the API key', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse({ error: { code: 401, message: 'Invalid API key provided' } }, 401),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
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
    expect(message).toContain('Invalid API key provided');
    expect(message).not.toContain(FAKE_KEY);
  });

  it('throws ProviderMissingError when no key is configured', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'x' })),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
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
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await expect(provider.step(stepRequest)).rejects.toBe(abortError);
  });
});

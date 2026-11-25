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
  webSearch: true,
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
    expect(request?.body.max_tokens).toBe(8_192);
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

  it('omits the web plugin entirely for file-grounded runs (webSearch false)', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'Done.' })),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await provider.step({ ...stepRequest, webSearch: false });

    // The hosted plugin bills per search even on free models and breaks
    // creditless accounts outright; file-grounded workflows never send it.
    expect(requests[0]?.body.plugins).toBeUndefined();
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

describe('OpenRouterProvider 402 fallback and truncation handling', () => {
  it('retries without the web plugin on HTTP 402 when webSearch is true and surfaces a warning', async () => {
    let attempt = 0;
    const { fetchImpl, requests } = scriptedFetch(() => {
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse({ error: { code: 402, message: 'Payment Required for web plugin' } }, 402);
      }
      return jsonResponse(completion({ role: 'assistant', content: 'Fallback brief body' }));
    });
    const provider = new OpenRouterProvider({
      model: 'openrouter/free',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step(stepRequest);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.body.plugins).toEqual([{ id: 'web' }]);
    expect(requests[1]?.body.plugins).toBeUndefined();
    expect(result.kind).toBe('final');
    if (result.kind === 'final') {
      expect(result.text).toBe('Fallback brief body');
      expect(result.webSearchSkippedReason).toContain('HTTP 402');
      expect(result.warnings).toEqual([result.webSearchSkippedReason]);
    }
  });

  it('includes an actionable hint when HTTP 402 persists after omitting the web plugin', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse(
        { error: { code: 402, message: `Insufficient credits for ${FAKE_KEY}` } },
        402,
      ),
    );
    const provider = new OpenRouterProvider({
      model: 'openai/gpt-4.1',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const err = await provider.step(stepRequest).then(
      () => null,
      (e: unknown) => e,
    );
    expect(requests).toHaveLength(2);
    expect(err).toBeInstanceOf(ProviderError);
    const message = err instanceof Error ? err.message : '';
    expect(message).toContain('HTTP 402');
    expect(message).toContain('Switch to a :free model such as openrouter/free in Settings, or add OpenRouter credits.');
    expect(message).not.toContain(FAKE_KEY);
  });

  it('does not retry HTTP 402 when webSearch is false and includes the actionable hint', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse({ error: { code: 402, message: 'Insufficient credits' } }, 402),
    );
    const provider = new OpenRouterProvider({
      model: 'openai/gpt-4.1',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const err = await provider.step({ ...stepRequest, webSearch: false }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(requests).toHaveLength(1);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err instanceof Error ? err.message : '').toContain(
      'Switch to a :free model such as openrouter/free in Settings, or add OpenRouter credits.',
    );
  });

  it('returns partial text with a warning when finish_reason is length and no tool calls are present', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'Partial brief content' }, 'length')),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/free',
      getApiKey: async () => FAKE_KEY,
      maxOutputTokens: 8_192,
      fetchImpl,
    });

    const result = await provider.step(stepRequest);
    expect(result.kind).toBe('final');
    if (result.kind === 'final') {
      expect(result.text).toContain('Partial brief content');
      expect(result.text).toContain('> [!WARNING]\n> Response truncated at max_tokens (8192).');
      expect(result.warnings).toContain('Response truncated at max_tokens (8192).');
    }
  });
});

describe('OpenRouterProvider error handling', () => {
  it('throws ProviderError when finish_reason is length with empty text', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: '   ' }, 'length')),
    );
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    await expect(provider.step(stepRequest)).rejects.toThrowError(ProviderError);
    await expect(provider.step(stepRequest)).rejects.toThrowError(/max_tokens/);
  });

  it('throws ProviderError when finish_reason is length with incomplete tool calls', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(
        completion(
          {
            role: 'assistant',
            content: 'Partial text',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'fetch_page', arguments: '{"url":' } }],
          },
          'length',
        ),
      ),
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
      jsonResponse(
        { error: { code: 401, message: `Invalid API key provided: ${FAKE_KEY}` } },
        401,
      ),
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
    expect(message).toContain('[redacted]');
    expect(message).not.toContain(FAKE_KEY);
  });

  it('redacts the API key from a non-JSON error body', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      new Response(`upstream echoed ${FAKE_KEY}`, { status: 502 }),
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
    const message = err instanceof Error ? err.message : '';
    expect(message).toContain('upstream echoed [redacted]');
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

  it('redacts the API key from transport errors', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error(`transport failed with ${FAKE_KEY}`);
    };
    const provider = new OpenRouterProvider({
      model: 'openrouter/auto',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const err = await provider.step(stepRequest).then(
      () => null,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(ProviderError);
    if (err instanceof ProviderError) {
      expect(err.message).toContain('transport failed with [redacted]');
      expect(err.message).not.toContain(FAKE_KEY);
    }
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

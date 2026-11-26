import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  ProviderMissingError,
  TOKENFACTORY_CHAT_URL,
  TokenFactoryProvider,
  redactLogSecrets,
} from '../src/index.js';

const FAKE_KEY = 'rc-test-secret-tokenfactory-do-not-leak';

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
    { role: 'user' as const, content: 'Task: Compare GPUs' },
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
  usage: Record<string, unknown> = { prompt_tokens: 120, completion_tokens: 24 },
): Record<string, unknown> {
  return {
    id: 'chatcmpl-amd-test',
    object: 'chat.completion',
    model: 'Qwen3.8-27B',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage,
  };
}

describe('TokenFactoryProvider request shape', () => {
  it('posts chat completions to AMD Token Factory with mapped messages and tools', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'Brief body' })),
    );
    const provider = new TokenFactoryProvider({
      model: 'Qwen3.8-27B',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step(stepRequest);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe(TOKENFACTORY_CHAT_URL);
    expect(request?.url).toBe('https://developer.amd.com.cn/radeon/api/v1/chat/completions');
    expect(request?.init.method).toBe('POST');
    const headers = new Headers(request?.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${FAKE_KEY}`);
    expect(request?.body.model).toBe('Qwen3.8-27B');
    expect(request?.body.max_tokens).toBe(8_192);
    expect(request?.body.plugins).toBeUndefined();
    expect(request?.body.messages).toEqual([
      { role: 'system', content: 'You produce a saved research brief for the OpenFrost owner.' },
      { role: 'user', content: 'Task: Compare GPUs' },
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

    expect(result).toMatchObject({
      kind: 'final',
      text: 'Brief body',
      webSearchSkippedReason:
        'AMD Token Factory does not offer hosted web search; only startingUrls and fetch_page were used.',
      warnings: [
        'AMD Token Factory does not offer hosted web search; only startingUrls and fetch_page were used.',
      ],
    });
  });

  it('omits webSearchSkippedReason when webSearch is false and omits empty tools', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'Project update.' })),
    );
    const provider = new TokenFactoryProvider({
      model: 'DeepSeek-V4.1-Flash',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step({ ...stepRequest, tools: [], webSearch: false });

    expect(requests[0]?.body.tools).toBeUndefined();
    expect(result).toEqual({
      kind: 'final',
      text: 'Project update.',
      citations: [],
      usage: { inputTokens: 120, outputTokens: 24 },
    });
  });

  it('maps tool-call history and tool_calls responses', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse(
        completion(
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_tf_1',
                type: 'function',
                function: { name: 'fetch_page', arguments: '{"url":"https://example.com/"}' },
              },
            ],
          },
          'tool_calls',
        ),
      ),
    );
    const provider = new TokenFactoryProvider({
      model: 'Qwen3.8-27B',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const result = await provider.step({
      ...stepRequest,
      messages: [
        ...stepRequest.messages,
        {
          role: 'tool_calls',
          calls: [{ id: 'call_0', name: 'fetch_page', argsJson: '{"url":"https://a/"}' }],
        },
        { role: 'tool_result', callId: 'call_0', name: 'fetch_page', ok: true, content: 'page' },
      ],
    });

    const messages = requests[0]?.body.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_0',
          type: 'function',
          function: { name: 'fetch_page', arguments: '{"url":"https://a/"}' },
        },
      ],
    });
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_0',
      content: 'page',
    });
    expect(result).toMatchObject({
      kind: 'tool_calls',
      searches: 0,
      calls: [
        { id: 'call_tf_1', name: 'fetch_page', argsJson: '{"url":"https://example.com/"}' },
      ],
      usage: { inputTokens: 120, outputTokens: 24 },
    });
  });
});

describe('TokenFactoryProvider error and redaction handling', () => {
  it('throws ProviderMissingError when no key is configured', async () => {
    const { fetchImpl, requests } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'x' })),
    );
    const provider = new TokenFactoryProvider({
      model: 'Qwen3.8-27B',
      getApiKey: async () => null,
      fetchImpl,
    });

    await expect(provider.step(stepRequest)).rejects.toThrowError(ProviderMissingError);
    await expect(provider.step(stepRequest)).rejects.toThrowError(/AMD Token Factory key/);
    expect(requests).toHaveLength(0);
  });

  it('includes quota hint on HTTP 429 and redacts the rc- key', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse({ detail: `Daily quota exceeded for ${FAKE_KEY}` }, 429),
    );
    const provider = new TokenFactoryProvider({
      model: 'Qwen3.8-27B',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    });

    const err = await provider.step(stepRequest).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProviderError);
    const message = err instanceof Error ? err.message : '';
    expect(message).toContain('HTTP 429');
    expect(message).toContain('daily Token Factory quota');
    expect(message).toContain('[redacted]');
    expect(message).not.toContain(FAKE_KEY);
  });

  it('redacts rc- keys in non-2xx, transport errors, and log scrubbing', async () => {
    const { fetchImpl: httpErrFetch } = scriptedFetch(() =>
      new Response(`rejected key ${FAKE_KEY}`, { status: 401 }),
    );
    const p1 = new TokenFactoryProvider({
      model: 'Qwen3.8-27B',
      getApiKey: async () => FAKE_KEY,
      fetchImpl: httpErrFetch,
    });
    const httpErr = await p1.step(stepRequest).then(
      () => null,
      (e: unknown) => e,
    );
    expect(httpErr instanceof Error ? httpErr.message : '').toContain('rejected key [redacted]');
    expect(httpErr instanceof Error ? httpErr.message : '').not.toContain(FAKE_KEY);

    const p2 = new TokenFactoryProvider({
      model: 'Qwen3.8-27B',
      getApiKey: async () => FAKE_KEY,
      fetchImpl: async () => {
        throw new Error(`network failure for ${FAKE_KEY}`);
      },
    });
    const netErr = await p2.step(stepRequest).then(
      () => null,
      (e: unknown) => e,
    );
    expect(netErr instanceof Error ? netErr.message : '').toContain(
      'network failure for [redacted]',
    );
    expect(netErr instanceof Error ? netErr.message : '').not.toContain(FAKE_KEY);

    expect(redactLogSecrets(`failed auth with ${FAKE_KEY}`)).toBe('failed auth with [redacted]');
  });

  it('returns partial text with warning on max_tokens truncation and propagates abort', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse(completion({ role: 'assistant', content: 'Partial output' }, 'length')),
    );
    const provider = new TokenFactoryProvider({
      model: 'Qwen3.8-27B',
      getApiKey: async () => FAKE_KEY,
      maxOutputTokens: 4096,
      fetchImpl,
    });
    const res = await provider.step({ ...stepRequest, webSearch: false });
    expect(res.kind).toBe('final');
    if (res.kind === 'final') {
      expect(res.text).toContain('Partial output');
      expect(res.warnings).toContain('Response truncated at max_tokens (4096).');
    }

    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const abortProvider = new TokenFactoryProvider({
      model: 'Qwen3.8-27B',
      getApiKey: async () => FAKE_KEY,
      fetchImpl: async () => {
        throw abortErr;
      },
    });
    await expect(abortProvider.step(stepRequest)).rejects.toBe(abortErr);
  });
});

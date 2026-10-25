import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../src/geminiProvider.js';
import { ProviderError, ProviderMissingError, type ProviderStepRequest } from '../src/provider.js';
import type { AgentMessage, ToolDefinition } from '../src/provider.js';

const FAKE_KEY = 'AIza-test-secret-key-do-not-leak';

const tools: ToolDefinition[] = [
  {
    name: 'fetch_page',
    description: 'Retrieve one public http(s) page as plain text.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
];

function stepRequest(overrides?: Partial<ProviderStepRequest>): ProviderStepRequest {
  const messages: AgentMessage[] = overrides?.messages ?? [
    { role: 'system', content: 'You produce research briefs.' },
    { role: 'user', content: 'Compare A and B.' },
  ];
  return {
    messages,
    tools,
    step: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: unknown): { fetchImpl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function makeProvider(
  status: number,
  body: unknown,
): { provider: GeminiProvider; calls: CapturedCall[] } {
  const { fetchImpl, calls } = fakeFetch(status, body);
  return {
    provider: new GeminiProvider({
      model: 'gemini-2.5-flash',
      getApiKey: async () => FAKE_KEY,
      fetchImpl,
    }),
    calls,
  };
}

const okResponse = {
  candidates: [
    {
      finishReason: 'STOP',
      content: { parts: [{ text: 'The brief body.' }] },
      groundingMetadata: {
        webSearchQueries: ['note apps comparison'],
        groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'Example A' } }],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 220 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GeminiProvider', () => {
  it('sends the documented request shape with the key only in the header', async () => {
    const { provider, calls } = makeProvider(200, okResponse);
    const result = await provider.step(stepRequest());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('x-goog-api-key')).toBe(FAKE_KEY);
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
      tools: Array<Record<string, unknown>>;
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.systemInstruction.parts[0]?.text).toBe('You produce research briefs.');
    expect(body.tools).toEqual([
      { google_search: {} },
      {
        function_declarations: [
          {
            name: 'fetch_page',
            description: tools[0]?.description,
            // additionalProperties is stripped: Gemini rejects it with HTTP 400.
            parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
          },
        ],
      },
    ]);
    expect(body.generationConfig.maxOutputTokens).toBe(4000);

    expect(result).toMatchObject({
      kind: 'final',
      text: 'The brief body.',
    });
    if (result.kind === 'final') {
      expect(result.citations).toEqual([{ url: 'https://example.com/a', title: 'Example A' }]);
      expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 220 });
    }
  });

  it('maps function calls and counts searches from grounding queries', async () => {
    const { provider } = makeProvider(200, {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [{ functionCall: { name: 'fetch_page', args: { url: 'https://example.com/' } } }],
          },
          groundingMetadata: { webSearchQueries: ['a', 'b'] },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    const result = await provider.step(stepRequest());
    expect(result.kind).toBe('tool_calls');
    if (result.kind === 'tool_calls') {
      expect(result.calls).toEqual([
        { id: 'call-0', name: 'fetch_page', argsJson: '{"url":"https://example.com/"}' },
      ]);
      expect(result.searches).toBe(2);
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    }
  });

  it('merges consecutive tool results into one user turn', async () => {
    const { provider, calls } = makeProvider(200, okResponse);
    await provider.step(
      stepRequest({
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'go' },
          { role: 'tool_calls', calls: [{ id: 'c1', name: 'fetch_page', argsJson: '{"url":"https://a/"}' }] },
          { role: 'tool_result', callId: 'c1', name: 'fetch_page', ok: true, content: 'page one' },
          { role: 'tool_result', callId: 'c2', name: 'fetch_page', ok: false, content: 'blocked' },
        ],
      }),
    );
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const last = body.contents[body.contents.length - 1];
    expect(last?.role).toBe('user');
    expect(last?.parts).toHaveLength(2);
    expect(JSON.stringify(last?.parts[0])).toContain('"fetch_page"');
    expect(JSON.stringify(last?.parts[1])).toContain('Error: blocked');
  });

  it('throws ProviderMissingError without a key', async () => {
    const { fetchImpl } = fakeFetch(200, okResponse);
    const provider = new GeminiProvider({
      model: 'gemini-2.5-flash',
      getApiKey: async () => null,
      fetchImpl,
    });
    await expect(provider.step(stepRequest())).rejects.toThrowError(ProviderMissingError);
  });

  it('maps HTTP errors to ProviderError without leaking the key', async () => {
    const { provider } = makeProvider(400, {
      error: { message: 'API key not valid. Please pass a valid API key.' },
    });
    const err = await provider.step(stepRequest()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    if (err instanceof ProviderError) {
      expect(err.message).toContain('400');
      expect(err.message).not.toContain(FAKE_KEY);
    }
  });

  it('maps blocked prompts and non-STOP finish reasons to ProviderError', async () => {
    const blocked = makeProvider(200, { promptFeedback: { blockReason: 'SAFETY' } });
    await expect(blocked.provider.step(stepRequest())).rejects.toThrowError(/blocked the request: SAFETY/);

    const truncated = makeProvider(200, {
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }],
    });
    await expect(truncated.provider.step(stepRequest())).rejects.toThrowError(/incomplete: max_tokens/);
  });

  it('treats an empty response as an error', async () => {
    const { provider } = makeProvider(200, {
      candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
    });
    await expect(provider.step(stepRequest())).rejects.toThrowError(/empty response/);
  });

  it('propagates aborts unchanged', async () => {
    const controller = new AbortController();
    const abortingFetch = (async (_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    }) as typeof fetch;
    const provider = new GeminiProvider({
      model: 'gemini-2.5-flash',
      getApiKey: async () => FAKE_KEY,
      fetchImpl: abortingFetch,
    });
    setTimeout(() => controller.abort(), 50);
    await expect(
      provider.step(stepRequest({ signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

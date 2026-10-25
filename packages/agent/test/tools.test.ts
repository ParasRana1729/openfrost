import { describe, expect, it } from 'vitest';
import { createFetchPageTool } from '../src/index.js';
import type { FetchPageToolOptions } from '../src/index.js';
import type { RetrievalRecord } from '../src/tools/types.js';

const html = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const publicResolve = async (): Promise<string[]> => ['93.184.216.34'];

function scriptedFetch(
  handler: (url: string) => Response,
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(String(input));
    void init;
    return handler(String(input));
  };
  return { fetchImpl, calls };
}

function makeTool(options: FetchPageToolOptions = {}): {
  tool: ReturnType<typeof createFetchPageTool>;
  retrievals: RetrievalRecord[];
  signal: AbortSignal;
} {
  const retrievals: RetrievalRecord[] = [];
  return {
    tool: createFetchPageTool({ resolve: publicResolve, ...options }),
    retrievals,
    signal: new AbortController().signal,
  };
}

describe('fetch_page retrieval', () => {
  it('converts HTML to text, extracts the title, and records the retrieval', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      html(
        '<html><head><title>Example &amp; Co</title>' +
          '<style>body { color: red; }</style></head>' +
          '<body><script>alert("evil")</script>' +
          '<h1>Hello &lt;world&gt; &#39;quoted&#39;&nbsp;text</h1>' +
          '<p>Body paragraph &#x27;here&#x27;</p></body></html>',
      ),
    );
    const { tool, retrievals, signal } = makeTool({ fetchImpl });

    const result = await tool.execute(
      JSON.stringify({ url: 'https://example.com/page' }),
      { recordRetrieval: (r) => retrievals.push(r) },
      signal,
    );

    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content) as Record<string, unknown>;
    expect(payload.url).toBe('https://example.com/page');
    expect(payload.finalUrl).toBe('https://example.com/page');
    expect(payload.status).toBe(200);
    expect(payload.title).toBe('Example & Co');
    // The <title> text is part of the document, so it stays in the body text.
    expect(payload.text).toBe("Example & Co Hello <world> 'quoted' text Body paragraph 'here'");
    expect(payload.chars).toBe((payload.text as string).length);
    expect(typeof payload.ms).toBe('number');

    expect(retrievals).toHaveLength(1);
    expect(retrievals[0]).toMatchObject({
      url: 'https://example.com/page',
      finalUrl: 'https://example.com/page',
      status: 200,
    });
    expect(typeof retrievals[0]?.ms).toBe('number');
    expect(retrievals[0]?.chars).toBeGreaterThan(0);
    expect(retrievals[0]?.error).toBeUndefined();
  });

  it('follows redirects and records the final URL', async () => {
    const { fetchImpl, calls } = scriptedFetch((url) =>
      url === 'https://example.com/start'
        ? new Response(null, { status: 302, headers: { location: '/next' } })
        : html('<title>Next</title><body>Arrived</body>'),
    );
    const { tool, retrievals, signal } = makeTool({ fetchImpl });

    const result = await tool.execute(
      JSON.stringify({ url: 'https://example.com/start' }),
      { recordRetrieval: (r) => retrievals.push(r) },
      signal,
    );

    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content) as Record<string, unknown>;
    expect(payload.finalUrl).toBe('https://example.com/next');
    expect(calls).toEqual(['https://example.com/start', 'https://example.com/next']);
    expect(retrievals[0]?.finalUrl).toBe('https://example.com/next');
  });

  it('rejects a redirect to a private address without fetching it', async () => {
    const { fetchImpl, calls } = scriptedFetch(() =>
      new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/secret' } }),
    );
    const { tool, retrievals, signal } = makeTool({ fetchImpl });

    const result = await tool.execute(
      JSON.stringify({ url: 'https://example.com/redirect-out' }),
      { recordRetrieval: (r) => retrievals.push(r) },
      signal,
    );

    expect(result.ok).toBe(false);
    expect(result.content).toBe('Blocked: private address');
    expect(calls).toHaveLength(1); // the redirect target was never fetched
    expect(retrievals[0]?.status).toBe(302);
    expect(retrievals[0]?.error).toBe('Blocked: private address');
  });

  it('rejects too many redirects', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      new Response(null, { status: 302, headers: { location: '/loop' } }),
    );
    const { tool, signal } = makeTool({ fetchImpl, maxRedirects: 2 });

    const result = await tool.execute(
      JSON.stringify({ url: 'https://example.com/loop' }),
      { recordRetrieval: () => {} },
      signal,
    );

    expect(result.ok).toBe(false);
    expect(result.content).toBe('Unreachable: too many redirects');
  });
});

describe('fetch_page trust boundary', () => {
  it('blocks literal private and loopback IP addresses', async () => {
    const { fetchImpl, calls } = scriptedFetch(() => html('<body>never</body>'));
    const { tool, signal } = makeTool({ fetchImpl });

    for (const url of ['http://127.0.0.1/x', 'http://10.1.2.3/x', 'http://[::1]/x']) {
      const result = await tool.execute(JSON.stringify({ url }), { recordRetrieval: () => {} }, signal);
      expect(result.ok).toBe(false);
      expect(result.content).toBe('Blocked: private address');
    }
    expect(calls).toHaveLength(0);
  });

  it('blocks localhost-style and metadata hostnames', async () => {
    const { fetchImpl, calls } = scriptedFetch(() => html('<body>never</body>'));
    const { tool, signal } = makeTool({ fetchImpl });

    for (const url of [
      'http://localhost/',
      'http://api.localhost/',
      'http://printer.local/',
      'http://box.home.arpa/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata.goog/',
    ]) {
      const result = await tool.execute(JSON.stringify({ url }), { recordRetrieval: () => {} }, signal);
      expect(result.ok).toBe(false);
      expect(result.content).toContain('Blocked: host');
    }
    expect(calls).toHaveLength(0);
  });

  it('blocks non-http schemes and credential-bearing URLs', async () => {
    const { fetchImpl, calls } = scriptedFetch(() => html('<body>never</body>'));
    const { tool, signal } = makeTool({ fetchImpl });

    const ftp = await tool.execute(
      JSON.stringify({ url: 'ftp://example.com/file' }),
      { recordRetrieval: () => {} },
      signal,
    );
    expect(ftp.ok).toBe(false);
    expect(ftp.content).toBe('Blocked: ftp: URLs are not allowed');

    const creds = await tool.execute(
      JSON.stringify({ url: 'http://user:pass@example.com/' }),
      { recordRetrieval: () => {} },
      signal,
    );
    expect(creds.ok).toBe(false);
    expect(creds.content).toBe('Blocked: URLs with embedded credentials are not allowed');

    expect(calls).toHaveLength(0);
  });

  it('rejects DNS resolutions that include a private address', async () => {
    const { fetchImpl, calls } = scriptedFetch(() => html('<body>never</body>'));
    const resolve = async (): Promise<string[]> => ['93.184.216.34', '192.168.1.10'];
    const { tool, retrievals, signal } = makeTool({ fetchImpl, resolve });

    const result = await tool.execute(
      JSON.stringify({ url: 'https://example.com/rebind' }),
      { recordRetrieval: (r) => retrievals.push(r) },
      signal,
    );

    expect(result.ok).toBe(false);
    expect(result.content).toBe('Blocked: DNS resolved to a private address');
    expect(calls).toHaveLength(0);
    expect(retrievals[0]?.status).toBe(0);
    expect(retrievals[0]?.error).toBe('Blocked: DNS resolved to a private address');
  });

  it('rejects non-HTML content types', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      new Response('binary-ish', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    const { tool, retrievals, signal } = makeTool({ fetchImpl });

    const result = await tool.execute(
      JSON.stringify({ url: 'https://example.com/file' }),
      { recordRetrieval: (r) => retrievals.push(r) },
      signal,
    );

    expect(result.ok).toBe(false);
    expect(result.content).toBe('Unreachable: unsupported content type application/octet-stream');
    expect(retrievals[0]?.status).toBe(200);
  });

  it('aborts bodies that exceed the size cap', async () => {
    const { fetchImpl } = scriptedFetch(() => html(`<body>${'x'.repeat(500)}</body>`));
    const { tool, signal } = makeTool({ fetchImpl, maxBytes: 10 });

    const result = await tool.execute(
      JSON.stringify({ url: 'https://example.com/huge' }),
      { recordRetrieval: () => {} },
      signal,
    );

    expect(result.ok).toBe(false);
    expect(result.content).toBe('Unreachable: response body exceeds the 10 byte limit');
  });

  it('records failed retrievals with the HTTP status', async () => {
    const { fetchImpl } = scriptedFetch(() =>
      new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }),
    );
    const { tool, retrievals, signal } = makeTool({ fetchImpl });

    const result = await tool.execute(
      JSON.stringify({ url: 'https://example.com/broken' }),
      { recordRetrieval: (r) => retrievals.push(r) },
      signal,
    );

    expect(result.ok).toBe(false);
    expect(result.content).toBe('Unreachable: HTTP 500');
    expect(retrievals).toHaveLength(1);
    expect(retrievals[0]).toMatchObject({
      url: 'https://example.com/broken',
      finalUrl: 'https://example.com/broken',
      status: 500,
      chars: 0,
      error: 'Unreachable: HTTP 500',
    });
    expect(typeof retrievals[0]?.ms).toBe('number');
  });
});

import * as dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { isDeniedIp, isIpLiteral } from './ipGuard.js';
import type { AgentTool, RunToolContext } from './types.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 4;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: '\u00a0',
};

export interface FetchPageToolOptions {
  /** Default: node:dns promises lookup with { all: true, verbatim: true }. */
  resolve?: (host: string) => Promise<string[]>;
  /** Default: global fetch through the SSRF-guarded undici dispatcher. */
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  maxChars?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** A rejection that already carries its owner-facing reason and HTTP status. */
class FetchPageFailure extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'FetchPageFailure';
  }
}

interface ResolvedAddress {
  address: string;
  family: number;
}

function defaultResolve(host: string): Promise<string[]> {
  return dns.promises.lookup(host, { all: true, verbatim: true }).then((records) =>
    records.map((record) => record.address),
  );
}

/**
 * `fetch_page` retrieves one public http(s) page for the agent. This is the
 * retrieval trust boundary (spec §6): URLs are parsed and validated, hosts
 * are checked against a deny list, DNS results are validated address by
 * address, and every connection re-resolves and re-validates through a
 * guarded dispatcher so DNS rebinding between validation and connect fails
 * closed. Redirects are followed manually with full re-validation.
 */
export function createFetchPageTool(options: FetchPageToolOptions = {}): AgentTool {
  const resolve = options.resolve ?? defaultResolve;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let guardedAgent: Agent | null = null;

  /** Connect-time lookup: re-resolves and re-validates on every connection. */
  const guardedLookup: LookupFunction = (hostname, connectOptions, callback) => {
    void (async () => {
      try {
        const addresses = await resolveAndValidateAddresses(hostname);
        if (connectOptions.all === true) {
          callback(null, addresses);
        } else {
          const first = addresses[0];
          if (!first) {
            callback(new Error(`DNS returned no addresses for ${hostname}`), '');
            return;
          }
          callback(null, first.address, first.family);
        }
      } catch (err) {
        // The address argument is required by the lookup contract but is
        // never read when the error is set.
        callback(err instanceof Error ? err : new Error(String(err)), '');
      }
    })();
  };

  function dispatcher(): Agent {
    if (!guardedAgent) {
      guardedAgent = new Agent({
        connect: { lookup: guardedLookup },
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
    }
    return guardedAgent;
  }

  function reject(message: string, status = 0): never {
    throw new FetchPageFailure(message, status);
  }

  /** WHATWG URL serializes IPv6 hostnames with brackets; the guard logic and
   * DNS resolution want the bare address. */
  function urlHostname(url: URL): string {
    const hostname = url.hostname.toLowerCase();
    return hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  }

  /** Scheme, credential, hostname deny list, and IP-literal validation. */
  function validateUrl(raw: string, status = 0): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      reject('Blocked: invalid URL', status);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(`Blocked: ${url.protocol} URLs are not allowed`, status);
    }
    if (url.username.length > 0 || url.password.length > 0) {
      reject('Blocked: URLs with embedded credentials are not allowed', status);
    }
    const hostname = urlHostname(url);
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.home.arpa') ||
      hostname === 'metadata.google.internal' ||
      hostname === 'metadata.goog'
    ) {
      reject(`Blocked: host ${hostname} is not allowed`, status);
    }
    if (isIpLiteral(hostname) && isDeniedIp(hostname)) {
      reject('Blocked: private address', status);
    }
    return url;
  }

  /** Resolves a hostname and rejects unless every address is public. */
  async function resolveAndValidateAddresses(hostname: string): Promise<ResolvedAddress[]> {
    if (isIpLiteral(hostname)) {
      if (isDeniedIp(hostname)) {
        throw new Error(`Blocked: private address ${hostname}`);
      }
      return [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }];
    }
    let addresses: string[];
    try {
      addresses = await resolve(hostname);
    } catch {
      throw new Error(`DNS lookup failed for ${hostname}`);
    }
    if (addresses.length === 0) {
      throw new Error(`DNS returned no addresses for ${hostname}`);
    }
    for (const address of addresses) {
      if (isDeniedIp(address)) {
        throw new Error(`Blocked: DNS resolved ${hostname} to a private address`);
      }
    }
    return addresses.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }));
  }

  async function closeBody(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // Best effort; the connection is dropped either way.
    }
  }

  function parseArgs(argsJson: string): { url: string } | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsJson);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return typeof record.url === 'string' && record.url.length > 0 ? { url: record.url } : null;
  }

  return {
    definition: {
      name: 'fetch_page',
      description:
        'Retrieve one public http(s) page as plain text. Use it to read source ' +
        'material for the brief. One URL per call; the URL must be reachable ' +
        'from the public internet.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
        additionalProperties: false,
      },
    },

    async execute(
      argsJson: string,
      ctx: RunToolContext,
      signal: AbortSignal,
    ): Promise<{ ok: boolean; content: string }> {
      const startedAt = Date.now();
      const elapsed = () => Date.now() - startedAt;

      const args = parseArgs(argsJson);
      if (!args) {
        return { ok: false, content: 'Invalid arguments: expected { "url": string }' };
      }
      const requestedUrl = args.url;

      try {
        const result = await fetchDocument(requestedUrl, signal, startedAt);
        ctx.recordRetrieval({
          url: requestedUrl,
          finalUrl: result.finalUrl,
          status: result.status,
          ms: elapsed(),
          chars: result.chars,
        });
        return { ok: true, content: JSON.stringify(result.payload) };
      } catch (err) {
        const failure =
          err instanceof FetchPageFailure
            ? err
            : new FetchPageFailure(
                `Unreachable: ${err instanceof Error ? err.message : String(err)}`,
                0,
              );
        ctx.recordRetrieval({
          url: requestedUrl,
          finalUrl: requestedUrl,
          status: failure.httpStatus,
          ms: elapsed(),
          chars: 0,
          error: failure.message,
        });
        return { ok: false, content: failure.message };
      }
    },
  };

  async function fetchDocument(
    requestedUrl: string,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<{ payload: Record<string, unknown>; finalUrl: string; status: number; chars: number }> {
    // The overall deadline combines the run signal with the per-fetch timeout.
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    let lastStatus = 0;

    try {
      let current = validateUrl(requestedUrl);
      const initialHostname = urlHostname(current);
      if (!isIpLiteral(initialHostname)) {
        await validateDns(initialHostname);
      }

      let redirects = 0;
      let response: Response;
      for (;;) {
        response = await doFetch(current.href, deadline);
        lastStatus = response.status;
        if (!REDIRECT_STATUSES.has(response.status)) {
          break;
        }
        redirects += 1;
        if (redirects > maxRedirects) {
          reject('Unreachable: too many redirects', lastStatus);
        }
        const location = response.headers.get('location');
        await closeBody(response);
        if (!location) {
          reject(`Unreachable: HTTP ${response.status} redirect without Location`, lastStatus);
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          reject('Unreachable: invalid redirect target', lastStatus);
        }
        // The target is re-validated completely; DNS is re-checked at connect.
        current = validateUrl(next.href, lastStatus);
      }

      if (response.status >= 400) {
        reject(`Unreachable: HTTP ${response.status}`, lastStatus);
      }
      const contentType = response.headers.get('content-type') ?? '';
      const baseType = (contentType.split(';')[0] ?? '').trim().toLowerCase();
      const isHtml = baseType.includes('html');
      const allowedType =
        baseType.startsWith('text/') ||
        baseType === 'application/xhtml+xml' ||
        baseType === 'application/json';
      if (!allowedType) {
        reject(`Unreachable: unsupported content type ${baseType || 'unknown'}`, lastStatus);
      }

      const raw = await readBody(response, deadline, lastStatus);
      const fullText = isHtml ? htmlToText(raw) : raw.trim();
      const text = fullText.length > maxChars ? fullText.slice(0, maxChars) : fullText;
      const title = isHtml ? extractTitle(raw) : '';

      return {
        payload: {
          url: requestedUrl,
          finalUrl: current.href,
          status: response.status,
          ms: Date.now() - startedAt,
          title,
          chars: text.length,
          text,
        },
        finalUrl: current.href,
        status: response.status,
        chars: text.length,
      };
    } catch (err) {
      if (err instanceof FetchPageFailure) {
        throw err;
      }
      if (err instanceof Error && err.name === 'TimeoutError') {
        reject(`Unreachable: timed out after ${timeoutMs} ms`, lastStatus);
      }
      if (err instanceof Error && err.name === 'AbortError') {
        reject('Unreachable: aborted', lastStatus);
      }
      throw err;
    }
  }

  async function doFetch(url: string, deadline: AbortSignal): Promise<Response> {
    const init: RequestInit = {
      method: 'GET',
      redirect: 'manual',
      signal: deadline,
      headers: {
        accept: 'text/html, application/xhtml+xml, application/json;q=0.9, text/*;q=0.8',
      },
    };
    if (options.fetchImpl === undefined) {
      // Node's fetch reads undici's `dispatcher` init option at runtime; the
      // shared RequestInit type types it as a foreign Dispatcher interface,
      // so attach the guarded agent loosely instead of casting types away.
      (init as { dispatcher?: unknown }).dispatcher = dispatcher();
    }
    return fetchImpl(url, init);
  }

  async function validateDns(hostname: string): Promise<void> {
    let addresses: string[];
    try {
      addresses = await resolve(hostname);
    } catch {
      reject(`Unreachable: DNS lookup failed for ${hostname}`);
    }
    if (addresses.length === 0) {
      reject(`Unreachable: DNS returned no addresses for ${hostname}`);
    }
    for (const address of addresses) {
      if (isDeniedIp(address)) {
        reject('Blocked: DNS resolved to a private address');
      }
    }
  }

  async function readBody(response: Response, deadline: AbortSignal, lastStatus: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      return '';
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) {
          break;
        }
        total += value.byteLength;
        if (total > maxBytes) {
          reject(`Unreachable: response body exceeds the ${maxBytes} byte limit`, lastStatus);
        }
        chunks.push(value);
      }
    } catch (err) {
      if (deadline.aborted && err instanceof Error && err.name === 'TimeoutError') {
        reject(`Unreachable: timed out after ${timeoutMs} ms`, lastStatus);
      }
      throw err;
    } finally {
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
      }
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
  }
}

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(?:script|style)\b[^>]*\/?>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]*>/g, ' ');
  return collapseWhitespace(decodeEntities(withoutTags));
}

function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return match?.[1] ? collapseWhitespace(decodeEntities(match[1])) : '';
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => fromCodePoint(parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|nbsp);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match)
    .replace(/&amp;/g, '&');
}

function fromCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino, { type Logger } from 'pino';
import { createStore, openDatabase, type OpenDatabaseResult, type Store } from '@openfrost/db';
import { FakeProvider, type ScriptedStep } from '@openfrost/agent';
import { buildApp, closeBuiltApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { EventBus } from '../src/bus.js';

export const ALLOWED_ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'a-long-local-passphrase';

export class LogCapture {
  readonly lines: string[] = [];
  readonly logger: Logger;

  constructor() {
    const stream = {
      write: (line: string): void => {
        this.lines.push(line);
      },
    };
    this.logger = pino(stream as object);
  }

  contains(needle: string): boolean {
    return this.lines.some((line) => line.includes(needle));
  }
}

export interface TestApp {
  built: BuiltApp;
  store: Store;
  provider: FakeProvider;
  logs: LogCapture;
  home: string;
  opened: OpenDatabaseResult;
  cookie: string | null;
  csrfToken: string | null;
  close(): Promise<void>;
}

export interface TestAppOptions {
  steps?: ScriptedStep[];
  store?: Store;
  withDatabase?: OpenDatabaseResult;
  /** Injected clock for time-dependent suites (routines, expiries). */
  now?: () => string;
}

export async function startApp(options: TestAppOptions = {}): Promise<TestApp> {
  const home = mkdtempSync(join(tmpdir(), 'openfrost-api-test-'));
  const opened = options.withDatabase ?? openDatabase(home);
  const bus = new EventBus();
  const store =
    options.store ??
    createStore(opened.db, {
      home: opened.home,
      onEvent: (event) => bus.publish(event),
    });
  const provider = new FakeProvider(options.steps ?? [{ type: 'final', text: 'api result' }]);
  const logs = new LogCapture();
  const config = { ...loadConfig({}), homeDir: home, port: 0 };
  const built = await buildApp(
    { config, provider, store, bus, now: options.now },
    logs.logger,
  );

  return {
    built,
    store,
    provider,
    logs,
    home,
    opened,
    cookie: null,
    csrfToken: null,
    async close() {
      await closeBuiltApp(built);
      opened.sqlite.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Cookie jar + CSRF helpers for inject()-based tests. */
export function jarHeaders(app: TestApp): Record<string, string> {
  const headers: Record<string, string> = {};
  if (app.cookie) {
    headers.cookie = app.cookie;
  }
  if (app.csrfToken) {
    headers['x-csrf-token'] = app.csrfToken;
  }
  return headers;
}

export async function setupOwner(app: TestApp): Promise<void> {
  const res = await app.built.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'owner', password: PASSWORD },
  });
  if (res.statusCode !== 201) {
    throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
  }
  const setCookie = res.headers['set-cookie'];
  app.cookie = firstCookie(setCookie);
  app.csrfToken = res.json().csrfToken as string;
}

export async function login(app: TestApp, password = PASSWORD): Promise<number> {
  const res = await app.built.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'owner', password },
  });
  if (res.statusCode === 200) {
    app.cookie = firstCookie(res.headers['set-cookie']);
    app.csrfToken = res.json().csrfToken as string;
  }
  return res.statusCode;
}

function firstCookie(setCookie: unknown): string | null {
  if (Array.isArray(setCookie) && setCookie.length > 0) {
    return String(setCookie[0]).split(';')[0] ?? null;
  }
  if (typeof setCookie === 'string') {
    return setCookie.split(';')[0] ?? null;
  }
  return null;
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not met before timeout');
}

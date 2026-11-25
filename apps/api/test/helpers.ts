import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino, { type Logger } from 'pino';
import { createStore, openDatabase, type OpenDatabaseResult, type Store } from '@openfrost/db';
import { FakeProvider, type ScriptedStep } from '@openfrost/agent';
import { buildApp, closeBuiltApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { EventBus } from '../src/bus.js';

export class LogCapture {
  readonly lines: string[] = [];
  readonly logger: Logger;

  constructor() {
    const stream = {
      write: (line: string): void => {
        this.lines.push(line);
      },
    };
    this.logger = pino({}, stream);
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
    async close() {
      await closeBuiltApp(built);
      opened.sqlite.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not met before timeout');
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionLimits, RunState } from '@openfrost/domain';
import { createStore, openDatabase, type Store } from '@openfrost/db';
import { FakeProvider, TaskExecutor } from '../src/index.js';

const T0 = Date.parse('2026-10-23T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const limits: ExecutionLimits = {
  maxSteps: 3,
  maxWallClockMs: 60_000,
  maxInputChars: 500,
  maxOutputChars: 5_000,
};

let home: string;
let opened: ReturnType<typeof openDatabase>;
let store: Store;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-failures-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db, { home: opened.home });
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
});

describe('executor error paths', () => {
  it('reconciles an orphaned running run when finalization itself fails', async () => {
    // Simulate a store failure exactly at run finalization: any 'failed'
    // finish throws, so finalizeFailure escapes #executeTask and the drain
    // catch must reconcile the still-running pair.
    const flakyStore: Store = {
      ...store,
      runs: {
        ...store.runs,
        finish(
          id: string,
          to: RunState,
          now: string,
          details?: Parameters<Store['runs']['finish']>[3],
        ) {
          if (to === 'failed') {
            throw new Error('store failure at finalization');
          }
          return store.runs.finish(id, to, now, details);
        },
      },
    };
    const executor = new TaskExecutor({
      store: flakyStore,
      provider: new FakeProvider([
        { type: 'error', message: 'provider boom' },
        { type: 'final', text: 'queue continues' },
      ]),
      limits,
      now: () => at(0),
    });

    const doomed = await executor.enqueue({ title: 'Doomed', request: 'request' });
    const survivor = await executor.enqueue({ title: 'Survivor', request: 'request' });
    await executor.whenIdle();

    expect(store.tasks.get(doomed.id)?.state).toBe('interrupted');
    const run = store.runs.listForTask(doomed.id)[0];
    expect(run?.state).toBe('interrupted');
    expect(store.tasks.get(survivor.id)?.state).toBe('completed');
  });

  it('finalizes the run as failed when artifact persistence fails', async () => {
    const failingStore: Store = {
      ...store,
      artifacts: {
        ...store.artifacts,
        create: () => {
          throw new Error('artifact io failure');
        },
      },
    };
    const executor = new TaskExecutor({
      store: failingStore,
      provider: new FakeProvider([{ type: 'final', text: 'unsaveable result' }]),
      limits,
      now: () => at(0),
    });

    const task = await executor.enqueue({ title: 'Artifact', request: 'request' });
    await executor.whenIdle();

    const run = store.runs.listForTask(task.id)[0];
    expect(run?.state).toBe('failed');
    expect(run?.failure).toMatchObject({ code: 'internal' });
    const failedTask = store.tasks.get(task.id);
    expect(failedTask?.state).toBe('failed');
    expect(failedTask?.error).toContain('artifact io failure');
    // The queue is not wedged by the persistence failure.
    const executor2 = new TaskExecutor({
      store,
      provider: new FakeProvider([{ type: 'final', text: 'ok' }]),
      limits,
      now: () => at(0),
    });
    executor2.requeue(task.id);
    await executor2.whenIdle();
    expect(store.tasks.get(task.id)?.state).toBe('completed');
  });

  it('aborts a hung provider call at the wall-clock limit', async () => {
    const provider = new FakeProvider([{ type: 'hang', ms: 30_000 }]);
    const executor = new TaskExecutor({
      store,
      provider,
      limits: { ...limits, maxWallClockMs: 80 },
      now: () => at(0),
    });

    const task = await executor.enqueue({ title: 'Hung call', request: 'request' });
    await executor.whenIdle();

    expect(provider.abortedCalls).toBe(1);
    const run = store.runs.listForTask(task.id)[0];
    expect(run?.state).toBe('failed');
    expect(run?.failure).toMatchObject({ code: 'limit_reached', limitHit: 'wall_clock' });
    expect(store.tasks.get(task.id)?.state).toBe('failed');
  });

  it('purges expired sessions during recovery', () => {
    const owner = store.users.createOwner('owner', 'a-long-passphrase', at(0));
    store.sessions.create({
      userId: owner.id,
      csrfToken: 't',
      expiresAt: '2020-01-01T00:00:00.000Z',
      now: at(0),
    });
    const live = store.sessions.create({
      userId: owner.id,
      csrfToken: 't2',
      expiresAt: '2099-01-01T00:00:00.000Z',
      now: at(0),
    });

    const executor = new TaskExecutor({
      store,
      provider: new FakeProvider([]),
      limits,
      now: () => at(0),
    });
    executor.recover();

    expect(store.sessions.get(live.id)).not.toBeNull();
    expect(store.state.getValue('dispatch.paused')).not.toBe('true');
    // The only remaining sessions are live ones; the expired row is gone.
    const raw = opened.sqlite
      .prepare('SELECT COUNT(*) AS n FROM sessions')
      .get() as { n: number };
    expect(raw.n).toBe(1);
  });
});

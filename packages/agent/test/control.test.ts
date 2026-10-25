import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionLimits } from '@openfrost/domain';
import { createStore, openDatabase, type OpenDatabaseResult, type Store } from '@openfrost/db';
import { FakeProvider, TaskExecutor } from '../src/index.js';

const T0 = Date.parse('2026-10-23T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const limits: ExecutionLimits = {
  maxSteps: 3,
  maxWallClockMs: 60_000,
  maxInputChars: 500,
  maxOutputChars: 5_000,
};

const settle = (ms = 50): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let home: string;
let opened: OpenDatabaseResult;
let store: Store;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-control-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
});

function makeExecutor(steps: ConstructorParameters<typeof FakeProvider>[0]): TaskExecutor {
  return new TaskExecutor({
    store,
    provider: new FakeProvider(steps),
    limits,
    now: () => at(0),
  });
}

describe('cancellation', () => {
  it('cancels a queued task without ever running it', async () => {
    const executor = makeExecutor([
      { type: 'hang', ms: 5_000 },
      { type: 'final', text: 'should not run' },
    ]);
    const occupying = await executor.enqueue({ title: 'Occupying', request: 'request' });
    const queued = await executor.enqueue({ title: 'Queued', request: 'request' });
    await settle();

    const canceled = executor.cancel(queued.id);
    expect(canceled.state).toBe('canceled');
    expect(store.runs.listForTask(queued.id)).toHaveLength(0);

    executor.cancel(occupying.id);
    await executor.whenIdle();
    expect(store.tasks.get(queued.id)?.state).toBe('canceled');
  });

  it('aborts an in-flight run and frees the executor for queued work', async () => {
    const provider = new FakeProvider([
      { type: 'hang', ms: 30_000 },
      { type: 'final', text: 'next in line' },
    ]);
    const executor = new TaskExecutor({
      store,
      provider,
      limits,
      now: () => at(0),
    });
    const active = await executor.enqueue({ title: 'Active', request: 'request' });
    const waiting = await executor.enqueue({ title: 'Waiting', request: 'request' });
    await settle();
    expect(store.tasks.get(active.id)?.state).toBe('running');
    expect(provider.calls).toHaveLength(1);

    const canceled = executor.cancel(active.id);
    expect(canceled.state).toBe('running'); // finalized asynchronously
    await executor.whenIdle();

    expect(provider.abortedCalls).toBe(1);
    expect(provider.calls).toHaveLength(2); // the freed slot ran the next task
    expect(store.tasks.get(active.id)?.state).toBe('canceled');
    const run = store.runs.listForTask(active.id)[0];
    expect(run?.state).toBe('canceled');
    expect(store.tasks.get(waiting.id)?.state).toBe('completed');
  });

  it('is a no-op for terminal tasks', async () => {
    const executor = makeExecutor([{ type: 'final', text: 'done' }]);
    const task = await executor.enqueue({ title: 'Done', request: 'request' });
    await executor.whenIdle();
    expect(executor.cancel(task.id).state).toBe('completed');
  });
});

describe('restart recovery', () => {
  it('marks unfinished runs interrupted, keeps queued work, and pauses dispatch until the owner resumes', async () => {
    // Simulate a hard crash: a task+run stuck in `running`.
    const crashed = store.tasks.create({ title: 'Crashed', request: 'r' }, at(0));
    store.tasks.startRun(crashed.id, at(0));
    const queued = store.tasks.create({ title: 'Queued', request: 'r' }, at(1));

    const executor = makeExecutor([
      { type: 'final', text: 'after recovery' },
      { type: 'final', text: 'requeued after interruption' },
    ]);
    const result = executor.recover();
    expect(result.interruptedRuns).toBe(1);
    expect(result.dispatchPaused).toBe(true);
    expect(store.tasks.get(crashed.id)?.state).toBe('interrupted');
    expect(store.runs.listForTask(crashed.id)[0]?.state).toBe('interrupted');
    expect(store.events.listRecent(10).map((e) => e.type)).toContain('dispatch.paused');

    // Queued work is retained but not dispatched while paused.
    void executor.kick();
    await settle();
    expect(store.tasks.get(queued.id)?.state).toBe('queued');

    // Owner reviews and resumes; only then does dispatch continue.
    executor.resumeDispatch();
    await executor.whenIdle();
    expect(store.tasks.get(queued.id)?.state).toBe('completed');
    expect(store.tasks.get(crashed.id)?.state).toBe('interrupted');

    // The owner can explicitly requeue the interrupted task.
    executor.requeue(crashed.id);
    await executor.whenIdle();
    expect(store.tasks.get(crashed.id)?.state).toBe('completed');
  });

  it('shutdown interrupts the in-flight run; a fresh start does not double-mark it', async () => {
    const executor = makeExecutor([{ type: 'hang', ms: 30_000 }]);
    const task = await executor.enqueue({ title: 'Shutdown', request: 'request' });
    await settle();
    expect(store.tasks.get(task.id)?.state).toBe('running');

    await executor.stop();
    expect(store.tasks.get(task.id)?.state).toBe('interrupted');
    expect(store.runs.listForTask(task.id)[0]?.state).toBe('interrupted');
    expect(executor.isDispatchPaused()).toBe(true);

    const fresh = makeExecutor([{ type: 'final', text: 'x' }]);
    const result = fresh.recover();
    expect(result.interruptedRuns).toBe(0);
    expect(result.dispatchPaused).toBe(true);
  });

  it('a clean restart leaves dispatch unpaused', async () => {
    const executor = makeExecutor([{ type: 'final', text: 'x' }]);
    const result = executor.recover();
    expect(result.interruptedRuns).toBe(0);
    expect(result.dispatchPaused).toBe(false);

    const task = await executor.enqueue({ title: 'After clean recover', request: 'request' });
    await executor.whenIdle();
    expect(store.tasks.get(task.id)?.state).toBe('completed');
  });
});

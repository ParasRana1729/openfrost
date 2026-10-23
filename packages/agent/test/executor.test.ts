import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecutionLimits } from '@openfrost/domain';
import { createStore, openDatabase, type OpenDatabaseResult, type Store } from '@openfrost/db';
import { FakeProvider, TaskExecutor } from '../src/index.js';

const T0 = Date.parse('2026-10-23T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const tightLimits: ExecutionLimits = {
  maxSteps: 3,
  maxWallClockMs: 60_000,
  maxInputChars: 500,
  maxOutputChars: 5_000,
};

let home: string;
let opened: OpenDatabaseResult;
let store: Store;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-agent-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db);
});

afterAll(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
});

function makeExecutor(steps: ConstructorParameters<typeof FakeProvider>[0], limits?: ExecutionLimits): TaskExecutor {
  return new TaskExecutor({
    store,
    provider: new FakeProvider(steps),
    limits: limits ?? tightLimits,
    now: () => at(0),
  });
}

describe('queue ordering and completion', () => {
  it('processes queued tasks one at a time in FIFO order', async () => {
    const executor = makeExecutor([
      { type: 'final', text: 'result for alpha' },
      { type: 'final', text: 'result for beta' },
      { type: 'final', text: 'result for gamma' },
    ]);
    const alpha = await executor.enqueue('Alpha', 'request alpha');
    const beta = await executor.enqueue('Beta', 'request beta');
    const gamma = await executor.enqueue('Gamma', 'request gamma');
    await executor.whenIdle();

    expect(store.tasks.get(alpha.id)?.state).toBe('completed');
    expect(store.tasks.get(beta.id)?.state).toBe('completed');
    expect(store.tasks.get(gamma.id)?.state).toBe('completed');

    const started = store.events
      .listRecent(50)
      .filter((e) => e.type === 'run.started')
      .sort((a, b) => a.id - b.id)
      .map((e) => e.taskId);
    expect(started).toEqual([alpha.id, beta.id, gamma.id]);

    for (const task of [alpha, beta, gamma]) {
      const artifact = store.artifacts.latestForTask(task.id);
      expect(artifact).not.toBeNull();
      expect(artifact?.markdown).toContain(`# ${store.tasks.get(task.id)?.title}`);
    }
    expect(store.artifacts.latestForTask(alpha.id)?.markdown).toContain('result for alpha');
  });

  it('records tool executions at the auto risk tier', async () => {
    const executor = makeExecutor([{ type: 'final', text: 'ok' }]);
    const task = await executor.enqueue('Tools', 'request');
    await executor.whenIdle();
    const toolEvents = store.events
      .listForTask(task.id)
      .filter((e) => e.type === 'tool.executed');
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]?.payload).toMatchObject({ tool: 'fake.echo', riskTier: 'auto', step: 1 });
  });

  it('keeps retry history visible across explicit attempts', async () => {
    const executor = makeExecutor([
      { type: 'error', message: 'transient failure' },
      { type: 'final', text: 'second attempt works' },
    ]);
    const task = await executor.enqueue('Retry', 'request');
    await executor.whenIdle();
    expect(store.tasks.get(task.id)?.state).toBe('failed');

    executor.requeue(task.id);
    await executor.whenIdle();
    const runs = store.runs.listForTask(task.id);
    expect(runs.map((r) => r.attempt)).toEqual([1, 2]);
    expect(runs[0]?.failure?.code).toBe('provider_error');
    expect(runs[1]?.state).toBe('completed');
    expect(store.tasks.get(task.id)?.state).toBe('completed');
  });
});

describe('failures do not wedge the queue', () => {
  it('moves on to the next task after a provider failure', async () => {
    const executor = makeExecutor([
      { type: 'error', message: 'provider exploded' },
      { type: 'final', text: 'still works' },
    ]);
    const doomed = await executor.enqueue('Doomed', 'request');
    const survivor = await executor.enqueue('Survivor', 'request');
    await executor.whenIdle();

    const failedTask = store.tasks.get(doomed.id);
    expect(failedTask?.state).toBe('failed');
    expect(failedTask?.error).toContain('provider exploded');
    expect(store.runs.listForTask(doomed.id)[0]?.failure?.code).toBe('provider_error');
    expect(store.tasks.get(survivor.id)?.state).toBe('completed');
  });

  it('fails honestly when no provider is configured (S02 wires OpenAI)', async () => {
    const executor = new TaskExecutor({ store, provider: null, limits: tightLimits, now: () => at(0) });
    const task = await executor.enqueue('No provider', 'request');
    await executor.whenIdle();
    const run = store.runs.listForTask(task.id)[0];
    expect(run?.failure?.code).toBe('provider_missing');
    expect(store.tasks.get(task.id)?.state).toBe('failed');
    expect(store.tasks.get(task.id)?.error).toContain('S02');
  });
});

describe('finite limits stop runs with a clear result', () => {
  it('stops at the step limit', async () => {
    const executor = makeExecutor([
      { type: 'continue' },
      { type: 'continue' },
      { type: 'continue' },
      { type: 'continue' },
    ]);
    const task = await executor.enqueue('Steps', 'request');
    await executor.whenIdle();
    const run = store.runs.listForTask(task.id)[0];
    expect(run?.failure).toMatchObject({ code: 'limit_reached', limitHit: 'max_steps' });
    expect(store.tasks.get(task.id)?.state).toBe('failed');
    expect(store.events.listForTask(task.id).map((e) => e.type)).toContain('run.limit_reached');
  });

  it('stops at the wall-clock limit', async () => {
    const executor = makeExecutor(
      [
        { type: 'continue', delayMs: 120 },
        { type: 'continue' },
      ],
      { ...tightLimits, maxWallClockMs: 40 },
    );
    const task = await executor.enqueue('Clock', 'request');
    await executor.whenIdle();
    const run = store.runs.listForTask(task.id)[0];
    expect(run?.failure).toMatchObject({ code: 'limit_reached', limitHit: 'wall_clock' });
    expect(store.tasks.get(task.id)?.state).toBe('failed');
  });

  it('rejects oversized input before calling the provider', async () => {
    const provider = new FakeProvider([{ type: 'final', text: 'never reached' }]);
    const executor = new TaskExecutor({
      store,
      provider,
      limits: { ...tightLimits, maxInputChars: 50 },
      now: () => at(0),
    });
    const task = await executor.enqueue('Too big', 'x'.repeat(120));
    await executor.whenIdle();
    expect(provider.calls).toHaveLength(0);
    const run = store.runs.listForTask(task.id)[0];
    expect(run?.failure).toMatchObject({ code: 'limit_reached', limitHit: 'max_input' });
  });

  it('stops oversized output', async () => {
    const executor = makeExecutor(
      [{ type: 'final', text: 'y'.repeat(6_000) }],
      tightLimits,
    );
    const task = await executor.enqueue('Big output', 'request');
    await executor.whenIdle();
    const run = store.runs.listForTask(task.id)[0];
    expect(run?.failure).toMatchObject({ code: 'limit_reached', limitHit: 'max_output' });
    expect(store.artifacts.latestForTask(task.id)).toBeNull();
  });
});

describe('one run owns the executor at a time', () => {
  it('does not start a second task while one hangs', async () => {
    const executor = makeExecutor([
      { type: 'hang', ms: 5_000 },
      { type: 'final', text: 'after' },
    ]);
    const hanging = await executor.enqueue('Hanging', 'request');
    const waiting = await executor.enqueue('Waiting', 'request');

    // Let the drain loop start the hanging run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.tasks.get(hanging.id)?.state).toBe('running');
    expect(store.tasks.get(waiting.id)?.state).toBe('queued');

    // A second kick must not start the waiting task.
    void executor.kick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.tasks.get(waiting.id)?.state).toBe('queued');
    expect(store.runs.listForTask(waiting.id)).toHaveLength(0);

    executor.cancel(hanging.id);
    await executor.whenIdle();
    expect(store.tasks.get(hanging.id)?.state).toBe('canceled');
    expect(store.tasks.get(waiting.id)?.state).toBe('completed');
  });
});

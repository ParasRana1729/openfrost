import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '@openfrost/domain';
import {
  createStore,
  openDatabase,
  type OpenDatabaseResult,
  type Store,
} from '../src/index.js';

const T0 = Date.parse('2026-10-23T12:00:00.000Z');
/** Distinct timestamps keep FIFO ordering deterministic in tests. */
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

let home: string;
let opened: OpenDatabaseResult;
let store: Store;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-tasks-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db, { home: opened.home });
});

afterAll(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
});

describe('task lifecycle through the store', () => {
  it('creates a queued task and lists queued work FIFO', () => {
    const first = store.tasks.create({ title: 'First', request: 'a' }, at(0));
    const second = store.tasks.create({ title: 'Second', request: 'b' }, at(1));
    expect(first.state).toBe('queued');
    expect(store.tasks.listQueued().map((t) => t.id)).toEqual([first.id, second.id]);
  });

  it('breaks FIFO ties by insertion order when timestamps collide', () => {
    // Same millisecond: uuid ordering would be random, insertion order is
    // not. Fresh store so earlier tests' queued tasks cannot interfere.
    const tieHome = mkdtempSync(join(tmpdir(), 'openfrost-tie-test-'));
    const tieOpened = openDatabase(tieHome);
    const tieStore = createStore(tieOpened.db, { home: tieOpened.home });
    try {
      const first = tieStore.tasks.create({ title: 'A', request: 'x' }, at(5));
      const second = tieStore.tasks.create({ title: 'B', request: 'x' }, at(5));
      const third = tieStore.tasks.create({ title: 'C', request: 'x' }, at(5));
      expect(tieStore.tasks.listQueued().map((t) => t.id)).toEqual([
        first.id,
        second.id,
        third.id,
      ]);
    } finally {
      tieOpened.sqlite.close();
      rmSync(tieHome, { recursive: true, force: true });
    }
  });

  it('persists constraints and starting urls with the task', () => {
    const task = store.tasks.create(
      {
        title: 'Sourced',
        request: 'Compare A and B',
        constraints: 'Local-first storage preferred.',
        startingUrls: ['https://a.example/', 'https://b.example/'],
      },
      at(2),
    );
    const read = store.tasks.get(task.id);
    expect(read?.constraints).toBe('Local-first storage preferred.');
    expect(read?.startingUrls).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('startRun claims a queued task atomically and counts attempts', () => {
    const task = store.tasks.create({ title: 'Run me', request: 'x' }, at(0));
    const { task: claimed, run } = store.tasks.startRun(task.id, at(0));
    expect(claimed.state).toBe('running');
    expect(claimed.attemptCount).toBe(1);
    expect(claimed.lastRunId).toBe(run.id);
    expect(run.attempt).toBe(1);
    expect(run.state).toBe('running');

    expect(() => store.tasks.startRun(task.id, at(0))).toThrowError(InvalidTransitionError);
  });

  it('rejects transitions that violate the domain contract', () => {
    const task = store.tasks.create({ title: 'Invalid', request: 'x' }, at(0));
    expect(() => store.tasks.transition(task.id, 'completed', at(0))).toThrowError(
      InvalidTransitionError,
    );
    expect(store.tasks.get(task.id)?.state).toBe('queued');
  });

  it('supports the full happy path with a result artifact', () => {
    const task = store.tasks.create({ title: 'Happy', request: 'x' }, at(0));
    const { run } = store.tasks.startRun(task.id, at(0));
    const artifact = store.artifacts.create(task.id, '# Done', at(0));
    store.runs.finish(run.id, 'completed', at(0), {
      usage: { steps: 1, inputChars: 1, outputChars: 6 },
    });
    const done = store.tasks.transition(task.id, 'completed', at(0), {
      resultArtifactId: artifact.id,
    });
    expect(done.state).toBe('completed');
    expect(done.resultArtifactId).toBe(artifact.id);
    expect(store.artifacts.latestForTask(task.id)?.id).toBe(artifact.id);
  });

  it('records failure details on the run and task', () => {
    const task = store.tasks.create({ title: 'Sad', request: 'x' }, at(0));
    const { run } = store.tasks.startRun(task.id, at(0));
    store.runs.finish(run.id, 'failed', at(0), {
      failure: { code: 'provider_error', message: 'boom', limitHit: null },
    });
    const failed = store.tasks.transition(task.id, 'failed', at(0), {
      error: 'Run failed: boom',
    });
    expect(failed.state).toBe('failed');
    expect(failed.error).toBe('Run failed: boom');
    expect(store.runs.get(run.id)?.failure?.code).toBe('provider_error');
  });

  it('requeues failed tasks for an explicit retry attempt', () => {
    const task = store.tasks.create({ title: 'Retry', request: 'x' }, at(0));
    const firstRun = store.tasks.startRun(task.id, at(0));
    store.runs.finish(firstRun.run.id, 'failed', at(0), {
      failure: { code: 'provider_error', message: 'boom', limitHit: null },
    });
    store.tasks.transition(task.id, 'failed', at(0), { error: 'failed once' });

    const requeued = store.tasks.transition(task.id, 'queued', at(0), { error: null });
    expect(requeued.state).toBe('queued');

    const second = store.tasks.startRun(task.id, at(0));
    expect(second.run.attempt).toBe(2);
    expect(store.runs.listForTask(task.id).map((r) => r.attempt)).toEqual([1, 2]);
  });

  it('cancels a queued task without creating a run', () => {
    const task = store.tasks.create({ title: 'Cancel', request: 'x' }, at(0));
    const canceled = store.tasks.transition(task.id, 'canceled', at(0));
    expect(canceled.state).toBe('canceled');
    expect(store.runs.listForTask(task.id)).toHaveLength(0);
  });

  it('interrupts a running task for restart recovery', () => {
    const task = store.tasks.create({ title: 'Crash', request: 'x' }, at(0));
    const { run } = store.tasks.startRun(task.id, at(0));
    store.runs.finish(run.id, 'interrupted', at(0));
    const interrupted = store.tasks.transition(task.id, 'interrupted', at(0));
    expect(interrupted.state).toBe('interrupted');
    expect(store.tasks.listByStates(['interrupted']).map((t) => t.id)).toContain(task.id);
  });

  it('notifies an onEvent listener for every appended event', () => {
    const seen: string[] = [];
    const watched = mkdtempSync(join(tmpdir(), 'openfrost-events-test-'));
    const openedWatched = openDatabase(watched);
    const watchedStore = createStore(openedWatched.db, {
      home: openedWatched.home,
      onEvent: (event) => seen.push(event.type),
    });
    try {
      watchedStore.events.append('task.created', {}, at(0));
      watchedStore.events.append('task.completed', {}, at(0));
      expect(seen).toEqual(['task.created', 'task.completed']);
    } finally {
      openedWatched.sqlite.close();
      rmSync(watched, { recursive: true, force: true });
    }
  });
});

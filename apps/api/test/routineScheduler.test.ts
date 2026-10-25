import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ROUTINE_LATE_GRACE_MS,
  InvalidRoutineOccurrenceTransitionError,
  type Project,
  type Routine,
} from '@openfrost/domain';
import { createStore, openDatabase, type OpenDatabaseResult, type Store } from '@openfrost/db';
import { TaskExecutor, type LlmProvider } from '@openfrost/agent';
import { RoutineScheduler } from '../src/routineScheduler.js';

let home: string;
let opened: OpenDatabaseResult;
let store: Store;
/** Mutable fake clock: every scheduler/executor timestamp derives from it. */
let clockMs: number;

beforeEach(() => {
  // Hermetic store per test: a shared one would make every tick re-examine
  // routines left active by earlier tests.
  home = mkdtempSync(join(tmpdir(), 'openfrost-sched-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db, { home: opened.home });
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
});

const now = (): string => new Date(clockMs).toISOString();
const setClock = (iso: string): void => {
  clockMs = Date.parse(iso);
};

/** Friday 2026-10-23, 08:00 UTC — one hour before the test schedule fires. */
const FRIDAY_0800 = '2026-10-23T08:00:00.000Z';
const FRIDAY_0900 = '2026-10-23T09:00:00.000Z';
const NEXT_FRIDAY_0900 = '2026-10-30T09:00:00.000Z';

/** A stateless provider: every run finishes immediately with a plan draft. */
const PLAN_PROVIDER: LlmProvider = {
  name: 'plan-fake',
  async step() {
    return {
      kind: 'final',
      text: '## Draft priorities for next week\n\nConfirm with the owner.',
      citations: [],
      usage: { inputTokens: null, outputTokens: null },
    };
  },
};

const FAILING_PROVIDER: LlmProvider = {
  name: 'plan-fail',
  async step() {
    throw new Error('provider exploded');
  },
};

function makeExecutor(provider: LlmProvider = PLAN_PROVIDER): TaskExecutor {
  return new TaskExecutor({ store, provider, now });
}

function makeScheduler(executor: TaskExecutor): RoutineScheduler {
  return new RoutineScheduler({ store, executor, now });
}

/** Project whose weekly plans are grounded by one seeded saved update. */
function makeProject(name: string): Project {
  const project = store.projects.create({ name }, now());
  const task = store.tasks.create(
    { title: 'Seed update', request: 'Update.', kind: 'project_update', projectId: project.id },
    now(),
  );
  const artifact = store.artifacts.create(
    task.id,
    '# Seed update\n\nThe notes state progress.',
    now(),
    'project_update',
  );
  store.tasks.transition(task.id, 'running', now());
  store.tasks.transition(task.id, 'completed', now(), { resultArtifactId: artifact.id });
  return project;
}

function makeRoutine(projectId: string, name: string): Routine {
  const routine = store.routines.create(
    {
      name,
      projectId,
      timezone: 'UTC',
      schedule: { kind: 'weekly', weekday: 5, time: '09:00' },
      template: {
        title: 'Draft next week priorities',
        request: 'Review notes and recent updates; draft next week priorities.',
        constraints: null,
      },
    },
    now(),
  );
  return store.routines.update(routine.id, { state: 'active' }, now());
}

function weeklyTasks(): number {
  return store.tasks
    .list()
    .filter((task) => task.kind === 'weekly_plan')
    .length;
}

describe('routine scheduler (fake clock)', () => {
  it('dispatches a due occurrence once across ticks and completes the task', async () => {
    setClock(FRIDAY_0800);
    const project = makeProject('Due');
    const routine = makeRoutine(project.id, 'Due routine');
    const executor = makeExecutor();
    const scheduler = makeScheduler(executor);

    // Not due yet.
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    expect(store.routines.listOccurrences(routine.id, 10)).toHaveLength(0);

    // Due exactly at the scheduled instant.
    setClock(FRIDAY_0900);
    expect(await scheduler.tick()).toEqual({ scheduled: 1, missed: 0 });
    await executor.whenIdle();

    const occurrences = store.routines.listOccurrences(routine.id, 10);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.state).toBe('scheduled');
    expect(occurrences[0]?.occurrenceKey).toBe('2026-10-23');
    expect(occurrences[0]?.taskId).toBeTruthy();
    const task = store.tasks.get(occurrences[0]?.taskId ?? '');
    expect(task?.kind).toBe('weekly_plan');
    expect(task?.state).toBe('completed');
    expect(task?.routineId).toBe(routine.id);
    expect(store.routines.get(routine.id)?.lastOccurrenceKey).toBe('2026-10-23');
    expect(store.artifacts.latestForTask(task?.id ?? '')?.kind).toBe('weekly_plan');

    // Repeated ticks at the same and later times dispatch nothing more.
    setClock('2026-10-23T09:05:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    setClock('2026-10-23T09:29:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    expect(weeklyTasks()).toBe(1);

    // The next week is a new occurrence key and dispatches again.
    setClock(NEXT_FRIDAY_0900);
    expect(await scheduler.tick()).toEqual({ scheduled: 1, missed: 0 });
    await executor.whenIdle();
    expect(store.routines.listOccurrences(routine.id, 10).map((o) => o.occurrenceKey)).toEqual(
      ['2026-10-30', '2026-10-23'],
    );
    expect(weeklyTasks()).toBe(2);
  });

  it('does not duplicate work across a restart (new executor and scheduler)', async () => {
    setClock(FRIDAY_0800);
    const project = makeProject('Restart');
    const routine = makeRoutine(project.id, 'Restart routine');
    const first = makeScheduler(makeExecutor());
    setClock(FRIDAY_0900);
    await first.tick();
    await first.stop();

    // Simulated restart: fresh executor/scheduler over the same store.
    const secondExecutor = makeExecutor();
    const second = makeScheduler(secondExecutor);
    setClock('2026-10-23T09:01:00.000Z');
    expect(await second.tick()).toEqual({ scheduled: 0, missed: 0 });
    await secondExecutor.whenIdle();
    expect(weeklyTasks()).toBe(1);
    expect(store.routines.listOccurrences(routine.id, 10)).toHaveLength(1);
  });

  it('surfaces exactly one missed occurrence when the runtime was unavailable', async () => {
    setClock(FRIDAY_0800);
    const project = makeProject('Missed');
    const routine = makeRoutine(project.id, 'Missed routine');
    const executor = makeExecutor();
    const scheduler = makeScheduler(executor);

    // PC off across the whole window; back three days later.
    setClock('2026-10-26T12:00:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 1 });
    // Repeated ticks never add more rows — no replay burst.
    setClock('2026-10-26T12:01:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });

    const occurrences = store.routines.listOccurrences(routine.id, 10);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.state).toBe('missed');
    expect(occurrences[0]?.taskId).toBeNull();
    expect(occurrences[0]?.reason).toContain('not available');
    expect(weeklyTasks()).toBe(0);

    // “Run once now” dispatches exactly one task and resolves the row.
    const resolved = await scheduler.runMissedNow(routine.id, '2026-10-23');
    expect(resolved.state).toBe('scheduled');
    expect(resolved.decidedAt).toBe(now());
    await executor.whenIdle();
    expect(weeklyTasks()).toBe(1);
    expect(store.tasks.get(resolved.taskId ?? '')?.state).toBe('completed');

    // Duplicate run-now decisions are refused.
    await expect(scheduler.runMissedNow(routine.id, '2026-10-23')).rejects.toThrowError(
      InvalidRoutineOccurrenceTransitionError,
    );
    expect(weeklyTasks()).toBe(1);

    // A second missed week resolves through “skip” without any task.
    setClock('2026-11-06T12:00:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 1 });
    const skipped = scheduler.skipMissed(routine.id, '2026-11-06');
    expect(skipped.state).toBe('skipped');
    expect(skipped.decidedAt).toBe(now());
    expect(weeklyTasks()).toBe(1);
    // Intermediate weeks the runtime also missed were never replayed.
    expect(store.routines.getOccurrence(routine.id, '2026-10-30')).toBeNull();
    // Skipping twice is refused.
    expect(() => scheduler.skipMissed(routine.id, '2026-11-06')).toThrowError(
      InvalidRoutineOccurrenceTransitionError,
    );
  });

  it('runs late within the grace window but misses past it', async () => {
    setClock(FRIDAY_0800);
    const project = makeProject('Grace');
    // Two staggered schedules so one tick exercises each side of the line.
    const early = store.routines.create(
      {
        name: 'Grace boundary early',
        projectId: project.id,
        timezone: 'UTC',
        schedule: { kind: 'weekly', weekday: 5, time: '09:00' },
        template: { title: 'Plan', request: 'Plan it.', constraints: null },
      },
      now(),
    );
    const late = store.routines.create(
      {
        name: 'Grace boundary late',
        projectId: project.id,
        timezone: 'UTC',
        schedule: { kind: 'weekly', weekday: 5, time: '12:00' },
        template: { title: 'Plan', request: 'Plan it.', constraints: null },
      },
      now(),
    );
    store.routines.update(early.id, { state: 'active' }, now());
    store.routines.update(late.id, { state: 'active' }, now());
    const scheduler = makeScheduler(makeExecutor());

    // Exactly the grace (30 min) after 09:00: still runs.
    setClock(new Date(Date.parse(FRIDAY_0900) + ROUTINE_LATE_GRACE_MS).toISOString());
    expect(await scheduler.tick()).toEqual({ scheduled: 1, missed: 0 });
    expect(store.routines.getOccurrence(early.id, '2026-10-23')?.state).toBe('scheduled');

    // One ms past the grace after 12:00: a review row, not an automatic run.
    setClock(
      new Date(Date.parse('2026-10-23T12:00:00.000Z') + ROUTINE_LATE_GRACE_MS + 1).toISOString(),
    );
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 1 });
    expect(store.routines.getOccurrence(late.id, '2026-10-23')?.state).toBe('missed');
  });

  it('does nothing while paused, then reports one missed occurrence after resume', async () => {
    setClock(FRIDAY_0800);
    const project = makeProject('Paused');
    const routine = makeRoutine(project.id, 'Paused routine');
    const scheduler = makeScheduler(makeExecutor());

    store.routines.update(routine.id, { state: 'paused' }, now());
    setClock('2026-10-23T10:00:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    expect(store.routines.listOccurrences(routine.id, 10)).toHaveLength(0);

    store.routines.update(routine.id, { state: 'active' }, now());
    // An hour past the scheduled time: missed for review (run-now/skip), not
    // an automatic run and not a silent drop.
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 1 });
    expect(store.routines.getOccurrence(routine.id, '2026-10-23')?.state).toBe('missed');
    expect(weeklyTasks()).toBe(0);
  });

  it('honors schedule edits: no back-fill, next occurrence under the new schedule', async () => {
    setClock(FRIDAY_0800);
    const project = makeProject('Edited');
    const routine = makeRoutine(project.id, 'Edited routine');
    const scheduler = makeScheduler(makeExecutor());

    // Monday 2026-10-26 09:00: switch to Mondays 10:00.
    setClock('2026-10-26T09:00:00.000Z');
    store.routines.update(
      routine.id,
      { schedule: { kind: 'weekly', weekday: 1, time: '10:00' } },
      now(),
    );
    // 10:30 same day: due under the new schedule, within the grace.
    setClock('2026-10-26T10:30:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 1, missed: 0 });
    const occurrences = store.routines.listOccurrences(routine.id, 10);
    expect(occurrences.map((o) => o.occurrenceKey)).toEqual(['2026-10-26']);
    // The old Friday schedule never produced a row or a miss.
    expect(store.routines.getOccurrence(routine.id, '2026-10-23')).toBeNull();

    // An edit AFTER the new schedule's instant also never back-fills.
    const lateEdit = makeRoutine(makeProject('LateEdit').id, 'Late edit routine');
    setClock('2026-10-26T10:20:00.000Z');
    store.routines.update(
      lateEdit.id,
      { schedule: { kind: 'weekly', weekday: 1, time: '10:00' } },
      now(),
    );
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    expect(store.routines.listOccurrences(lateEdit.id, 10)).toHaveLength(0);
  });

  it('enabling a routine never back-fills occurrences from before creation', async () => {
    // Created Friday 12:00 — three hours after this week's 09:00 occurrence.
    setClock('2026-10-23T12:00:00.000Z');
    const project = makeProject('Anchor');
    const routine = makeRoutine(project.id, 'Anchor routine');
    const scheduler = makeScheduler(makeExecutor());
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    expect(store.routines.listOccurrences(routine.id, 10)).toHaveLength(0);
    // The next scheduled occurrence behaves normally.
    setClock(NEXT_FRIDAY_0900);
    expect(await scheduler.tick()).toEqual({ scheduled: 1, missed: 0 });
  });

  it('a failed run stays failed: ticks never re-dispatch or auto-retry', async () => {
    setClock(FRIDAY_0800);
    const project = makeProject('Failed');
    const routine = makeRoutine(project.id, 'Failed routine');
    const executor = makeExecutor(FAILING_PROVIDER);
    const scheduler = makeScheduler(executor);

    setClock(FRIDAY_0900);
    await scheduler.tick();
    await executor.whenIdle();

    const occurrence = store.routines.getOccurrence(routine.id, '2026-10-23');
    expect(occurrence?.state).toBe('scheduled');
    const task = store.tasks.get(occurrence?.taskId ?? '');
    expect(task?.state).toBe('failed');

    setClock('2026-10-23T10:00:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    expect(weeklyTasks()).toBe(1);
    // The failed occurrence remains reviewable through its task.
    expect(store.routines.listOccurrences(routine.id, 10)).toHaveLength(1);
  });

  it('dispatches two routines due in the same tick through the one global queue', async () => {
    setClock(FRIDAY_0800);
    const projectA = makeProject('OverlapA');
    const projectB = makeProject('OverlapB');
    makeRoutine(projectA.id, 'Overlap A');
    makeRoutine(projectB.id, 'Overlap B');
    const executor = makeExecutor();
    const scheduler = makeScheduler(executor);

    setClock(FRIDAY_0900);
    expect(await scheduler.tick()).toEqual({ scheduled: 2, missed: 0 });
    await executor.whenIdle();

    const plans = store.tasks.list().filter((task) => task.kind === 'weekly_plan');
    expect(plans).toHaveLength(2);
    expect(plans.every((task) => task.state === 'completed')).toBe(true);
    expect(new Set(plans.map((task) => task.projectId)).size).toBe(2);
    expect(new Set(plans.map((task) => task.routineId)).size).toBe(2);
    // One more tick must not re-run either.
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    expect(store.tasks.list().filter((task) => task.kind === 'weekly_plan')).toHaveLength(2);
  });

  it('ignores clock changes around a dispatched occurrence', async () => {
    setClock(FRIDAY_0800);
    const project = makeProject('Clock');
    const routine = makeRoutine(project.id, 'Clock routine');
    const executor = makeExecutor();
    const scheduler = makeScheduler(executor);

    setClock(FRIDAY_0900);
    await scheduler.tick();
    await executor.whenIdle();

    // Clock jumps back before the occurrence: the row already exists and the
    // older week predates the routine's window — nothing new, no duplicates.
    setClock('2026-10-23T08:00:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    // And forward again across the fired instant.
    setClock('2026-10-23T11:00:00.000Z');
    expect(await scheduler.tick()).toEqual({ scheduled: 0, missed: 0 });
    expect(weeklyTasks()).toBe(1);
    expect(store.routines.listOccurrences(routine.id, 10)).toHaveLength(1);
  });

  it('emits routine events for the observable lifecycle', async () => {
    setClock(FRIDAY_0800);
    const project = makeProject('Events');
    const routine = makeRoutine(project.id, 'Events routine');
    const scheduler = makeScheduler(makeExecutor());

    // Two missed Fridays in a row; the first is run now, the second skipped.
    setClock('2026-11-06T12:00:00.000Z');
    await scheduler.tick();
    await scheduler.runMissedNow(routine.id, '2026-11-06');
    setClock('2026-11-13T12:00:00.000Z');
    await scheduler.tick();
    scheduler.skipMissed(routine.id, '2026-11-13');
    // Then an on-time week dispatches normally.
    setClock('2026-11-20T09:00:00.000Z');
    await scheduler.tick();

    const types = store.events.listRecent(200).map((event) => event.type);
    expect(types).toContain('routine.occurrence_missed');
    expect(types).toContain('routine.occurrence_run_now');
    expect(types).toContain('routine.occurrence_skipped');
    expect(types).toContain('routine.occurrence_scheduled');
  });
});

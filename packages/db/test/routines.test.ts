import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStore,
  openDatabase,
  InvalidRoutineOccurrenceTransitionError,
  RoutineNotFoundError,
  RoutineOccurrenceExistsError,
  RoutineOccurrenceNotFoundError,
  type OpenDatabaseResult,
  type Store,
} from '../src/index.js';

const T0 = Date.parse('2026-10-25T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

let home: string;
let opened: OpenDatabaseResult;
let store: Store;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-routines-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db, { home: opened.home });
});

afterAll(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
});

function makeRoutine(name = 'Friday planning') {
  const project = store.projects.create({ name: 'Thesis' }, at(0));
  const routine = store.routines.create(
    {
      name,
      projectId: project.id,
      timezone: 'UTC',
      schedule: { kind: 'weekly', weekday: 5, time: '09:00' },
      template: {
        title: 'Draft next week priorities',
        request: 'Review the project notes and recent updates; draft next week priorities.',
        constraints: null,
      },
    },
    at(0),
  );
  return { project, routine };
}

describe('routine lifecycle through the store', () => {
  it('creates routines as paused drafts with a no-back-fill window', () => {
    const { routine } = makeRoutine();
    expect(routine.state).toBe('paused');
    expect(routine.windowStartAt).toBe(at(0));
    expect(routine.lastOccurrenceKey).toBeNull();
    expect(store.routines.get(routine.id)?.timezone).toBe('UTC');
  });

  it('lists by state and updates fields', () => {
    const { routine } = makeRoutine('Daily review');
    const enabled = store.routines.update(routine.id, { state: 'active' }, at(1));
    expect(enabled.state).toBe('active');
    expect(store.routines.listByState('active').map((r) => r.id)).toContain(routine.id);
    expect(store.routines.listByState('paused').map((r) => r.id)).not.toContain(routine.id);

    const edited = store.routines.update(
      routine.id,
      {
        schedule: { kind: 'daily', time: '08:00' },
        template: {
          title: 'Morning review',
          request: 'Review notes; draft the day.',
          constraints: 'Keep it short',
        },
      },
      at(2),
    );
    expect(edited.schedule).toEqual({ kind: 'daily', time: '08:00' });
    expect(edited.template.constraints).toBe('Keep it short');
    // A schedule edit moves the anchor: no occurrence before the edit counts.
    expect(edited.windowStartAt).toBe(at(2));
  });

  it('keeps the window anchor on non-schedule edits', () => {
    const { routine } = makeRoutine('Rename me');
    const renamed = store.routines.update(routine.id, { name: 'Renamed' }, at(3));
    expect(renamed.windowStartAt).toBe(at(0));
  });

  it('throws on unknown routine ids', () => {
    expect(() => store.routines.update('missing', { name: 'x' }, at(0))).toThrowError(
      RoutineNotFoundError,
    );
  });

  it('removes a routine with its occurrences but keeps dispatched tasks', () => {
    const { routine } = makeRoutine('To remove');
    const task = store.tasks.create(
      {
        title: 'Weekly plan',
        request: 'Plan',
        kind: 'weekly_plan',
        projectId: routine.projectId,
        routineId: routine.id,
      },
      at(0),
    );
    store.routines.createOccurrence(
      {
        routineId: routine.id,
        occurrenceKey: '2026-10-23',
        scheduledFor: '2026-10-23T09:00:00.000Z',
        state: 'scheduled',
        taskId: task.id,
      },
      at(0),
    );
    store.routines.remove(routine.id);
    expect(store.routines.get(routine.id)).toBeNull();
    expect(store.routines.getOccurrence(routine.id, '2026-10-23')).toBeNull();
    // The task is independent history.
    expect(store.tasks.get(task.id)?.kind).toBe('weekly_plan');
    expect(store.tasks.get(task.id)?.routineId).toBe(routine.id);
  });
});

describe('routine occurrences', () => {
  it('enforces one row per (routine, occurrence key)', () => {
    const { routine } = makeRoutine('Dedup');
    const first = store.routines.createOccurrence(
      {
        routineId: routine.id,
        occurrenceKey: '2026-10-30',
        scheduledFor: '2026-10-30T09:00:00.000Z',
        state: 'scheduled',
      },
      at(0),
    );
    expect(first.state).toBe('scheduled');
    expect(
      store.routines.getOccurrence(routine.id, '2026-10-30')?.id,
    ).toBe(first.id);
    expect(() =>
      store.routines.createOccurrence(
        {
          routineId: routine.id,
          occurrenceKey: '2026-10-30',
          scheduledFor: '2026-10-30T09:00:00.000Z',
          state: 'missed',
          reason: 'runtime unavailable',
        },
        at(1),
      ),
    ).toThrowError(RoutineOccurrenceExistsError);
    // A different local date is a different occurrence.
    expect(() =>
      store.routines.createOccurrence(
        {
          routineId: routine.id,
          occurrenceKey: '2026-11-06',
          scheduledFor: '2026-11-06T09:00:00.000Z',
          state: 'scheduled',
        },
        at(2),
      ),
    ).not.toThrowError();
  });

  it('resolves a missed occurrence to scheduled (run now) or skipped', () => {
    const { routine } = makeRoutine('Missed flow');
    const task = store.tasks.create(
      {
        title: 'Weekly plan — 2026-10-23',
        request: 'Plan',
        kind: 'weekly_plan',
        projectId: routine.projectId,
        routineId: routine.id,
      },
      at(0),
    );
    store.routines.createOccurrence(
      {
        routineId: routine.id,
        occurrenceKey: '2026-10-23',
        scheduledFor: '2026-10-23T09:00:00.000Z',
        state: 'missed',
        reason: 'Runtime was unavailable.',
      },
      at(0),
    );
    const run = store.routines.resolveOccurrence(
      routine.id,
      '2026-10-23',
      'scheduled',
      { taskId: task.id },
      at(1),
    );
    expect(run.state).toBe('scheduled');
    expect(run.taskId).toBe(task.id);
    expect(run.decidedAt).toBe(at(1));
    expect(run.reason).toBeNull();

    // Duplicate decisions refuse: scheduled is terminal.
    expect(() =>
      store.routines.resolveOccurrence(routine.id, '2026-10-23', 'skipped', {}, at(2)),
    ).toThrowError(InvalidRoutineOccurrenceTransitionError);
    // Skipped is terminal too.
    store.routines.createOccurrence(
      {
        routineId: routine.id,
        occurrenceKey: '2026-10-16',
        scheduledFor: '2026-10-16T09:00:00.000Z',
        state: 'skipped',
      },
      at(0),
    );
    expect(() =>
      store.routines.resolveOccurrence(routine.id, '2026-10-16', 'scheduled', {}, at(2)),
    ).toThrowError(InvalidRoutineOccurrenceTransitionError);
    expect(() =>
      store.routines.resolveOccurrence(routine.id, '1999-01-01', 'skipped', {}, at(2)),
    ).toThrowError(RoutineOccurrenceNotFoundError);
  });

  it('lists occurrences newest key first with a limit', () => {
    const { routine } = makeRoutine('Listed');
    for (const key of ['2026-10-09', '2026-10-16', '2026-10-23']) {
      store.routines.createOccurrence(
        {
          routineId: routine.id,
          occurrenceKey: key,
          scheduledFor: `${key}T09:00:00.000Z`,
          state: 'scheduled',
        },
        at(0),
      );
    }
    const all = store.routines.listOccurrences(routine.id, 10);
    expect(all.map((o) => o.occurrenceKey)).toEqual([
      '2026-10-23',
      '2026-10-16',
      '2026-10-09',
    ]);
    expect(store.routines.listOccurrences(routine.id, 2)).toHaveLength(2);
  });
});

describe('weekly-plan tasks and recent project updates', () => {
  it('persists routineId on tasks', () => {
    const { routine } = makeRoutine('Task linkage');
    const task = store.tasks.create(
      {
        title: 'Weekly plan — 2026-10-23',
        request: 'Plan',
        kind: 'weekly_plan',
        projectId: routine.projectId,
        routineId: routine.id,
      },
      at(0),
    );
    expect(task.routineId).toBe(routine.id);
    expect(store.tasks.get(task.id)?.routineId).toBe(routine.id);
  });

  it('returns only the same project’s update artifacts, newest first', () => {
    const projectA = store.projects.create({ name: 'A' }, at(0));
    const projectB = store.projects.create({ name: 'B' }, at(0));

    const mkUpdate = (project: typeof projectA, label: string, time: string) => {
      const task = store.tasks.create(
        {
          title: `Update ${label}`,
          request: 'Update',
          kind: 'project_update',
          projectId: project.id,
        },
        time,
      );
      return store.artifacts.create(task.id, `# Update ${label}`, time, 'project_update');
    };
    const older = mkUpdate(projectA, 'older', at(0));
    const newer = mkUpdate(projectA, 'newer', at(60_000));
    mkUpdate(projectB, 'other project', at(120_000));

    // A research report in project A must not surface as an update either.
    const brief = store.tasks.create(
      { title: 'Brief', request: 'Brief', kind: 'research_brief', projectId: projectA.id },
      at(150_000),
    );
    store.artifacts.create(brief.id, '# Brief', at(150_000), 'report');

    const updates = store.artifacts.recentProjectUpdates(projectA.id, 2);
    expect(updates.map((a) => a.id)).toEqual([newer.id, older.id]);
    expect(store.artifacts.recentProjectUpdates(projectB.id, 2)).toHaveLength(1);
  });
});

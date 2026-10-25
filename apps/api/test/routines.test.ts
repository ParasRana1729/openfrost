import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jarHeaders, setupOwner, startApp, waitFor, type TestApp } from './helpers.js';

let app: TestApp;
let projectId: string;
/** Mutable clock: routines need to schedule an occurrence in the future and
 * then advance past it — a real-time wait would make the test slow and flaky. */
let clockMs = Date.now();
const tick = (): string => new Date(clockMs).toISOString();

beforeAll(async () => {
  app = await startApp({
    // Enough scripted finals for every run this suite dispatches.
    steps: Array.from({ length: 12 }, () => ({ type: 'final' as const, text: 'Plan draft.' })),
    now: tick,
  });
  await setupOwner(app);
  const created = await app.built.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: jarHeaders(app),
    payload: { name: 'Routine project' },
  });
  projectId = created.json().project.id as string;
  // Ground weekly plans for this project with one seeded saved update.
  const task = app.store.tasks.create(
    {
      title: 'Seed update',
      request: 'Update.',
      kind: 'project_update',
      projectId,
    },
    new Date().toISOString(),
  );
  const artifact = app.store.artifacts.create(
    task.id,
    '# Seed update\n\nThe notes state progress.',
    new Date().toISOString(),
    'project_update',
  );
  app.store.tasks.transition(task.id, 'running', new Date().toISOString());
  app.store.tasks.transition(task.id, 'completed', new Date().toISOString(), {
    resultArtifactId: artifact.id,
  });
});

afterAll(async () => {
  await app.close();
});

interface RoutineBody {
  routine: {
    id: string;
    name: string;
    state: string;
    timezone: string;
    windowStartAt: string;
    schedule: { kind: string; weekday?: number; time: string };
    template: { title: string; request: string; constraints: string | null };
  };
}

async function createRoutine(overrides: Record<string, unknown> = {}) {
  const res = await app.built.app.inject({
    method: 'POST',
    url: '/api/routines',
    headers: jarHeaders(app),
    payload: {
      name: 'Friday planning',
      projectId,
      timezone: 'UTC',
      schedule: { kind: 'weekly', weekday: 5, time: '09:00' },
      template: {
        title: 'Draft next week priorities',
        request: 'Review notes and recent updates; draft next week priorities.',
        constraints: null,
      },
      ...overrides,
    },
  });
  return { statusCode: res.statusCode, body: res.json() as RoutineBody & { error?: string } };
}

describe('routines API', () => {
  it('requires authentication and CSRF', async () => {
    const anon = await app.built.app.inject({ method: 'GET', url: '/api/routines' });
    expect(anon.statusCode).toBe(401);

    const noCsrf = await app.built.app.inject({
      method: 'POST',
      url: '/api/routines',
      headers: { cookie: app.cookie! },
      payload: {},
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('creates a paused draft and validates input', async () => {
    const created = await createRoutine();
    expect(created.statusCode).toBe(201);
    expect(created.body.routine.state).toBe('paused');
    expect(created.body.routine.windowStartAt).toBeTruthy();

    const badZone = await createRoutine({ timezone: 'Mars/Olympus' });
    expect(badZone.statusCode).toBe(400);
    const badProject = await createRoutine({ projectId: 'missing-project' });
    expect(badProject.statusCode).toBe(404);
    const badTime = await createRoutine({
      schedule: { kind: 'weekly', weekday: 5, time: '25:00' },
    });
    expect(badTime.statusCode).toBe(400);
  });

  it('lists routines with next-occurrence previews and detail with occurrences', async () => {
    const { body } = await createRoutine({ name: 'Preview me' });
    const list = await app.built.app.inject({
      method: 'GET',
      url: '/api/routines',
      headers: { cookie: app.cookie! },
    });
    const entry = list
      .json()
      .routines.find((r: { routine: { id: string } }) => r.routine.id === body.routine.id);
    expect(entry.nextOccurrenceAt).toBeTruthy();
    expect(entry.nextOccurrenceKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.projectName).toBe('Routine project');
    expect(entry.missedCount).toBe(0);

    const detail = await app.built.app.inject({
      method: 'GET',
      url: `/api/routines/${body.routine.id}`,
      headers: { cookie: app.cookie! },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().occurrences).toEqual([]);

    const missing = await app.built.app.inject({
      method: 'GET',
      url: '/api/routines/does-not-exist',
      headers: { cookie: app.cookie! },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('enables and pauses with explicit owner actions, refusing duplicates', async () => {
    const { body } = await createRoutine({ name: 'Toggle me' });
    const id = body.routine.id;

    const enable = await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/enable`,
      headers: jarHeaders(app),
    });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().routine.state).toBe('active');

    const again = await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/enable`,
      headers: jarHeaders(app),
    });
    expect(again.statusCode).toBe(409);

    const pause = await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/pause`,
      headers: jarHeaders(app),
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().routine.state).toBe('paused');

    const pauseAgain = await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/pause`,
      headers: jarHeaders(app),
    });
    expect(pauseAgain.statusCode).toBe(409);
  });

  it('edits routines and moves the no-back-fill window on schedule changes', async () => {
    const { body } = await createRoutine({ name: 'Edit me' });
    const before = body.routine;
    clockMs += 5_000; // the edit happens strictly after creation
    const edit = await app.built.app.inject({
      method: 'PUT',
      url: `/api/routines/${before.id}`,
      headers: jarHeaders(app),
      payload: {
        schedule: { kind: 'daily', time: '08:30' },
        template: {
          title: 'Morning plan',
          request: 'Draft the day.',
          constraints: 'Short.',
        },
      },
    });
    expect(edit.statusCode).toBe(200);
    const after = edit.json().routine;
    expect(after.schedule).toEqual({ kind: 'daily', time: '08:30' });
    expect(after.template.constraints).toBe('Short.');
    expect(Date.parse(after.windowStartAt)).toBeGreaterThan(Date.parse(before.windowStartAt));

    const rename = await app.built.app.inject({
      method: 'PUT',
      url: `/api/routines/${before.id}`,
      headers: jarHeaders(app),
      payload: { name: 'Renamed' },
    });
    // Non-schedule edits keep the anchor.
    expect(rename.json().routine.windowStartAt).toBe(after.windowStartAt);
  });

  it('dispatches a due occurrence into the global queue and shows it in detail', async () => {
    // Daily a minute from now: created while still in the future, then the
    // clock advances past the scheduled instant (within the late grace).
    const dueTime = new Date(clockMs + 60_000).toISOString().slice(11, 16);
    const { body } = await createRoutine({
      name: 'Due now',
      schedule: { kind: 'daily', time: dueTime },
    });
    const id = body.routine.id;
    await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/enable`,
      headers: jarHeaders(app),
    });

    // Not due yet…
    expect((await app.built.scheduler.tick()).scheduled).toBe(0);
    // …then due 90 seconds after creation.
    clockMs += 90_000;
    expect((await app.built.scheduler.tick()).scheduled).toBe(1);

    const detail = await app.built.app.inject({
      method: 'GET',
      url: `/api/routines/${id}`,
      headers: { cookie: app.cookie! },
    });
    const occurrence = detail.json().occurrences[0];
    expect(occurrence.state).toBe('scheduled');
    expect(occurrence.taskId).toBeTruthy();

    await waitFor(() => app.store.tasks.get(occurrence.taskId)?.state === 'completed');
    const task = app.store.tasks.get(occurrence.taskId);
    expect(task?.kind).toBe('weekly_plan');
    expect(task?.routineId).toBe(id);
    expect(app.store.artifacts.latestForTask(task?.id ?? '')?.kind).toBe('weekly_plan');
  });

  it('resolves missed occurrences over HTTP: run once now, skip, duplicates 409', async () => {
    const { body } = await createRoutine({ name: 'Missed review' });
    const id = body.routine.id;
    app.store.routines.update(id, { state: 'active' }, new Date().toISOString());
    app.store.routines.createOccurrence(
      {
        routineId: id,
        occurrenceKey: '2026-10-23',
        scheduledFor: '2026-10-23T09:00:00.000Z',
        state: 'missed',
        reason: 'Runtime was unavailable.',
      },
      new Date().toISOString(),
    );
    app.store.routines.createOccurrence(
      {
        routineId: id,
        occurrenceKey: '2026-10-16',
        scheduledFor: '2026-10-16T09:00:00.000Z',
        state: 'missed',
        reason: 'Runtime was unavailable.',
      },
      new Date().toISOString(),
    );

    const list = await app.built.app.inject({
      method: 'GET',
      url: '/api/routines',
      headers: { cookie: app.cookie! },
    });
    const entry = list
      .json()
      .routines.find((r: { routine: { id: string } }) => r.routine.id === id);
    expect(entry.missedCount).toBe(2);

    const run = await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/occurrences/2026-10-23/run`,
      headers: jarHeaders(app),
    });
    expect(run.statusCode).toBe(200);
    const runBody = run.json().occurrence;
    expect(runBody.state).toBe('scheduled');
    expect(runBody.taskId).toBeTruthy();
    await waitFor(() => app.store.tasks.get(runBody.taskId)?.state === 'completed');

    const runAgain = await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/occurrences/2026-10-23/run`,
      headers: jarHeaders(app),
    });
    expect(runAgain.statusCode).toBe(409);

    const skip = await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/occurrences/2026-10-16/skip`,
      headers: jarHeaders(app),
    });
    expect(skip.statusCode).toBe(200);
    expect(skip.json().occurrence.state).toBe('skipped');

    const skipAgain = await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/occurrences/2026-10-16/skip`,
      headers: jarHeaders(app),
    });
    expect(skipAgain.statusCode).toBe(409);

    const unknownOccurrence = await app.built.app.inject({
      method: 'POST',
      url: `/api/routines/${id}/occurrences/1999-01-01/run`,
      headers: jarHeaders(app),
    });
    expect(unknownOccurrence.statusCode).toBe(404);
  });

  it('removes routines', async () => {
    const { body } = await createRoutine({ name: 'Remove me' });
    const removed = await app.built.app.inject({
      method: 'DELETE',
      url: `/api/routines/${body.routine.id}`,
      headers: jarHeaders(app),
    });
    expect(removed.statusCode).toBe(200);
    const detail = await app.built.app.inject({
      method: 'GET',
      url: `/api/routines/${body.routine.id}`,
      headers: { cookie: app.cookie! },
    });
    expect(detail.statusCode).toBe(404);
  });
});

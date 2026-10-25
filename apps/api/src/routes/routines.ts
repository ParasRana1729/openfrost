import type { FastifyPluginAsync } from 'fastify';
import {
  createRoutineRequestSchema,
  nextOccurrenceAfter,
  updateRoutineRequestSchema,
  type Routine,
} from '@openfrost/domain';
import { ProjectNotFoundError, RoutineNotFoundError, type Store } from '@openfrost/db';
import type { AppContext } from '../types.js';

/** Routine summary the UI renders: the entity plus computed schedule info. */
interface RoutineView {
  routine: Routine;
  /** Next occurrence after now (also shown for paused drafts as a preview). */
  nextOccurrenceAt: string | null;
  nextOccurrenceKey: string | null;
  /** Missed occurrences still awaiting the owner's run-now/skip decision. */
  missedCount: number;
  projectName: string | null;
}

function routineView(
  store: Store,
  routine: Routine,
  nowMs: number,
): RoutineView {
  // Paused drafts preview their next occurrence too: the owner confirms the
  // computed schedule on the review screen before enabling.
  const next = nextOccurrenceAfter(nowMs, routine.timezone, routine.schedule);
  const missed = store.routines
    .listOccurrences(routine.id, 100)
    .filter((occurrence) => occurrence.state === 'missed');
  return {
    routine,
    nextOccurrenceAt: next === null ? null : new Date(next.instantMs).toISOString(),
    nextOccurrenceKey: next?.key ?? null,
    missedCount: missed.length,
    projectName: store.projects.get(routine.projectId)?.name ?? null,
  };
}

/**
 * Owner-confirmed weekly planning routines (spec §3.C, S06). Creation makes
 * a paused draft; a separate enable action is the owner's confirmation.
 * Schedule/time-zone edits move the no-back-fill window so an edit never
 * produces instant "missed" occurrences. Missed occurrences resolve only
 * through explicit "run once now" or "skip".
 */
export const makeRoutineRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  app.get('/routines', async () => {
    const nowMs = Date.parse(ctx.now());
    return { routines: ctx.store.routines.list().map((r) => routineView(ctx.store, r, nowMs)) };
  });

  app.get('/routines/:routineId', async (request, reply) => {
    const { routineId } = request.params as { routineId: string };
    const routine = ctx.store.routines.get(routineId);
    if (!routine) {
      throw new RoutineNotFoundError(routineId);
    }
    const nowMs = Date.parse(ctx.now());
    const occurrences = ctx.store.routines.listOccurrences(routineId, 20).map((occurrence) => ({
      ...occurrence,
      task: occurrence.taskId ? ctx.store.tasks.get(occurrence.taskId) : null,
    }));
    return {
      ...routineView(ctx.store, routine, nowMs),
      occurrences,
    };
  });

  app.post('/routines', async (request, reply) => {
    const input = createRoutineRequestSchema.parse(request.body);
    if (ctx.store.projects.get(input.projectId) === null) {
      throw new ProjectNotFoundError(input.projectId);
    }
    const routine = ctx.store.routines.create(input, ctx.now());
    ctx.store.events.append(
      'routine.created',
      { payload: { routineId: routine.id, name: routine.name, projectId: routine.projectId } },
      ctx.now(),
    );
    return reply.code(201).send({ routine });
  });

  app.put('/routines/:routineId', async (request) => {
    const { routineId } = request.params as { routineId: string };
    const input = updateRoutineRequestSchema.parse(request.body);
    if (ctx.store.routines.get(routineId) === null) {
      throw new RoutineNotFoundError(routineId);
    }
    const projectId = input.projectId ?? ctx.store.routines.get(routineId)?.projectId;
    if (projectId !== undefined && ctx.store.projects.get(projectId) === null) {
      throw new ProjectNotFoundError(projectId);
    }
    const routine = ctx.store.routines.update(routineId, input, ctx.now());
    ctx.store.events.append(
      'routine.updated',
      {
        payload: {
          routineId,
          scheduleChanged: input.schedule !== undefined || input.timezone !== undefined,
        },
      },
      ctx.now(),
    );
    return { routine };
  });

  app.post('/routines/:routineId/enable', async (request, reply) => {
    const { routineId } = request.params as { routineId: string };
    const current = ctx.store.routines.get(routineId);
    if (!current) {
      throw new RoutineNotFoundError(routineId);
    }
    if (current.state === 'active') {
      return reply.code(409).send({ error: 'Routine is already enabled.' });
    }
    const routine = ctx.store.routines.update(routineId, { state: 'active' }, ctx.now());
    ctx.store.events.append('routine.enabled', { payload: { routineId } }, ctx.now());
    return { routine };
  });

  app.post('/routines/:routineId/pause', async (request, reply) => {
    const { routineId } = request.params as { routineId: string };
    const current = ctx.store.routines.get(routineId);
    if (!current) {
      throw new RoutineNotFoundError(routineId);
    }
    if (current.state === 'paused') {
      return reply.code(409).send({ error: 'Routine is already paused.' });
    }
    const routine = ctx.store.routines.update(routineId, { state: 'paused' }, ctx.now());
    ctx.store.events.append('routine.paused', { payload: { routineId } }, ctx.now());
    return { routine };
  });

  app.delete('/routines/:routineId', async (request) => {
    const { routineId } = request.params as { routineId: string };
    if (ctx.store.routines.get(routineId) === null) {
      throw new RoutineNotFoundError(routineId);
    }
    ctx.store.routines.remove(routineId);
    ctx.store.events.append('routine.removed', { payload: { routineId } }, ctx.now());
    return { ok: true };
  });

  app.post('/routines/:routineId/occurrences/:occurrenceKey/run', async (request) => {
    const { routineId, occurrenceKey } = request.params as {
      routineId: string;
      occurrenceKey: string;
    };
    const occurrence = await ctx.scheduler.runMissedNow(routineId, occurrenceKey);
    return { occurrence };
  });

  app.post('/routines/:routineId/occurrences/:occurrenceKey/skip', async (request) => {
    const { routineId, occurrenceKey } = request.params as {
      routineId: string;
      occurrenceKey: string;
    };
    const occurrence = ctx.scheduler.skipMissed(routineId, occurrenceKey);
    return { occurrence };
  });
};

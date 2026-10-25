import type { FastifyPluginAsync } from 'fastify';
import { createTaskRequestSchema } from '@openfrost/domain';
import { ProjectNotFoundError } from '@openfrost/db';
import type { AppContext } from '../types.js';

export const makeTaskRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  app.get('/tasks', async () => {
    return { tasks: ctx.store.tasks.list(), executor: ctx.executor.status() };
  });

  app.post('/tasks', async (request, reply) => {
    const input = createTaskRequestSchema.parse(request.body);
    // The contract cannot check store existence; a scoped task must point at
    // a real project or it would fail later with no way to recover.
    if (input.projectId !== undefined && ctx.store.projects.get(input.projectId) === null) {
      throw new ProjectNotFoundError(input.projectId);
    }
    const task = await ctx.executor.enqueue(input);
    return reply.code(202).send({ task });
  });

  app.get('/tasks/:taskId', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = ctx.store.tasks.get(taskId);
    if (!task) {
      return reply.code(404).send({ error: `Task ${taskId} not found` });
    }
    const runs = ctx.store.runs.listForTask(taskId);
    const events = ctx.store.events.listForTask(taskId);
    const artifact =
      task.resultArtifactId !== null ? ctx.store.artifacts.get(task.resultArtifactId) : null;
    return {
      task,
      runs,
      events,
      artifact: artifact ? { id: artifact.id, markdown: artifact.markdown } : null,
    };
  });

  app.post('/tasks/:taskId/cancel', async (request, _reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = ctx.executor.cancel(taskId);
    return { task };
  });

  app.post('/tasks/:taskId/retry', async (request, _reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = ctx.executor.requeue(taskId);
    return { task };
  });
};

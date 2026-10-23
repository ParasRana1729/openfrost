import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../types.js';

/**
 * Dispatch control. After restart recovery, dispatch stays paused until the
 * owner reviews interrupted runs here and explicitly resumes.
 */
export const makeDispatchRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  app.get('/dispatch', async () => {
    return {
      paused: ctx.executor.isDispatchPaused(),
      interruptedTasks: ctx.store.tasks.listByStates(['interrupted']),
      executor: ctx.executor.status(),
    };
  });

  app.post('/dispatch/resume', async () => {
    ctx.executor.resumeDispatch();
    return { paused: ctx.executor.isDispatchPaused() };
  });
};

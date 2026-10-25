import type { FastifyPluginAsync } from 'fastify';
import {
  createExportRequestSchema,
  exportDestinationRequestSchema,
  grantDecisionSchema,
} from '@openfrost/domain';
import { validateGrantPath } from '@openfrost/agent';
import {
  ApprovalNotFoundError,
  ExportDestinationNotFoundError,
  TaskNotFoundError,
} from '@openfrost/db';
import type { AppContext } from '../types.js';

/** Windows paths are case-insensitive; POSIX paths are not. */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Approval-bound export (spec §6, S04): destinations are granted here, the
 * export request becomes an export_report task, and every decision goes
 * through the executor's transition-validated decideApproval.
 */
export const makeExportRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  app.get('/exports/destinations', async () => {
    return { destinations: ctx.store.exportDestinations.list() };
  });

  app.post('/exports/destinations', async (request, reply) => {
    const input = exportDestinationRequestSchema.parse(request.body);
    const check = validateGrantPath(input.path, { home: ctx.config.homeDir });
    if (!check.ok) {
      return reply.code(400).send({ error: `Destination not granted: ${check.reason}` });
    }
    const duplicate = ctx.store
      .exportDestinations.list()
      .some((destination) => samePath(destination.path, check.canonical));
    if (duplicate) {
      return reply.code(409).send({ error: 'This folder is already an export destination.' });
    }
    const destination = ctx.store.exportDestinations.add(check.canonical, ctx.now());
    ctx.store.events.append(
      'export.destination_added',
      { payload: { destinationId: destination.id, path: destination.path } },
      ctx.now(),
    );
    return reply.code(201).send({ destination });
  });

  app.delete('/exports/destinations/:destinationId', async (request) => {
    const { destinationId } = request.params as { destinationId: string };
    if (ctx.store.exportDestinations.get(destinationId) === null) {
      throw new ExportDestinationNotFoundError(destinationId);
    }
    ctx.store.exportDestinations.remove(destinationId);
    ctx.store.events.append(
      'export.destination_removed',
      { payload: { destinationId } },
      ctx.now(),
    );
    return { ok: true };
  });

  app.post('/exports', async (request, reply) => {
    const input = createExportRequestSchema.parse(request.body);
    if (ctx.store.artifacts.get(input.artifactId) === null) {
      throw new TaskNotFoundError(input.artifactId);
    }
    if (ctx.store.exportDestinations.get(input.destinationId) === null) {
      throw new ExportDestinationNotFoundError(input.destinationId);
    }
    const task = await ctx.executor.enqueueExport(input);
    return reply.code(202).send({ task });
  });

  app.get('/approvals', async (request) => {
    const query = (request.query as { state?: string }).state;
    const states =
      query === 'pending'
        ? (['pending'] as const)
        : query === 'open'
          ? (['pending', 'granted'] as const)
          : undefined;
    const approvals = states ? ctx.store.approvals.listByStates(states) : ctx.store.approvals.listAll();
    // The review view must show the exact proposed content (spec §6); the
    // artifact markdown travels with each proposal.
    return {
      approvals: approvals.map((approval) => {
        const artifact = ctx.store.artifacts.get(approval.artifactId);
        return {
          ...approval,
          artifactChars: artifact?.markdown.length ?? null,
          artifactMarkdown: artifact?.markdown ?? null,
          taskTitle: ctx.store.tasks.get(approval.taskId)?.title ?? null,
        };
      }),
    };
  });

  app.post('/approvals/:approvalId/decision', async (request) => {
    const { approvalId } = request.params as { approvalId: string };
    const input = grantDecisionSchema.parse(request.body);
    const approval = ctx.executor.decideApproval(approvalId, input.decision);
    return { approval };
  });

  app.get('/approvals/:approvalId', async (request) => {
    const { approvalId } = request.params as { approvalId: string };
    const approval = ctx.store.approvals.get(approvalId);
    if (!approval) {
      throw new ApprovalNotFoundError(approvalId);
    }
    return { approval };
  });
};

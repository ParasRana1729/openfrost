import { z } from 'zod';

/**
 * Append-only application activity (spec §5). Events summarize observable
 * work, never private model reasoning or secret material.
 */
export const eventTypeSchema = z.enum([
  'auth.owner_created',
  'auth.logged_in',
  'auth.logged_out',
  'auth.login_failed',
  'settings.provider_key_set',
  'settings.provider_key_removed',
  'settings.provider_changed',
  'project.created',
  'project.updated',
  'project.grant_added',
  'project.grant_removed',
  'approval.requested',
  'approval.granted',
  'approval.rejected',
  'approval.canceled',
  'approval.expired',
  'export.destination_added',
  'export.destination_removed',
  'export.written',
  'dispatch.paused',
  'dispatch.resumed',
  'task.created',
  'task.completed',
  'task.failed',
  'task.canceled',
  'task.interrupted',
  'task.requeued',
  'run.started',
  'run.completed',
  'run.failed',
  'run.canceled',
  'run.interrupted',
  'run.limit_reached',
  'tool.executed',
]);
export type EventType = z.infer<typeof eventTypeSchema>;

/** Risk tiers for tool execution (spec §6). `local` tools stay disabled in v0.1. */
export const riskTierSchema = z.enum(['auto', 'telegram', 'local']);
export type RiskTier = z.infer<typeof riskTierSchema>;

export const eventSchema = z.strictObject({
  id: z.number().int().positive(),
  type: eventTypeSchema,
  taskId: z.string().min(1).nullable(),
  runId: z.string().min(1).nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(1),
});
export type Event = z.infer<typeof eventSchema>;

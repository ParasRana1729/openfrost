import { z } from 'zod';
import { runLimitKindSchema } from './task.js';

/** AgentRun states. One execution attempt of a task. */
export const runStateSchema = z.enum([
  'running',
  'completed',
  'failed',
  'canceled',
  'interrupted',
]);
export type RunState = z.infer<typeof runStateSchema>;

export const runUsageSchema = z.strictObject({
  steps: z.number().int().nonnegative(),
  inputChars: z.number().int().nonnegative(),
  outputChars: z.number().int().nonnegative(),
  /** Token counts when the provider reports them; null otherwise. */
  inputTokens: z.number().int().nonnegative().nullable().default(null),
  outputTokens: z.number().int().nonnegative().nullable().default(null),
});
export type RunUsage = z.infer<typeof runUsageSchema>;

export const runFailureCodeSchema = z.enum([
  'provider_missing',
  'provider_error',
  'limit_reached',
  'source_unavailable',
  'internal',
]);
export type RunFailureCode = z.infer<typeof runFailureCodeSchema>;

export const runFailureSchema = z.strictObject({
  code: runFailureCodeSchema,
  message: z.string().min(1),
  limitHit: runLimitKindSchema.nullable(),
});
export type RunFailure = z.infer<typeof runFailureSchema>;

export const agentRunSchema = z.strictObject({
  id: z.string().min(1),
  taskId: z.string().min(1),
  attempt: z.number().int().positive(),
  state: runStateSchema,
  startedAt: z.string().min(1),
  endedAt: z.string().nullable(),
  usage: runUsageSchema.nullable(),
  failure: runFailureSchema.nullable(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  running: ['completed', 'failed', 'canceled', 'interrupted'],
  completed: [],
  failed: [],
  canceled: [],
  interrupted: [],
};

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export class InvalidRunTransitionError extends Error {
  constructor(
    public readonly from: RunState,
    public readonly to: RunState,
  ) {
    super(`Invalid run state transition: ${from} -> ${to}`);
    this.name = 'InvalidRunTransitionError';
  }
}

/** Pure state transition; returns a copy with the new state and end time. */
export function transitionRun(
  run: AgentRun,
  to: RunState,
  now: string,
): AgentRun {
  if (!canTransitionRun(run.state, to)) {
    throw new InvalidRunTransitionError(run.state, to);
  }
  return { ...run, state: to, endedAt: now };
}

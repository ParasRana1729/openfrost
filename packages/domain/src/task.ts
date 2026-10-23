import { z } from 'zod';

/** Task lifecycle states (spec §5). Terminal states have no outgoing edges. */
export const taskStateSchema = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'canceled',
  'interrupted',
]);
export type TaskState = z.infer<typeof taskStateSchema>;

/**
 * Finite execution limits enforced per agent run. A run that hits any limit
 * stops with a clear result instead of continuing.
 */
export const runLimitKindSchema = z.enum([
  'max_steps',
  'wall_clock',
  'max_input',
  'max_output',
]);
export type RunLimitKind = z.infer<typeof runLimitKindSchema>;

export const executionLimitsSchema = z.strictObject({
  maxSteps: z.number().int().positive(),
  maxWallClockMs: z.number().int().positive(),
  maxInputChars: z.number().int().positive(),
  maxOutputChars: z.number().int().positive(),
});
export type ExecutionLimits = z.infer<typeof executionLimitsSchema>;

export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
  maxSteps: 12,
  maxWallClockMs: 10 * 60_000,
  maxInputChars: 20_000,
  maxOutputChars: 100_000,
};

export const taskSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  request: z.string().min(1),
  state: taskStateSchema,
  attemptCount: z.number().int().nonnegative(),
  lastRunId: z.string().min(1).nullable(),
  resultArtifactId: z.string().min(1).nullable(),
  error: z.string().nullable(),
  /** ISO-8601 UTC by convention. */
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Task = z.infer<typeof taskSchema>;

export const createTaskRequestSchema = z.strictObject({
  title: z.string().min(1).max(200),
  request: z
    .string()
    .min(1)
    .max(DEFAULT_EXECUTION_LIMITS.maxInputChars),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/**
 * Allowed task state transitions. `failed`, `canceled`, and `interrupted`
 * tasks may be explicitly re-queued by the owner, which creates a new run
 * attempt; retry history stays visible in the run records.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  queued: ['running', 'canceled'],
  running: ['awaiting_approval', 'completed', 'failed', 'canceled', 'interrupted'],
  awaiting_approval: ['running', 'failed', 'canceled', 'interrupted'],
  completed: [],
  failed: ['queued'],
  canceled: ['queued'],
  interrupted: ['queued', 'canceled'],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly to: TaskState,
  ) {
    super(`Invalid task state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/** Pure state transition; returns a copy with the new state and timestamp. */
export function transitionTask(task: Task, to: TaskState, now: string): Task {
  if (!canTransition(task.state, to)) {
    throw new InvalidTransitionError(task.state, to);
  }
  return { ...task, state: to, updatedAt: now };
}

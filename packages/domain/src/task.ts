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

/**
 * Which bounded workflow a task runs. The kind selects the system policy and
 * the tool set: research briefs use public web retrieval, project updates use
 * granted-folder reads. There is no per-task provider or model selection.
 */
export const taskKindSchema = z.enum(['research_brief', 'project_update']);
export type TaskKind = z.infer<typeof taskKindSchema>;

export const taskSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  request: z.string().min(1),
  /** Optional constraints the owner attached to the request. */
  constraints: z.string().max(2000).nullable(),
  /** Optional public http(s) pages to retrieve before research begins. */
  startingUrls: z.array(z.string().max(2048)).nullable(),
  /** Project this task is scoped to, when the owner chose one. */
  projectId: z.string().min(1).nullable(),
  kind: taskKindSchema,
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
  constraints: z.string().max(2000).optional(),
  startingUrls: z
    .array(z.url({ protocol: /^https?$/ }).max(2048))
    .max(5)
    .optional(),
  /** Scope the task to an existing project (validated against the store). */
  projectId: z.string().min(1).optional(),
  kind: taskKindSchema.optional(),
}).superRefine((value, ctx) => {
  // A project update is grounded in a project's granted files; without a
  // project there is nothing it could read, so the combination is rejected.
  if (value.kind === 'project_update' && value.projectId === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['projectId'],
      message: 'A project update must be scoped to a project',
    });
  }
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

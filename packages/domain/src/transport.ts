import { z } from 'zod';
import { taskSchema } from './task.js';
import { agentRunSchema } from './run.js';
import { eventSchema } from './event.js';
import { approvalSchema, exportDestinationSchema } from './approval.js';
import { projectWithGrantsSchema } from './project.js';
import { routineSchema, routineOccurrenceSchema } from './routine.js';

// Wire envelopes not previously named in domain. Keep entity validation in the
// canonical schemas rather than maintaining fixture-only copies of entities.
export const executorStatusSchema = z.strictObject({
  busy: z.boolean(),
  activeTaskId: z.string().min(1).nullable(),
  dispatchPaused: z.boolean(),
});
export const tasksResponseSchema = z.strictObject({
  tasks: z.array(taskSchema),
  executor: executorStatusSchema,
});
export const taskDetailSchema = z.strictObject({
  task: taskSchema,
  runs: z.array(agentRunSchema),
  events: z.array(eventSchema),
  artifact: z.strictObject({ id: z.string().min(1), markdown: z.string().min(1) }).nullable(),
  approval: approvalSchema.nullable(),
});
export const approvalViewSchema = approvalSchema.extend({
  artifactChars: z.number().int().nonnegative().nullable(),
  artifactMarkdown: z.string().nullable(),
  taskTitle: z.string().nullable(),
});
export const approvalsResponseSchema = z.strictObject({ approvals: z.array(approvalViewSchema) });
export const projectsResponseSchema = z.strictObject({ projects: z.array(projectWithGrantsSchema) });
export const destinationsResponseSchema = z.strictObject({ destinations: z.array(exportDestinationSchema) });

// The API nests the entity under `routine`; unlike approval views it is not
// flattened. Both the list and detail endpoints share this envelope.
export const routineViewSchema = z.strictObject({
  routine: routineSchema,
  nextOccurrenceAt: z.string().min(1).nullable(),
  nextOccurrenceKey: z.string().min(1).nullable(),
  missedCount: z.number().int().nonnegative(),
  projectName: z.string().nullable(),
});
export const routinesResponseSchema = z.strictObject({ routines: z.array(routineViewSchema) });
export const routineOccurrenceViewSchema = routineOccurrenceSchema.extend({
  task: taskSchema.nullable().optional(),
});
export const routineDetailSchema = routineViewSchema.extend({
  occurrences: z.array(routineOccurrenceViewSchema),
});

// Setup completes onboarding atomically; there is no separate onboarding body.
// These match the existing auth route validators, including the default owner.
export const setupRequestSchema = z.strictObject({
  username: z.string().min(1).max(60).default('owner'),
  password: z.string().min(8).max(200),
});
export const loginRequestSchema = z.strictObject({
  username: z.string().min(1).max(60).default('owner'),
  password: z.string().min(1).max(200),
});
export const sessionResponseSchema = z.strictObject({
  authenticated: z.boolean(),
  ownerCreated: z.boolean(),
  onboardingCompletedAt: z.string().min(1).nullable(),
  csrfToken: z.string().min(1).optional(),
});
export const authSuccessSchema = z.strictObject({
  authenticated: z.literal(true),
  csrfToken: z.string().min(1),
});

export type ExecutorStatus = z.infer<typeof executorStatusSchema>;
export type TasksResponse = z.infer<typeof tasksResponseSchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export type ApprovalView = z.infer<typeof approvalViewSchema>;
export type ApprovalsResponse = z.infer<typeof approvalsResponseSchema>;
export type ProjectsResponse = z.infer<typeof projectsResponseSchema>;
export type DestinationsResponse = z.infer<typeof destinationsResponseSchema>;
export type RoutineView = z.infer<typeof routineViewSchema>;
export type RoutinesResponse = z.infer<typeof routinesResponseSchema>;
export type RoutineOccurrenceView = z.infer<typeof routineOccurrenceViewSchema>;
export type RoutineDetail = z.infer<typeof routineDetailSchema>;
export type SetupRequest = z.infer<typeof setupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type AuthSuccess = z.infer<typeof authSuccessSchema>;

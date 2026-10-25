import {
  agentRunSchema,
  artifactSchema,
  eventSchema,
  taskSchema,
  type AgentRun,
  type Artifact,
  type Event,
  type RunFailure,
  type RunUsage,
  type Task,
} from '@openfrost/domain';
import type * as schema from './schema.js';

type TasksRow = typeof schema.tasks.$inferSelect;
type AgentRunsRow = typeof schema.agentRuns.$inferSelect;
type ArtifactsRow = typeof schema.artifacts.$inferSelect;
type EventsRow = typeof schema.events.$inferSelect;

/** Row → entity mappers. Parsing through the Zod contracts keeps the stored
 * shape honest; a mismatch fails loudly instead of leaking bad data. */
export function toTask(row: TasksRow): Task {
  return taskSchema.parse({
    id: row.id,
    title: row.title,
    request: row.request,
    constraints: row.constraints,
    startingUrls:
      row.startingUrls === null ? null : (JSON.parse(row.startingUrls) as string[]),
    state: row.state,
    attemptCount: row.attemptCount,
    lastRunId: row.lastRunId,
    resultArtifactId: row.resultArtifactId,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toAgentRun(row: AgentRunsRow): AgentRun {
  return agentRunSchema.parse({
    id: row.id,
    taskId: row.taskId,
    attempt: row.attempt,
    state: row.state,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    usage: row.usageJson === null ? null : (JSON.parse(row.usageJson) as RunUsage),
    failure:
      row.failureJson === null ? null : (JSON.parse(row.failureJson) as RunFailure),
  });
}

export function toArtifact(row: ArtifactsRow): Artifact {
  return artifactSchema.parse({
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    markdown: row.markdown,
    createdAt: row.createdAt,
  });
}

export function toEvent(row: EventsRow): Event {
  return eventSchema.parse({
    id: row.id,
    type: row.type,
    taskId: row.taskId,
    runId: row.runId,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    createdAt: row.createdAt,
  });
}

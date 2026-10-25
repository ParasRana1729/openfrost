import {
  agentRunSchema,
  artifactSchema,
  conversationSchema,
  eventSchema,
  projectFolderGrantSchema,
  projectSchema,
  taskSchema,
  type AgentRun,
  type Artifact,
  type Conversation,
  type Event,
  type Project,
  type ProjectFolderGrant,
  type RunFailure,
  type RunUsage,
  type Task,
} from '@openfrost/domain';
import type * as schema from './schema.js';

type TasksRow = typeof schema.tasks.$inferSelect;
type AgentRunsRow = typeof schema.agentRuns.$inferSelect;
type ArtifactsRow = typeof schema.artifacts.$inferSelect;
type EventsRow = typeof schema.events.$inferSelect;
type ProjectsRow = typeof schema.projects.$inferSelect;
type ProjectFolderGrantsRow = typeof schema.projectFolderGrants.$inferSelect;

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
    projectId: row.projectId,
    kind: row.kind,
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

export function toProject(row: ProjectsRow): Project {
  return projectSchema.parse({
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toProjectFolderGrant(row: ProjectFolderGrantsRow): ProjectFolderGrant {
  return projectFolderGrantSchema.parse({
    id: row.id,
    projectId: row.projectId,
    path: row.path,
    createdAt: row.createdAt,
  });
}

export function toConversation(row: typeof schema.conversations.$inferSelect): Conversation {
  return conversationSchema.parse({
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    createdAt: row.createdAt,
  });
}

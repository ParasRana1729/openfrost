import { randomUUID } from 'node:crypto';
import { asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  InvalidApprovalTransitionError,
  InvalidTransitionError,
  messageSchema,
  transitionApproval,
  transitionRun,
  transitionTask,
  type AgentRun,
  type Approval,
  type ApprovalOutcome,
  type ApprovalState,
  type Artifact,
  type ArtifactKind,
  type Conversation,
  type Event,
  type EventType,
  type ExportArgs,
  type ExportDestination,
  type Message,
  type MessageRole,  type Project,
  type ProjectFolderGrant,
  type RunFailure,
  type RunState,
  type RunUsage,
  type Task,
  type TaskKind,
  type TaskState,
} from '@openfrost/domain';
import {
  toAgentRun,
  toApproval,
  toArtifact,
  toConversation,
  toEvent,
  toExportDestination,
  toProject,
  toProjectFolderGrant,
  toTask,
} from './mappers.js';
import { hashPassword, verifyPassword } from './passwords.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface OwnerUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export class OwnerExistsError extends Error {
  constructor() {
    super('The owner account already exists');
    this.name = 'OwnerExistsError';
  }
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} not found`);
    this.name = 'TaskNotFoundError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} not found`);
    this.name = 'ProjectNotFoundError';
  }
}

export class ApprovalNotFoundError extends Error {
  constructor(approvalId: string) {
    super(`Approval ${approvalId} not found`);
    this.name = 'ApprovalNotFoundError';
  }
}

export class ExportDestinationNotFoundError extends Error {
  constructor(destinationId: string) {
    super(`Export destination ${destinationId} not found`);
    this.name = 'ExportDestinationNotFoundError';
  }
}

export interface Store {
  users: {
    count(): number;
    createOwner(username: string, password: string, now: string): OwnerUser;
    verifyOwnerCredentials(
      username: string,
      password: string,
    ): OwnerUser | null;
  };
  sessions: {
    create(input: {
      userId: string;
      csrfToken: string;
      expiresAt: string;
      now: string;
    }): Session;
    get(id: string): Session | null;
    touch(id: string, now: string): void;
    remove(id: string): void;
    purgeExpired(now: string): void;
  };
  tasks: {
    create(
      input: {
        title: string;
        request: string;
        constraints?: string | null;
        startingUrls?: string[] | null;
        projectId?: string | null;
        kind?: TaskKind;
        exportArgs?: ExportArgs | null;
      },
      now: string,
    ): Task;
    get(id: string): Task | null;
    list(): Task[];
    listByStates(states: readonly TaskState[]): Task[];
    listQueued(): Task[];
    transition(
      id: string,
      to: TaskState,
      now: string,
      patch?: { error?: string | null; resultArtifactId?: string | null },
    ): Task;
    /** Atomically claim a queued task: creates the next run attempt and
     * moves the task to `running`. Throws InvalidTransitionError if the
     * task is not queued. */
    startRun(id: string, now: string): { task: Task; run: AgentRun };
  };
  runs: {
    get(id: string): AgentRun | null;
    listForTask(taskId: string): AgentRun[];
    finish(
      id: string,
      to: RunState,
      now: string,
      details?: { usage?: RunUsage | null; failure?: RunFailure | null },
    ): AgentRun;
  };
  events: {
    append(
      type: EventType,
      fields: {
        taskId?: string | null;
        runId?: string | null;
        payload?: Record<string, unknown>;
      },
      now: string,
    ): Event;
    listRecent(limit: number): Event[];
    listForTask(taskId: string): Event[];
  };
  artifacts: {
    create(
      taskId: string | null,
      markdown: string,
      now: string,
      kind?: ArtifactKind,
    ): Artifact;
    get(id: string): Artifact | null;
    latestForTask(taskId: string): Artifact | null;
  };
  projects: {
    create(
      input: { name: string; instructions?: string | null },
      now: string,
    ): Project;
    update(
      id: string,
      patch: { name?: string; instructions?: string | null },
      now: string,
    ): Project;
    get(id: string): Project | null;
    list(): Project[];
    addGrant(projectId: string, canonicalPath: string, now: string): ProjectFolderGrant;
    removeGrant(projectId: string, grantId: string): void;
    listGrants(projectId: string): ProjectFolderGrant[];
  };
  exportDestinations: {
    add(canonicalPath: string, now: string): ExportDestination;
    get(id: string): ExportDestination | null;
    list(): ExportDestination[];
    remove(id: string): void;
  };
  approvals: {
    create(
      input: {
        taskId: string;
        runId: string;
        artifactId: string;
        destinationId: string;
        destinationPath: string;
        filename: string;
        contentSha256: string;
        expiresAt: string;
      },
      now: string,
    ): Approval;
    get(id: string): Approval | null;
    getForTask(taskId: string): Approval | null;
    listByStates(states: readonly ApprovalState[]): Approval[];
    listAll(): Approval[];
    /** Owner decision or system expiry; validates the transition map. */
    decide(
      id: string,
      to: 'granted' | 'rejected' | 'canceled' | 'expired',
      now: string,
    ): Approval;
    markExecuted(id: string, outcome: ApprovalOutcome, now: string): Approval;
    /** A granted export that execution refused: terminal, never executed. */
    markRefused(id: string, refusalReason: string, now: string): Approval;
  };
  conversations: {
    create(title: string, now: string, projectId?: string | null): Conversation;
    list(): Conversation[];
    /** Conversations scoped to one project, plus unscoped conversations. */
    listByProject(projectId: string): Conversation[];
    get(id: string): Conversation | null;
  };
  messages: {
    add(
      conversationId: string,
      role: MessageRole,
      content: string,
      now: string,
    ): Message;
    listForConversation(conversationId: string): Message[];
  };
  state: {
    getValue(key: string): string | null;
    setValue(key: string, value: string): void;
  };
}

export interface StoreOptions {
  /** Invoked after every append; used by the API to feed authenticated SSE streams. */
  onEvent?: (event: Event) => void;
}

export function createStore(db: Db, options: StoreOptions = {}): Store {
  const users = {
    count(): number {
      return db.select().from(schema.users).all().length;
    },
    createOwner(username: string, password: string, now: string): OwnerUser {
      if (users.count() > 0) {
        throw new OwnerExistsError();
      }
      const row = {
        id: randomUUID(),
        username,
        passwordHash: hashPassword(password),
        createdAt: now,
      };
      try {
        db.insert(schema.users).values(row).run();
      } catch (err) {
        // Two concurrent setups can both pass the count check; the unique
        // username constraint is the arbiter, and it maps to the same 409.
        if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
          throw new OwnerExistsError();
        }
        throw err;
      }
      return { id: row.id, username: row.username, createdAt: row.createdAt };
    },
    verifyOwnerCredentials(username: string, password: string): OwnerUser | null {
      const row = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, username))
        .get();
      if (!row || !verifyPassword(row.passwordHash, password)) {
        return null;
      }
      return { id: row.id, username: row.username, createdAt: row.createdAt };
    },
  };

  const sessions = {
    create(input: {
      userId: string;
      csrfToken: string;
      expiresAt: string;
      now: string;
    }): Session {
      const row = {
        id: randomUUID(),
        userId: input.userId,
        csrfToken: input.csrfToken,
        createdAt: input.now,
        lastSeenAt: input.now,
        expiresAt: input.expiresAt,
      };
      db.insert(schema.sessions).values(row).run();
      return row;
    },
    get(id: string): Session | null {
      return db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get() ?? null;
    },
    touch(id: string, now: string): void {
      db.update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, id)).run();
    },
    remove(id: string): void {
      db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
    },
    purgeExpired(now: string): void {
      db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).run();
    },
  };

  const tasks = {
    create(
      input: {
        title: string;
        request: string;
        constraints?: string | null;
        startingUrls?: string[] | null;
        projectId?: string | null;
        kind?: TaskKind;
        exportArgs?: ExportArgs | null;
      },
      now: string,
    ): Task {
      const row = {
        id: randomUUID(),
        title: input.title,
        request: input.request,
        constraints: input.constraints ?? null,
        startingUrls:
          input.startingUrls === undefined || input.startingUrls === null
            ? null
            : JSON.stringify(input.startingUrls),
        projectId: input.projectId ?? null,
        kind: input.kind ?? ('research_brief' as const),
        exportArgs:
          input.exportArgs === undefined || input.exportArgs === null
            ? null
            : JSON.stringify(input.exportArgs),
        state: 'queued' as const,
        attemptCount: 0,
        lastRunId: null,
        resultArtifactId: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(schema.tasks).values(row).run();
      return toTask(row);
    },
    get(id: string): Task | null {
      const row = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
      return row ? toTask(row) : null;
    },
    list(): Task[] {
      return db
        .select()
        .from(schema.tasks)
        .orderBy(desc(schema.tasks.createdAt), sql`rowid desc`)
        .all()
        .map(toTask);
    },
    listByStates(states: readonly TaskState[]): Task[] {
      return db
        .select()
        .from(schema.tasks)
        .where(
          inArray(
            schema.tasks.state,
            states as TaskState[],
          ),
        )
        .all()
        .map(toTask);
    },
    listQueued(): Task[] {
      // Rowid breaks createdAt ties by insertion order: two tasks created in
      // the same millisecond keep true FIFO instead of random uuid order.
      return db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.state, 'queued'))
        .orderBy(asc(schema.tasks.createdAt), sql`rowid asc`)
        .all()
        .map(toTask);
    },
    transition(
      id: string,
      to: TaskState,
      now: string,
      patch?: { error?: string | null; resultArtifactId?: string | null },
    ): Task {
      return db.transaction((tx) => {
        const row = tx.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
        if (!row) {
          throw new TaskNotFoundError(id);
        }
        const next = transitionTask(toTask(row), to, now);
        const updated: Task = {
          ...next,
          ...(patch?.error !== undefined ? { error: patch.error } : {}),
          ...(patch?.resultArtifactId !== undefined
            ? { resultArtifactId: patch.resultArtifactId }
            : {}),
        };
        tx.update(schema.tasks)
          .set({
            state: updated.state,
            updatedAt: updated.updatedAt,
            error: updated.error,
            resultArtifactId: updated.resultArtifactId,
          })
          .where(eq(schema.tasks.id, id))
          .run();
        return updated;
      });
    },
    startRun(id: string, now: string): { task: Task; run: AgentRun } {
      return db.transaction((tx) => {
        const row = tx.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
        if (!row) {
          throw new TaskNotFoundError(id);
        }
        const task = toTask(row);
        if (task.state !== 'queued') {
          throw new InvalidTransitionError(task.state, 'running');
        }
        const attempt = task.attemptCount + 1;
        const runId = randomUUID();
        tx.insert(schema.agentRuns)
          .values({
            id: runId,
            taskId: id,
            attempt,
            state: 'running',
            startedAt: now,
            endedAt: null,
            usageJson: null,
            failureJson: null,
          })
          .run();
        const updatedTask: Task = {
          ...transitionTask(task, 'running', now),
          attemptCount: attempt,
          lastRunId: runId,
          error: null,
        };
        tx.update(schema.tasks)
          .set({
            state: updatedTask.state,
            updatedAt: updatedTask.updatedAt,
            attemptCount: attempt,
            lastRunId: runId,
            error: null,
          })
          .where(eq(schema.tasks.id, id))
          .run();
        const runRow = tx
          .select()
          .from(schema.agentRuns)
          .where(eq(schema.agentRuns.id, runId))
          .get();
        if (!runRow) {
          throw new Error(`run ${runId} disappeared immediately after insert`);
        }
        return { task: updatedTask, run: toAgentRun(runRow) };
      });
    },
  };

  const runs = {
    get(id: string): AgentRun | null {
      const row = db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, id)).get();
      return row ? toAgentRun(row) : null;
    },
    listForTask(taskId: string): AgentRun[] {
      return db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.taskId, taskId))
        .orderBy(asc(schema.agentRuns.attempt))
        .all()
        .map(toAgentRun);
    },
    finish(
      id: string,
      to: RunState,
      now: string,
      details?: { usage?: RunUsage | null; failure?: RunFailure | null },
    ): AgentRun {
      return db.transaction((tx) => {
        const row = tx.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, id)).get();
        if (!row) {
          throw new Error(`run ${id} not found`);
        }
        const next = transitionRun(toAgentRun(row), to, now);
        const usage = details?.usage !== undefined ? details.usage : toAgentRun(row).usage;
        const failure =
          details?.failure !== undefined ? details.failure : toAgentRun(row).failure;
        tx.update(schema.agentRuns)
          .set({
            state: next.state,
            endedAt: next.endedAt,
            usageJson: usage === null ? null : JSON.stringify(usage),
            failureJson: failure === null ? null : JSON.stringify(failure),
          })
          .where(eq(schema.agentRuns.id, id))
          .run();
        return { ...next, usage, failure };
      });
    },
  };

  const events = {
    append(
      type: EventType,
      fields: {
        taskId?: string | null;
        runId?: string | null;
        payload?: Record<string, unknown>;
      },
      now: string,
    ): Event {
      const row = db
        .insert(schema.events)
        .values({
          type,
          taskId: fields.taskId ?? null,
          runId: fields.runId ?? null,
          payloadJson: JSON.stringify(fields.payload ?? {}),
          createdAt: now,
        })
        .returning()
        .get();
      if (!row) {
        throw new Error('event insert returned no row');
      }
      const event = toEvent(row);
      options.onEvent?.(event);
      return event;
    },
    listRecent(limit: number): Event[] {
      return db
        .select()
        .from(schema.events)
        .orderBy(desc(schema.events.id))
        .limit(limit)
        .all()
        .map(toEvent);
    },
    listForTask(taskId: string): Event[] {
      return db
        .select()
        .from(schema.events)
        .where(eq(schema.events.taskId, taskId))
        .orderBy(asc(schema.events.id))
        .all()
        .map(toEvent);
    },
  };

  const artifacts = {
    create(
      taskId: string | null,
      markdown: string,
      now: string,
      kind: ArtifactKind = 'report',
    ): Artifact {
      const row = {
        id: randomUUID(),
        taskId,
        kind,
        markdown,
        createdAt: now,
      };
      db.insert(schema.artifacts).values(row).run();
      return toArtifact(row);
    },
    get(id: string): Artifact | null {
      const row = db.select().from(schema.artifacts).where(eq(schema.artifacts.id, id)).get();
      return row ? toArtifact(row) : null;
    },
    latestForTask(taskId: string): Artifact | null {
      const row = db
        .select()
        .from(schema.artifacts)
        .where(eq(schema.artifacts.taskId, taskId))
        .orderBy(desc(schema.artifacts.createdAt), desc(schema.artifacts.id))
        .get();
      return row ? toArtifact(row) : null;
    },
  };

  const projects = {
    create(
      input: { name: string; instructions?: string | null },
      now: string,
    ): Project {
      const row = {
        id: randomUUID(),
        name: input.name,
        instructions: input.instructions ?? null,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(schema.projects).values(row).run();
      return toProject(row);
    },
    update(
      id: string,
      patch: { name?: string; instructions?: string | null },
      now: string,
    ): Project {
      return db.transaction((tx) => {
        const row = tx.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
        if (!row) {
          throw new ProjectNotFoundError(id);
        }
        const updated: Project = {
          ...toProject(row),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
          updatedAt: now,
        };
        tx.update(schema.projects)
          .set({
            name: updated.name,
            instructions: updated.instructions,
            updatedAt: updated.updatedAt,
          })
          .where(eq(schema.projects.id, id))
          .run();
        return updated;
      });
    },
    get(id: string): Project | null {
      const row = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
      return row ? toProject(row) : null;
    },
    list(): Project[] {
      return db
        .select()
        .from(schema.projects)
        .orderBy(asc(schema.projects.createdAt), sql`rowid asc`)
        .all()
        .map(toProject);
    },
    addGrant(projectId: string, canonicalPath: string, now: string): ProjectFolderGrant {
      const row = {
        id: randomUUID(),
        projectId,
        path: canonicalPath,
        createdAt: now,
      };
      db.insert(schema.projectFolderGrants).values(row).run();
      return toProjectFolderGrant(row);
    },
    removeGrant(projectId: string, grantId: string): void {
      db.delete(schema.projectFolderGrants)
        .where(
          sql`${schema.projectFolderGrants.id} = ${grantId} and ${schema.projectFolderGrants.projectId} = ${projectId}`,
        )
        .run();
    },
    listGrants(projectId: string): ProjectFolderGrant[] {
      return db
        .select()
        .from(schema.projectFolderGrants)
        .where(eq(schema.projectFolderGrants.projectId, projectId))
        .orderBy(asc(schema.projectFolderGrants.createdAt), sql`rowid asc`)
        .all()
        .map(toProjectFolderGrant);
    },
  };

  const exportDestinations = {
    add(canonicalPath: string, now: string): ExportDestination {
      const row = {
        id: randomUUID(),
        path: canonicalPath,
        createdAt: now,
      };
      db.insert(schema.exportDestinations).values(row).run();
      return toExportDestination(row);
    },
    get(id: string): ExportDestination | null {
      const row = db
        .select()
        .from(schema.exportDestinations)
        .where(eq(schema.exportDestinations.id, id))
        .get();
      return row ? toExportDestination(row) : null;
    },
    list(): ExportDestination[] {
      return db
        .select()
        .from(schema.exportDestinations)
        .orderBy(asc(schema.exportDestinations.createdAt), sql`rowid asc`)
        .all()
        .map(toExportDestination);
    },
    remove(id: string): void {
      db.delete(schema.exportDestinations)
        .where(eq(schema.exportDestinations.id, id))
        .run();
    },
  };

  const approvals = {
    create(
      input: {
        taskId: string;
        runId: string;
        artifactId: string;
        destinationId: string;
        destinationPath: string;
        filename: string;
        contentSha256: string;
        expiresAt: string;
      },
      now: string,
    ): Approval {
      const row = {
        id: randomUUID(),
        taskId: input.taskId,
        runId: input.runId,
        action: 'export_file' as const,
        artifactId: input.artifactId,
        destinationId: input.destinationId,
        destinationPath: input.destinationPath,
        filename: input.filename,
        contentSha256: input.contentSha256,
        riskTier: 'telegram' as const,
        state: 'pending' as const,
        requestedAt: now,
        expiresAt: input.expiresAt,
        decidedAt: null,
        executedAt: null,
        outcomeJson: null,
        refusalReason: null,
      };
      db.insert(schema.approvals).values(row).run();
      return toApproval(row);
    },
    get(id: string): Approval | null {
      const row = db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.id, id))
        .get();
      return row ? toApproval(row) : null;
    },
    getForTask(taskId: string): Approval | null {
      const row = db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.taskId, taskId))
        .orderBy(desc(schema.approvals.requestedAt), sql`rowid desc`)
        .get();
      return row ? toApproval(row) : null;
    },
    listByStates(states: readonly ApprovalState[]): Approval[] {
      return db
        .select()
        .from(schema.approvals)
        .where(inArray(schema.approvals.state, states as ApprovalState[]))
        .orderBy(asc(schema.approvals.requestedAt), sql`rowid asc`)
        .all()
        .map(toApproval);
    },
    listAll(): Approval[] {
      return db
        .select()
        .from(schema.approvals)
        .orderBy(desc(schema.approvals.requestedAt), sql`rowid desc`)
        .all()
        .map(toApproval);
    },
    decide(
      id: string,
      to: 'granted' | 'rejected' | 'canceled' | 'expired',
      now: string,
    ): Approval {
      return db.transaction((tx) => {
        const row = tx
          .select()
          .from(schema.approvals)
          .where(eq(schema.approvals.id, id))
          .get();
        if (!row) {
          throw new ApprovalNotFoundError(id);
        }
        const next = transitionApproval(toApproval(row), to, now);
        tx.update(schema.approvals)
          .set({ state: next.state, decidedAt: next.decidedAt })
          .where(eq(schema.approvals.id, id))
          .run();
        return next;
      });
    },
    markExecuted(id: string, outcome: ApprovalOutcome, now: string): Approval {
      return db.transaction((tx) => {
        const row = tx
          .select()
          .from(schema.approvals)
          .where(eq(schema.approvals.id, id))
          .get();
        if (!row) {
          throw new ApprovalNotFoundError(id);
        }
        const next = transitionApproval(toApproval(row), 'executed', now);
        const updated: Approval = {
          ...next,
          executedAt: now,
          outcome,
        };
        tx.update(schema.approvals)
          .set({
            state: updated.state,
            executedAt: updated.executedAt,
            outcomeJson: JSON.stringify(outcome),
          })
          .where(eq(schema.approvals.id, id))
          .run();
        return updated;
      });
    },
    markRefused(id: string, refusalReason: string, now: string): Approval {
      return db.transaction((tx) => {
        const row = tx
          .select()
          .from(schema.approvals)
          .where(eq(schema.approvals.id, id))
          .get();
        if (!row) {
          throw new ApprovalNotFoundError(id);
        }
        const next = transitionApproval(toApproval(row), 'canceled', now);
        const updated: Approval = { ...next, refusalReason };
        tx.update(schema.approvals)
          .set({ state: updated.state, refusalReason })
          .where(eq(schema.approvals.id, id))
          .run();
        return updated;
      });
    },
  };

  const conversations = {
    create(title: string, now: string, projectId?: string | null): Conversation {
      const row = {
        id: randomUUID(),
        title,
        projectId: projectId ?? null,
        createdAt: now,
      };
      db.insert(schema.conversations).values(row).run();
      return toConversation(row);
    },
    list(): Conversation[] {
      return db
        .select()
        .from(schema.conversations)
        .orderBy(desc(schema.conversations.createdAt))
        .all()
        .map(toConversation);
    },
    listByProject(projectId: string): Conversation[] {
      return db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.projectId, projectId))
        .orderBy(desc(schema.conversations.createdAt))
        .all()
        .map(toConversation);
    },
    get(id: string): Conversation | null {
      const row = db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).get() ?? null;
      return row ? toConversation(row) : null;
    },
  };

  const messages = {
    add(conversationId: string, role: MessageRole, content: string, now: string): Message {
      const row = {
        id: randomUUID(),
        conversationId,
        role,
        content,
        createdAt: now,
      };
      db.insert(schema.messages).values(row).run();
      return row;
    },
    listForConversation(conversationId: string): Message[] {
      return db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
        .all()
        .map((row) =>
          messageSchema.parse({
            id: row.id,
            conversationId: row.conversationId,
            role: row.role,
            content: row.content,
            createdAt: row.createdAt,
          }),
        );
    },
  };

  const state = {
    getValue(key: string): string | null {
      const row = db.select().from(schema.appState).where(eq(schema.appState.key, key)).get();
      return row?.value ?? null;
    },
    setValue(key: string, value: string): void {
      db.insert(schema.appState)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.appState.key, set: { value } })
        .run();
    },
  };

  return {
    users,
    sessions,
    tasks,
    runs,
    events,
    artifacts,
    projects,
    exportDestinations,
    approvals,
    conversations,
    messages,
    state,
  };
}

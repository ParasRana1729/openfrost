import { randomUUID } from 'node:crypto';
import { asc, desc, eq, inArray, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  InvalidTransitionError,
  messageSchema,
  transitionRun,
  transitionTask,
  type AgentRun,
  type Artifact,
  type Conversation,
  type Event,
  type EventType,
  type Message,
  type MessageRole,  type RunFailure,
  type RunState,
  type RunUsage,
  type Task,
  type TaskState,
} from '@openfrost/domain';
import { toAgentRun, toArtifact, toEvent, toTask } from './mappers.js';
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
    create(input: { title: string; request: string }, now: string): Task;
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
    create(taskId: string | null, markdown: string, now: string): Artifact;
    get(id: string): Artifact | null;
    latestForTask(taskId: string): Artifact | null;
  };
  conversations: {
    create(title: string, now: string): Conversation;
    list(): Conversation[];
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
      db.insert(schema.users).values(row).run();
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
    create(input: { title: string; request: string }, now: string): Task {
      const row = {
        id: randomUUID(),
        title: input.title,
        request: input.request,
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
        .orderBy(desc(schema.tasks.createdAt), desc(schema.tasks.id))
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
      return db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.state, 'queued'))
        .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.id))
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
    create(taskId: string | null, markdown: string, now: string): Artifact {
      const row = {
        id: randomUUID(),
        taskId,
        kind: 'report' as const,
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

  const conversations = {
    create(title: string, now: string): Conversation {
      const row = { id: randomUUID(), title, createdAt: now };
      db.insert(schema.conversations).values(row).run();
      return row;
    },
    list(): Conversation[] {
      return db
        .select()
        .from(schema.conversations)
        .orderBy(desc(schema.conversations.createdAt))
        .all();
    },
    get(id: string): Conversation | null {
      return db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).get() ?? null;
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

  return { users, sessions, tasks, runs, events, artifacts, conversations, messages, state };
}

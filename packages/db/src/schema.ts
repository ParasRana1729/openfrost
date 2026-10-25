import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * SQLite schema (spec §7 storage ownership). Structured state lives here;
 * approved memory content stays in Markdown outside this database.
 * All timestamps are ISO-8601 UTC strings.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  csrfToken: text('csrf_token').notNull(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  request: text('request').notNull(),
  constraints: text('constraints'),
  /** JSON array of http(s) URLs, or null. */
  startingUrls: text('starting_urls'),
  state: text('state').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastRunId: text('last_run_id'),
  resultArtifactId: text('result_artifact_id'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  attempt: integer('attempt').notNull(),
  state: text('state').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  usageJson: text('usage_json'),
  failureJson: text('failure_json'),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  taskId: text('task_id'),
  kind: text('kind').notNull(),
  markdown: text('markdown').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Append-only activity log; rows are never updated or deleted. */
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  taskId: text('task_id'),
  runId: text('run_id'),
  payloadJson: text('payload_json').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Small key/value table for non-secret runtime state (dispatch pause, onboarding). */
export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

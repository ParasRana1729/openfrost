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
  projectId: text('project_id'),
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

/**
 * Projects scope one assistant's context (spec §4). Deleting projects is not
 * supported in v0.1, so tasks can reference projects without cascade rules.
 */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  instructions: text('instructions'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Folder roots the owner explicitly granted to a project. `path` stores the
 * canonical absolute path recorded at grant time; tool execution re-checks it.
 */
export const projectFolderGrants = sqliteTable('project_folder_grants', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  path: text('path').notNull(),
  createdAt: text('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  request: text('request').notNull(),
  constraints: text('constraints'),
  /** JSON array of http(s) URLs, or null. */
  startingUrls: text('starting_urls'),
  projectId: text('project_id'),
  /** 'research_brief' | 'project_update' | 'export_report' (spec workflows). */
  kind: text('kind').notNull().default('research_brief'),
  /** JSON export arguments (artifactId, destinationId, filename); export tasks only. */
  exportArgs: text('export_args'),
  state: text('state').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastRunId: text('last_run_id'),
  resultArtifactId: text('result_artifact_id'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Owner-granted canonical folder roots that approved exports may write
 * into. v0.1 exposes this only in Settings; deleting a destination stops
 * future exports but never touches files already written.
 */
export const exportDestinations = sqliteTable('export_destinations', {
  id: text('id').primaryKey(),
  path: text('path').notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * Owner decisions on consequential actions (spec §6). The proposed action
 * is snapshotted immutably; rows are never deleted — decisions, expiries,
 * and refusals remain auditable.
 */
export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  runId: text('run_id').notNull(),
  action: text('action').notNull(),
  artifactId: text('artifact_id').notNull(),
  destinationId: text('destination_id').notNull(),
  destinationPath: text('destination_path').notNull(),
  filename: text('filename').notNull(),
  contentSha256: text('content_sha256').notNull(),
  riskTier: text('risk_tier').notNull(),
  state: text('state').notNull(),
  requestedAt: text('requested_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  decidedAt: text('decided_at'),
  executedAt: text('executed_at'),
  outcomeJson: text('outcome_json'),
  refusalReason: text('refusal_reason'),
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

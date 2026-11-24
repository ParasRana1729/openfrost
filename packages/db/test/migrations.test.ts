import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { databasePath, ensureHomeLayout, openDatabase } from '../src/index.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const indexes = [
  ['events', 'task_id'],
  ['agent_runs', 'task_id'],
  ['artifacts', 'task_id'],
  ['tasks', 'state'],
  ['approvals', 'task_id'],
  ['approvals', 'state'],
  ['project_folder_grants', 'project_id'],
  ['routines', 'state'],
] as const;

function expectIndexes(sqlite: InstanceType<typeof Database>): void {
  for (const [table, column] of indexes) {
    const name = `${table}_${column}_idx`;
    expect(sqlite.prepare('SELECT tbl_name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('index', name)).toEqual({ tbl_name: table });
    expect(sqlite.pragma(`index_info('${name}')`)).toEqual([
      expect.objectContaining({ name: column }),
    ]);
    expect(sqlite.pragma(`index_list('${table}')`)).toContainEqual(
      expect.objectContaining({ name, unique: 0, partial: 0 }),
    );
  }
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get())
    .toEqual({ count: 7 });
}

function rows(sqlite: InstanceType<typeof Database>): Record<string, unknown[]> {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [
    name, sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ]));
}

describe('0006 secondary indexes', () => {
  it('creates all eight non-unique single-column indexes on a fresh database', () => {
    const home = mkdtempSync(join(tmpdir(), 'openfrost-fresh-indexes-'));
    const opened = openDatabase(home);
    try {
      expectIndexes(opened.sqlite);
    } finally {
      opened.sqlite.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('upgrades a populated 0005 database without changing rows and is restart-safe', () => {
    const home = mkdtempSync(join(tmpdir(), 'openfrost-upgrade-indexes-'));
    const oldMigrations = join(home, 'old-migrations');
    mkdirSync(join(oldMigrations, 'meta'), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries = journal.entries.filter(({ idx }) => idx < 6);
    expect(journal.entries).toHaveLength(6);
    for (const { tag } of journal.entries) {
      copyFileSync(join(migrationsFolder, `${tag}.sql`), join(oldMigrations, `${tag}.sql`));
    }
    writeFileSync(join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
    ensureHomeLayout(home);
    const legacy = new Database(databasePath(home));
    let before: Record<string, unknown[]>;
    try {
      legacy.pragma('foreign_keys = ON');
      migrate(drizzle(legacy), { migrationsFolder: oldMigrations });
      legacy.exec(`
        INSERT INTO users VALUES ('owner', 'owner', 'legacy-password-hash', '2026-10-23');
        INSERT INTO sessions VALUES ('session', 'owner', 'csrf', '2026-10-23', '2026-10-23', '2099-01-01');
        INSERT INTO projects VALUES ('project', 'Project', 'Keep these instructions', '2026-10-23', '2026-10-23');
        INSERT INTO project_folder_grants VALUES ('grant', 'project', 'C:/granted-notes', '2026-10-23');
        INSERT INTO tasks (id, title, request, state, created_at, updated_at, project_id)
          VALUES ('task', 'Task', 'Keep this request', 'completed', '2026-10-23', '2026-10-23', 'project');
        INSERT INTO agent_runs (id, task_id, attempt, state, started_at)
          VALUES ('run', 'task', 1, 'completed', '2026-10-23');
        INSERT INTO artifacts VALUES ('artifact', 'task', 'research_brief', '# Keep this report', '2026-10-23');
        INSERT INTO events (type, task_id, run_id, payload_json, created_at)
          VALUES ('task.created', 'task', 'run', '{"title":"Task"}', '2026-10-23');
        INSERT INTO approvals (id, task_id, run_id, action, artifact_id, destination_id, destination_path,
          filename, content_sha256, risk_tier, state, requested_at, expires_at)
          VALUES ('approval', 'task', 'run', 'export_report', 'artifact', 'destination', 'C:/exports',
            'report.md', 'content-hash', 'telegram', 'pending', '2026-10-23', '2099-01-01');
        INSERT INTO routines (id, name, project_id, timezone, schedule_json, template_json,
          state, window_start_at, created_at, updated_at)
          VALUES ('routine', 'Routine', 'project', 'UTC', '{"kind":"daily","time":"09:00"}', '{}',
            'active', '2026-10-23', '2026-10-23', '2026-10-23');
      `);
      for (const [table, column] of indexes) {
        expect(legacy.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
          .get('index', `${table}_${column}_idx`)).toBeUndefined();
      }
      before = rows(legacy);
    } finally {
      legacy.close();
    }
    try {
      for (let restart = 0; restart < 2; restart++) {
        const opened = openDatabase(home);
        try {
          expectIndexes(opened.sqlite);
          expect(rows(opened.sqlite)).toEqual(before);
          expect(opened.sqlite.pragma('foreign_key_check')).toEqual([]);
          expect(opened.sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        } finally {
          opened.sqlite.close();
        }
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

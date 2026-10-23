import * as path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { databasePath, ensureHomeLayout, resolveHome } from './paths.js';
import * as schema from './schema.js';

export interface OpenDatabaseResult {
  sqlite: InstanceType<typeof Database>;
  db: BetterSqliteDb;
  home: string;
}

export type BetterSqliteDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Open (and migrate) the canonical SQLite database beneath the OpenFrost
 * home directory. Existing data is preserved: migrations only move the
 * schema forward and never reset the database.
 */
export function openDatabase(homeInput?: string): OpenDatabaseResult {
  const home = homeInput ?? resolveHome();
  ensureHomeLayout(home);
  const sqlite = new Database(databasePath(home));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  // dist/db.js sits one level below the package root, next to /drizzle.
  migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  return { sqlite, db, home };
}

export { schema };

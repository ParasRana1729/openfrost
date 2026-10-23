import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Resolve the OpenFrost home directory (spec §7). `OPENFROST_HOME` overrides
 * the default `%USERPROFILE%\\.openfrost` — used by tests and nothing else.
 */
export function resolveHome(): string {
  return process.env.OPENFROST_HOME ?? path.join(os.homedir(), '.openfrost');
}

export function ensureHomeLayout(home: string): void {
  for (const dir of [
    home,
    path.join(home, 'db'),
    path.join(home, 'secrets'),
    path.join(home, 'memory'),
    path.join(home, 'projects'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function databasePath(home: string): string {
  return path.join(home, 'db', 'openfrost.db');
}

export function secretsDir(home: string): string {
  return path.join(home, 'secrets');
}

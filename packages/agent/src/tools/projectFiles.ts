import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTool, FileAccessRecord, RunToolContext } from './types.js';

/**
 * Granted-folder access for project updates (S03). This module is the file
 * trust boundary (spec §6): paths are canonicalized with realpath so
 * junctions/symlinks resolve, containment is re-checked after resolution,
 * credential/configuration stores are excluded by name, and every grant is
 * re-read from the store at execution time — including for tasks that waited
 * in the queue — so a revoked grant stops granting immediately.
 *
 * Checks are an application boundary, not an OS sandbox; reads are bounded.
 */

/** Readable files per project run. */
export const MAX_PROJECT_FILES = 50;
/** Per-file size bound; larger files are skipped and reported. */
export const MAX_FILE_BYTES = 512 * 1024;
/** Characters handed to the model per file (the executor caps tool results at this size too). */
export const MAX_FILE_CHARS = 20_000;
/** Total directory entries inspected per inventory walk; stops runaway trees. */
export const MAX_WALK_ENTRIES = 2_000;

const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.markdown', '.txt']);

/** Directory names never descended into, wherever they appear. */
const DENIED_DIR_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.svn',
  '.hg',
  '.ssh',
  '.aws',
  '.azure',
  '.kube',
  '.gnupg',
  '.docker',
  '.config',
  '.openfrost',
  'node_modules',
]);

/** File-name patterns for credential/configuration stores. */
const DENIED_FILE_NAME_PATTERNS: readonly RegExp[] = [
  /^\.env(\..+)?$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.git-credentials$/i,
  /^\.gitconfig$/i,
  /^\.htpasswd$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)(\..+)?$/i,
  /^credentials\.json$/i,
  /^secrets?\.json$/i,
];

const DENIED_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pem',
  '.key',
  '.pfx',
  '.p12',
  '.kdbx',
  '.keystore',
  '.jks',
]);

export interface PathCheck {
  ok: boolean;
  canonical: string;
  reason?: string;
}

function fail(reason: string): PathCheck {
  return { ok: false, canonical: '', reason };
}

/** Case-folding key so Windows path comparisons are case-insensitive. */
function pathKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** Structural absoluteness check before any filesystem access. */
export function checkAbsolutePath(input: string): PathCheck {
  if (input.length === 0 || input.includes('\0')) {
    return fail('path is empty or contains a null byte');
  }
  if (process.platform === 'win32') {
    if (!/^[a-zA-Z]:[\\/]/.test(input)) {
      return fail('expected an absolute Windows path (for example C:\\notes)');
    }
  } else if (!input.startsWith('/')) {
    return fail('expected an absolute path');
  }
  return { ok: true, canonical: path.normalize(input) };
}

/**
 * Canonicalizes an existing path: resolves symlinks and Windows junctions,
 * normalizes separators, and fails when the path does not exist.
 */
export function canonicalizeExistingPath(input: string): PathCheck {
  const structural = checkAbsolutePath(input);
  if (!structural.ok) {
    return structural;
  }
  try {
    return { ok: true, canonical: fs.realpathSync(structural.canonical) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'error';
    return fail(
      code === 'ENOENT' ? 'path does not exist' : `path cannot be canonicalized (${code})`,
    );
  }
}

/** Strict containment: `child` must be inside `root`, never equal to it. */
export function isInsideRoot(childCanonical: string, rootCanonical: string): boolean {
  const child = pathKey(childCanonical);
  const root = pathKey(rootCanonical);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return child !== root && child.startsWith(prefix);
}

export interface GrantValidationOptions {
  /** The OpenFrost home directory; grants covering it are refused. */
  home: string;
}

/**
 * Grant-time validation for a folder root: it must exist, be a directory,
 * and not cover a drive/filesystem root or the OpenFrost data directory
 * (including any ancestor that contains it). The returned canonical path is
 * what the store records; every later execution re-canonicalizes against it.
 */
export function validateGrantPath(input: string, options: GrantValidationOptions): PathCheck {
  const check = canonicalizeExistingPath(input);
  if (!check.ok) {
    return check;
  }
  const canonical = check.canonical;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(canonical);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'error';
    return fail(`path cannot be inspected (${code})`);
  }
  if (!stat.isDirectory()) {
    return fail('grant path must be a folder');
  }
  if (path.parse(canonical).root === canonical) {
    return fail('refusing to grant a drive or filesystem root');
  }
  let homeCanonical: string;
  try {
    homeCanonical = fs.realpathSync(options.home);
  } catch {
    homeCanonical = options.home;
  }
  const home = pathKey(homeCanonical);
  const candidate = pathKey(canonical);
  const prefix = home.endsWith(path.sep) ? home : home + path.sep;
  if (candidate === home || candidate.startsWith(prefix)) {
    return fail('refusing to grant a folder inside the OpenFrost data directory');
  }
  const candidatePrefix = candidate.endsWith(path.sep) ? candidate : candidate + path.sep;
  if (home.startsWith(candidatePrefix)) {
    return fail('refusing to grant a folder that contains the OpenFrost data directory');
  }
  return { ok: true, canonical };
}

export interface GrantRootView {
  id: string;
  /** Canonical path as recorded at grant time. */
  path: string;
}

export interface GrantRootStatus {
  status: 'valid' | 'unavailable' | 'changed';
  canonical: string;
  reason?: string;
}

/**
 * Execution-time revalidation of one granted root: the stored canonical path
 * must still resolve to itself. A deleted folder is `unavailable`; a path
 * that now resolves elsewhere (moved, replaced by a junction) is `changed`.
 * Either way the grant stops granting immediately.
 */
export function revalidateGrantRoot(grantedPath: string): GrantRootStatus {
  const check = canonicalizeExistingPath(grantedPath);
  if (!check.ok) {
    return { status: 'unavailable', canonical: grantedPath, reason: check.reason };
  }
  if (pathKey(check.canonical) !== pathKey(grantedPath)) {
    return {
      status: 'changed',
      canonical: check.canonical,
      reason:
        'granted folder path no longer resolves to the folder that was granted ' +
        '(it may have been moved or replaced by a junction/symlink)',
    };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(check.canonical);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'error';
    return { status: 'unavailable', canonical: check.canonical, reason: `path cannot be inspected (${code})` };
  }
  if (!stat.isDirectory()) {
    return { status: 'changed', canonical: check.canonical, reason: 'granted path is no longer a folder' };
  }
  return { status: 'valid', canonical: check.canonical };
}

function isDeniedFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (DENIED_FILE_EXTENSIONS.has(path.extname(lower))) {
    return true;
  }
  return DENIED_FILE_NAME_PATTERNS.some((pattern) => pattern.test(lower));
}

export interface ProjectFileInventory {
  entries: FileAccessRecord[];
  availableCount: number;
}

/**
 * Enumerates readable files beneath the given grants. Every entry — readable,
 * skipped, denied, or failed — becomes a record so skipped sources are
 * visible to both the model and the owner. Roots are revalidated first; a
 * root that no longer resolves to its granted path is recorded as an error.
 */
export function collectProjectFiles(roots: GrantRootView[]): ProjectFileInventory {
  const entries: FileAccessRecord[] = [];
  let fileCount = 0;
  let statBudget = MAX_WALK_ENTRIES;
  let budgetExhausted = false;

  const noteBudgetExhausted = (where: string): void => {
    if (budgetExhausted) {
      return;
    }
    budgetExhausted = true;
    entries.push({
      path: where,
      status: 'limit',
      reason: `stopped enumerating after ${MAX_WALK_ENTRIES} entries (bounded reads)`,
    });
  };

  for (const root of roots) {
    if (fileCount >= MAX_PROJECT_FILES) {
      entries.push({
        path: root.path,
        status: 'limit',
        reason: `file limit (${MAX_PROJECT_FILES} files) reached; this folder was not enumerated`,
      });
      continue;
    }
    const rootStatus = revalidateGrantRoot(root.path);
    if (rootStatus.status !== 'valid') {
      entries.push({
        path: root.path,
        status: 'root_error',
        reason: rootStatus.reason ?? 'granted folder is not accessible',
      });
      continue;
    }
    const rootCanonical = rootStatus.canonical;
    const visitedDirs = new Set<string>([pathKey(rootCanonical)]);

    const walk = (dir: string): void => {
      if (budgetExhausted || fileCount >= MAX_PROJECT_FILES) {
        return;
      }
      if (statBudget <= 0) {
        noteBudgetExhausted(dir);
        return;
      }
      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? 'error';
        entries.push({ path: dir, status: 'skipped', reason: `folder could not be read (${code})` });
        return;
      }
      dirents.sort((a, b) => a.name.localeCompare(b.name));
      for (const dirent of dirents) {
        if (budgetExhausted || fileCount >= MAX_PROJECT_FILES) {
          entries.push({
            path: dir,
            status: 'limit',
            reason: `file limit (${MAX_PROJECT_FILES} files) reached; further entries were not enumerated`,
          });
          return;
        }
        const fullPath = path.join(dir, dirent.name);
        const isDirish = dirent.isDirectory() || dirent.isSymbolicLink();
        if (isDirish && DENIED_DIR_NAMES.has(dirent.name.toLowerCase())) {
          entries.push({
            path: fullPath,
            status: 'skipped',
            reason: 'denied folder (credential/configuration store)',
          });
          continue;
        }
        if (!isDirish && isDeniedFileName(dirent.name)) {
          entries.push({
            path: fullPath,
            status: 'skipped',
            reason: 'denied file (credential/configuration store)',
          });
          continue;
        }
        if (statBudget <= 0) {
          noteBudgetExhausted(dir);
          return;
        }
        statBudget -= 1;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          entries.push({ path: fullPath, status: 'skipped', reason: 'entry could not be inspected' });
          continue;
        }
        if (stat.isDirectory()) {
          // realpath resolves junctions/symlinks; the resolved folder must
          // stay inside the granted root and must not revisit (cycles).
          const resolved = canonicalizeExistingPath(fullPath);
          if (!resolved.ok) {
            entries.push({ path: fullPath, status: 'skipped', reason: resolved.reason });
            continue;
          }
          if (!isInsideRoot(resolved.canonical, rootCanonical)) {
            entries.push({
              path: fullPath,
              status: 'skipped',
              reason: 'junction/symlink escapes the granted folder',
            });
            continue;
          }
          const resolvedKey = pathKey(resolved.canonical);
          if (visitedDirs.has(resolvedKey)) {
            entries.push({ path: fullPath, status: 'skipped', reason: 'circular junction skipped' });
            continue;
          }
          visitedDirs.add(resolvedKey);
          walk(resolved.canonical);
          if (budgetExhausted) {
            return;
          }
          continue;
        }
        if (!stat.isFile()) {
          entries.push({ path: fullPath, status: 'skipped', reason: 'unsupported entry type' });
          continue;
        }
        if (isDeniedFileName(dirent.name)) {
          entries.push({
            path: fullPath,
            status: 'skipped',
            reason: 'denied file (credential/configuration store)',
          });
          continue;
        }
        const extension = path.extname(dirent.name).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(extension)) {
          entries.push({
            path: fullPath,
            status: 'skipped',
            reason: `unsupported file type (${extension || 'no extension'})`,
          });
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) {
          entries.push({
            path: fullPath,
            status: 'skipped',
            reason: `file exceeds the ${MAX_FILE_BYTES} byte size limit`,
            sizeBytes: stat.size,
          });
          continue;
        }
        const resolved = canonicalizeExistingPath(fullPath);
        if (!resolved.ok || !isInsideRoot(resolved.canonical, rootCanonical)) {
          entries.push({
            path: fullPath,
            status: 'skipped',
            reason: 'symlink escapes the granted folder',
          });
          continue;
        }
        fileCount += 1;
        entries.push({ path: resolved.canonical, status: 'available', sizeBytes: stat.size });
      }
    };

    walk(rootCanonical);
  }
  return { entries, availableCount: fileCount };
}

export interface ReadProjectFileToolOptions {
  /**
   * Returns the project's grants. Called on every tool execution so grants
   * revoked after enqueue (or mid-run) stop granting at once (spec §6:
   * revalidate permissions at execution).
   */
  getRoots: () => Promise<GrantRootView[]> | GrantRootView[];
}

/**
 * `read_project_file` reads one granted project file as plain text. The model
 * can only pass absolute paths listed in its task message; anything outside
 * the currently granted roots — including paths that reach outside through a
 * junction or symlink — is refused, and every attempt is recorded.
 */
export function createReadProjectFileTool(options: ReadProjectFileToolOptions): AgentTool {
  return {
    definition: {
      name: 'read_project_file',
      description:
        'Read one granted project file (.md, .markdown, or .txt) as plain text. ' +
        'Use an absolute path exactly as listed in the task message. Paths outside ' +
        'the folders granted to this project are refused.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },

    async execute(
      argsJson: string,
      ctx: RunToolContext,
      signal: AbortSignal,
    ): Promise<{ ok: boolean; content: string }> {
      const startedAt = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(argsJson);
      } catch {
        return { ok: false, content: 'Invalid arguments: expected { "path": string }' };
      }
      const record = parsed as Record<string, unknown>;
      const requested =
        typeof record.path === 'string' && record.path.length > 0 ? record.path : null;
      if (!requested) {
        return { ok: false, content: 'Invalid arguments: expected { "path": string }' };
      }
      const failWith = (reason: string): { ok: boolean; content: string } => {
        ctx.recordFileAccess({
          path: requested,
          status: 'failed',
          reason,
          ms: Date.now() - startedAt,
        });
        return { ok: false, content: reason };
      };

      if (signal.aborted) {
        return failWith('run canceled');
      }

      // Re-read the grants at execution time: revocation between enqueue and
      // now (or between two reads) takes effect immediately.
      let roots: GrantRootView[];
      try {
        roots = await options.getRoots();
      } catch (err) {
        return failWith(`grants could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (roots.length === 0) {
        return failWith(
          'Blocked: no folders are currently granted to this project (access may have been revoked)',
        );
      }

      const structural = checkAbsolutePath(requested);
      if (!structural.ok) {
        return failWith(`Blocked: ${structural.reason}`);
      }

      // Revalidate each root, then a lexical gate before touching the
      // filesystem: the requested path must normalize inside one of the
      // currently valid roots, so probing arbitrary paths cannot even
      // distinguish existing from missing files.
      const normalized = pathKey(path.normalize(requested));
      const validRoots: string[] = [];
      for (const root of roots) {
        const status = revalidateGrantRoot(root.path);
        if (status.status === 'valid') {
          validRoots.push(status.canonical);
        }
      }
      const lexicallyInside = validRoots.some((rootCanonical) => {
        const rootKey = pathKey(rootCanonical);
        const prefix = rootKey.endsWith(path.sep) ? rootKey : rootKey + path.sep;
        return normalized.startsWith(prefix) && normalized !== rootKey;
      });
      if (validRoots.length === 0) {
        return failWith(
          'Blocked: none of the granted folders is currently accessible ' +
            '(grants may have been revoked or the folder moved)',
        );
      }
      if (!lexicallyInside) {
        return failWith(
          'Blocked: path is outside the folders currently granted to this project',
        );
      }

      // Canonicalize and re-check containment so junction/symlink escapes
      // fail closed even when the lexical path looked inside.
      const resolved = canonicalizeExistingPath(requested);
      if (!resolved.ok) {
        return failWith(`File unavailable: ${resolved.reason}`);
      }
      if (!validRoots.some((rootCanonical) => isInsideRoot(resolved.canonical, rootCanonical))) {
        return failWith(
          'Blocked: path resolves outside the granted folder (junction/symlink escape)',
        );
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(resolved.canonical);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? 'error';
        return failWith(`File unavailable: cannot be inspected (${code})`);
      }
      if (!stat.isFile()) {
        return failWith('File unavailable: path is not a file');
      }
      if (isDeniedFileName(path.basename(resolved.canonical))) {
        return failWith('Blocked: denied file (credential/configuration store)');
      }
      const extension = path.extname(resolved.canonical).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        return failWith(`Blocked: unsupported file type (${extension || 'no extension'})`);
      }
      if (stat.size > MAX_FILE_BYTES) {
        return failWith(`Blocked: file exceeds the ${MAX_FILE_BYTES} byte size limit`);
      }

      let text: string;
      try {
        text = fs.readFileSync(resolved.canonical, 'utf8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? 'error';
        return failWith(`File unavailable: could not be read (${code})`);
      }
      const truncated = text.length > MAX_FILE_CHARS;
      if (truncated) {
        text = text.slice(0, MAX_FILE_CHARS);
      }
      ctx.recordFileAccess({
        path: resolved.canonical,
        status: 'read',
        chars: text.length,
        sizeBytes: stat.size,
        ms: Date.now() - startedAt,
      });
      return {
        ok: true,
        content: JSON.stringify({
          path: resolved.canonical,
          chars: text.length,
          truncated,
          text,
        }),
      };
    },
  };
}

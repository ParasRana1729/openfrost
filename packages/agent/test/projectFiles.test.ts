import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_FILE_CHARS,
  MAX_PROJECT_FILES,
  canonicalizeExistingPath,
  checkAbsolutePath,
  collectProjectFiles,
  createReadProjectFileTool,
  isInsideRoot,
  revalidateGrantRoot,
  validateGrantPath,
  type FileAccessRecord,
  type GrantRootView,
} from '../src/index.js';

const IS_WINDOWS = process.platform === 'win32';

let root: string;
let home: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'openfrost-files-'));
  home = fs.mkdtempSync(path.join(root, 'of-home-'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function makeDir(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(dir: string, name: string, content: string | Buffer): string {
  const full = path.join(dir, name);
  fs.writeFileSync(full, content);
  return full;
}

/** A record-collecting RunToolContext stub. */
function makeCtx() {
  const records: FileAccessRecord[] = [];
  return {
    records,
    recordRetrieval: () => undefined,
    recordFileAccess: (r: FileAccessRecord) => records.push(r),
  };
}

describe('absolute path checks', () => {
  it('rejects relative, empty, and null-byte paths before touching the filesystem', () => {
    expect(checkAbsolutePath('notes/idea.md').ok).toBe(false);
    expect(checkAbsolutePath('').ok).toBe(false);
    expect(checkAbsolutePath('C:\\notes\0.md').ok).toBe(false);
  });

  it('canonicalizes existing paths through realpath', () => {
    const dir = makeDir('canonical');
    const file = writeFile(dir, 'note.md', 'hello');
    const check = canonicalizeExistingPath(file);
    expect(check.ok).toBe(true);
    expect(fs.existsSync(check.canonical)).toBe(true);
    expect(canonicalizeExistingPath(path.join(dir, 'missing.md')).ok).toBe(false);
  });

  it('requires strict containment inside the root', () => {
    const parent = makeDir('contain');
    const child = path.join(parent, 'sub');
    fs.mkdirSync(child);
    expect(isInsideRoot(child, parent)).toBe(true);
    expect(isInsideRoot(parent, parent)).toBe(false);
    expect(isInsideRoot(parent + 'sibling', parent)).toBe(false);
    expect(isInsideRoot(path.dirname(parent), parent)).toBe(false);
  });
});

describe('grant-time validation', () => {
  it('accepts a real folder and returns its canonical path', () => {
    const dir = makeDir('grant-ok');
    const check = validateGrantPath(dir, { home });
    expect(check.ok).toBe(true);
    expect(check.canonical).toBe(fs.realpathSync(dir));
  });

  it('rejects missing paths, files, and drive/filesystem roots', () => {
    expect(validateGrantPath(path.join(root, 'nope'), { home }).ok).toBe(false);
    const file = writeFile(root, 'plain.txt', 'x');
    expect(validateGrantPath(file, { home }).ok).toBe(false);
    expect(validateGrantPath(path.parse(root).root, { home }).ok).toBe(false);
  });

  it('rejects the OpenFrost home, folders inside it, and folders containing it', () => {
    expect(validateGrantPath(home, { home }).ok).toBe(false);
    const insideHome = path.join(home, 'sub');
    fs.mkdirSync(insideHome);
    expect(validateGrantPath(insideHome, { home }).ok).toBe(false);
    // The temp root contains the home directory, so granting it would scan
    // the data directory: refused.
    expect(validateGrantPath(root, { home }).ok).toBe(false);
  });
});

describe('execution-time root revalidation', () => {
  it('accepts an unchanged root', () => {
    const dir = makeDir('stable-root');
    const status = revalidateGrantRoot(fs.realpathSync(dir));
    expect(status.status).toBe('valid');
    expect(status.canonical).toBe(fs.realpathSync(dir));
  });

  it('reports unavailable when the folder is gone', () => {
    const dir = makeDir('vanishing-root');
    const canonical = fs.realpathSync(dir);
    fs.rmdirSync(dir);
    const status = revalidateGrantRoot(canonical);
    expect(status.status).toBe('unavailable');
  });

  it('reports changed when the path now resolves elsewhere (junction swap)', () => {
    const dir = makeDir('swap-root');
    const canonical = fs.realpathSync(dir);
    const elsewhere = makeDir('swap-target');
    fs.rmdirSync(dir);
    // Junctions (Windows) / directory symlinks (POSIX) do not require
    // elevated privileges, unlike file symlinks on Windows.
    fs.symlinkSync(elsewhere, dir, IS_WINDOWS ? 'junction' : 'dir');
    try {
      const status = revalidateGrantRoot(canonical);
      expect(status.status).toBe('changed');
    } finally {
      fs.rmSync(dir, { force: true });
    }
  });
});

describe('collectProjectFiles', () => {
  it('lists readable files and records every skipped source with a reason', () => {
    const dir = makeDir('inventory');
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    writeFile(dir, 'idea.md', 'an idea');
    writeFile(dir, 'notes.txt', 'text notes');
    writeFile(dir, 'skip.log', 'binary-ish');
    writeFile(dir, '.env', 'SECRET=1');
    writeFile(dir, 'table.md', 'x');
    writeFile(sub, 'nested.md', 'nested note');
    fs.mkdirSync(path.join(dir, '.ssh'));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    writeFile(path.join(dir, 'node_modules'), 'dep.md', 'dep');

    const inventory = collectProjectFiles([
      { id: 'g1', path: fs.realpathSync(dir) },
    ]);
    const available = inventory.entries.filter((e) => e.status === 'available');
    expect(available.map((e) => path.basename(e.path)).sort()).toEqual([
      'idea.md',
      'nested.md',
      'notes.txt',
      'table.md',
    ]);
    const skipped = inventory.entries.filter((e) => e.status === 'skipped');
    expect(skipped.some((e) => e.path.endsWith('.env') && e.reason?.includes('denied file'))).toBe(true);
    expect(skipped.some((e) => e.path.endsWith('skip.log') && e.reason?.includes('unsupported file type'))).toBe(true);
    expect(
      skipped.some(
        (e) => e.path.replace(/\\/g, '/').includes('.ssh') && e.reason?.includes('denied folder'),
      ),
    ).toBe(true);
    expect(
      skipped.some(
        (e) => e.path.includes('node_modules') && e.reason?.includes('denied folder'),
      ),
    ).toBe(true);
    expect(inventory.availableCount).toBe(4);
  });

  it('skips oversized files with a visible reason', () => {
    const dir = makeDir('oversize');
    writeFile(dir, 'big.md', 'x'.repeat(MAX_FILE_BYTES + 1));
    writeFile(dir, 'ok.md', 'fine');
    const inventory = collectProjectFiles([{ id: 'g1', path: fs.realpathSync(dir) }]);
    expect(inventory.availableCount).toBe(1);
    const skipped = inventory.entries.find((e) => e.path.endsWith('big.md'));
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.reason).toContain('size limit');
  });

  it('skips junctions that escape the granted folder', () => {
    const dir = makeDir('escape-source');
    const outside = makeDir('escape-target');
    writeFile(outside, 'secret.md', 'outside');
    fs.symlinkSync(outside, path.join(dir, 'link'), IS_WINDOWS ? 'junction' : 'dir');
    const inventory = collectProjectFiles([{ id: 'g1', path: fs.realpathSync(dir) }]);
    expect(inventory.availableCount).toBe(0);
    const skipped = inventory.entries.find((e) => e.path.endsWith('link'));
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.reason).toContain('escapes the granted folder');
  });

  it('stops at the file-count limit and records it', () => {
    const dir = makeDir('many');
    for (let index = 0; index < MAX_PROJECT_FILES + 10; index += 1) {
      writeFile(dir, `file-${String(index).padStart(3, '0')}.md`, 'x');
    }
    const inventory = collectProjectFiles([{ id: 'g1', path: fs.realpathSync(dir) }]);
    expect(inventory.availableCount).toBe(MAX_PROJECT_FILES);
    expect(inventory.entries.some((e) => e.status === 'limit')).toBe(true);
  });

  it('records root errors for folders that are gone', () => {
    const missing = path.join(root, 'gone-folder');
    const inventory = collectProjectFiles([{ id: 'g1', path: missing }]);
    expect(inventory.availableCount).toBe(0);
    expect(inventory.entries[0]?.status).toBe('root_error');
  });
});

describe('read_project_file tool', () => {
  let roots: GrantRootView[] = [];
  const tool = createReadProjectFileTool({ getRoots: () => roots });

  const exec = async (args: Record<string, unknown>) => {
    const ctx = makeCtx();
    const outcome = await tool.execute(JSON.stringify(args), ctx, new AbortController().signal);
    return { outcome, records: ctx.records };
  };

  it('reads a granted file and records the access', async () => {
    const dir = makeDir('read-ok');
    const file = writeFile(dir, 'note.md', '## Progress\n\nIt works.');
    roots = [{ id: 'g1', path: fs.realpathSync(dir) }];
    const { outcome, records } = await exec({ path: file });
    expect(outcome.ok).toBe(true);
    const payload = JSON.parse(outcome.content) as { path: string; text: string; truncated: boolean };
    expect(payload.text).toContain('It works.');
    expect(payload.truncated).toBe(false);
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('read');
    expect(records[0]?.path).toBe(fs.realpathSync(file));
  });

  it('accepts forward-slash spellings of granted paths', async () => {
    const dir = makeDir('read-slashes');
    writeFile(dir, 'note.md', 'content');
    roots = [{ id: 'g1', path: fs.realpathSync(dir) }];
    const slashed = fs.realpathSync(dir).replace(/\\/g, '/');
    const { outcome } = await exec({ path: `${slashed}/note.md` });
    expect(outcome.ok).toBe(true);
  });

  it('refuses traversal and paths outside the granted roots without probing them', async () => {
    const dir = makeDir('read-bound');
    writeFile(dir, 'inside.md', 'inside');
    roots = [{ id: 'g1', path: fs.realpathSync(dir) }];
    const outsideFile = writeFile(makeDir('read-outside'), 'outside.md', 'outside');

    const traversal = await exec({ path: path.join(fs.realpathSync(dir), '..', 'read-outside', 'outside.md') });
    expect(traversal.outcome.ok).toBe(false);
    expect(traversal.outcome.content).toContain('Blocked');

    const absoluteOutside = await exec({ path: outsideFile });
    expect(absoluteOutside.outcome.ok).toBe(false);
    expect(absoluteOutside.outcome.content).toContain('outside the folders currently granted');
    // Failed attempts are recorded so the update can show them.
    expect(absoluteOutside.records[0]?.status).toBe('failed');
  });

  it('refuses denied credential stores and unsupported types inside a granted root', async () => {
    const dir = makeDir('read-denied');
    writeFile(dir, '.env', 'SECRET=1');
    writeFile(dir, 'image.png', 'png');
    roots = [{ id: 'g1', path: fs.realpathSync(dir) }];
    const env = await exec({ path: path.join(fs.realpathSync(dir), '.env') });
    expect(env.outcome.content).toContain('denied file');
    const png = await exec({ path: path.join(fs.realpathSync(dir), 'image.png') });
    expect(png.outcome.content).toContain('unsupported file type');
  });

  it('refuses reads once grants are revoked', async () => {
    const dir = makeDir('read-revoked');
    writeFile(dir, 'note.md', 'content');
    roots = [];
    const { outcome } = await exec({ path: path.join(fs.realpathSync(dir), 'note.md') });
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain('no folders are currently granted');
  });

  it('refuses reads when the granted folder was junction-swapped', async () => {
    const dir = makeDir('read-swap');
    writeFile(dir, 'note.md', 'content');
    const canonical = fs.realpathSync(dir);
    const elsewhere = makeDir('read-swap-target');
    writeFile(elsewhere, 'note.md', 'elsewhere');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.symlinkSync(elsewhere, dir, IS_WINDOWS ? 'junction' : 'dir');
    try {
      roots = [{ id: 'g1', path: canonical }];
      const { outcome } = await exec({ path: path.join(elsewhere, 'note.md') });
      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('currently accessible');
    } finally {
      fs.rmSync(dir, { force: true });
    }
  });

  it('truncates long files at the character limit', async () => {
    const dir = makeDir('read-truncate');
    writeFile(dir, 'long.md', 'a'.repeat(MAX_FILE_CHARS + 500));
    roots = [{ id: 'g1', path: fs.realpathSync(dir) }];
    const { outcome } = await exec({ path: path.join(fs.realpathSync(dir), 'long.md') });
    expect(outcome.ok).toBe(true);
    const payload = JSON.parse(outcome.content) as { truncated: boolean; chars: number };
    expect(payload.truncated).toBe(true);
    expect(payload.chars).toBe(MAX_FILE_CHARS);
  });
});

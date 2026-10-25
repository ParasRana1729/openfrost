import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { and, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import {
  InvalidMemoryProposalTransitionError,
  MEMORY_CONTENT_MAX_CHARS,
  MEMORY_CONTEXT_MAX_CHARS,
  MEMORY_FILE_MAX_BYTES,
  MEMORY_MAX_ENTRIES_PER_FILE,
  appendMemoryEntry,
  canTransitionMemoryProposal,
  findSecretMaterial,
  memoryContentKey,
  memoryEntrySchema,
  memoryFileHeader,
  memoryFileViewSchema,
  memoryProposalSchema,
  memoryScopeSchema,
  normalizeMemoryContent,
  parseMemoryFile,
  removeMemoryEntry,
  replaceMemoryEntry,
  type MemoryEntry,
  type MemoryFileView,
  type MemoryProposal,
  type MemoryProposalState,
  type MemoryScope,
  type MemorySource,
} from '@openfrost/domain';
import type { Db } from './store.js';
import * as schema from './schema.js';

/**
 * Owner-approved memory storage (S05). Markdown is canonical: every approved
 * entry is parsed from `memory/owner.md` or `projects/<id>/memory.md`, and the
 * SQLite tables are only an index of metadata plus pending proposals. Every
 * mutation takes the file hash the owner saw, so an external edit is detected
 * before anything is overwritten.
 */

export class MemoryProposalNotFoundError extends Error {
  constructor(proposalId: string) {
    super(`Memory proposal ${proposalId} not found`);
    this.name = 'MemoryProposalNotFoundError';
  }
}

export class MemoryEntryNotFoundError extends Error {
  constructor(entryId: string) {
    super(`Memory entry ${entryId} not found`);
    this.name = 'MemoryEntryNotFoundError';
  }
}

export class MemoryProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} not found`);
    this.name = 'MemoryProjectNotFoundError';
  }
}

/** The Markdown file changed after the owner loaded it. Never overwrite. */
export class MemoryFileChangedError extends Error {
  constructor(public readonly currentSha256: string | null) {
    super(
      'The memory file changed on disk since this page was loaded. ' +
        'Reload memory and review the current content; nothing was overwritten.',
    );
    this.name = 'MemoryFileChangedError';
  }
}

export class MemoryFileUnreadableError extends Error {
  constructor(problems: readonly string[]) {
    super(
      `The memory file needs attention before it can be edited: ${
        problems[0] ?? 'unknown problem'
      }`,
    );
    this.name = 'MemoryFileUnreadableError';
  }
}

export class MemorySecretError extends Error {
  constructor(public readonly reason: string) {
    super(`Memory cannot store credential material: ${reason}.`);
    this.name = 'MemorySecretError';
  }
}

export class MemoryDuplicateError extends Error {
  constructor() {
    super('An equivalent memory already exists (approved or pending).');
    this.name = 'MemoryDuplicateError';
  }
}

export class MemoryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryLimitError';
  }
}

export interface MemoryContext {
  /** Formatted approved memory, or an empty string when there is none. */
  text: string;
  globalEntries: number;
  projectEntries: number;
  entryIds: string[];
  chars: number;
  truncated: boolean;
  problems: string[];
}

export interface LoadedMemoryFile {
  key: string;
  scope: MemoryScope;
  projectId: string | null;
  path: string;
  exists: boolean;
  sha256: string | null;
  markdown: string;
  entries: MemoryEntry[];
  problems: string[];
}

export interface MemoryStore {
  createProposal(
    input: {
      scope: MemoryScope;
      projectId: string | null;
      content: string;
      source: MemorySource;
      sourceRunId: string | null;
    },
    now: string,
  ): MemoryProposal;
  getProposal(id: string): MemoryProposal | null;
  listProposals(states?: readonly MemoryProposalState[]): MemoryProposal[];
  rejectProposal(id: string, now: string): MemoryProposal;
  approveProposal(
    id: string,
    input: {
      /** Owner-edited text; omission approves the proposed text unchanged. */
      content?: string;
      expectedFileSha256: string | null;
      knownSecrets?: readonly string[];
    },
    now: string,
  ): { proposal: MemoryProposal; entry: MemoryEntry; file: MemoryFileView };
  updateEntry(
    id: string,
    input: {
      content: string;
      expectedFileSha256: string;
      knownSecrets?: readonly string[];
    },
    now: string,
  ): { entry: MemoryEntry; file: MemoryFileView };
  deleteEntry(
    id: string,
    expectedFileSha256: string,
    now: string,
  ): { entryId: string; scope: MemoryScope; projectId: string | null; file: MemoryFileView };
  readFileView(scope: MemoryScope, projectId: string | null): MemoryFileView;
  listFileViews(): MemoryFileView[];
  reload(scope: MemoryScope, projectId: string | null, now: string): MemoryFileView;
  reloadAll(now: string): MemoryFileView[];
  contextForTask(projectId: string | null): MemoryContext;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function fileKey(scope: MemoryScope, projectId: string | null): string {
  return scope === 'global' ? 'global' : `project:${projectId ?? 'missing'}`;
}

function requireSafeProjectId(projectId: string): void {
  // Project ids are generated UUIDs. Reject anything path-like before using
  // the id as a directory name (defense in depth for route parameters).
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) {
    throw new MemoryProjectNotFoundError(projectId);
  }
}

function memoryFilePath(home: string, scope: MemoryScope, projectId: string | null): string {
  if (scope === 'global') {
    return path.join(home, 'memory', 'owner.md');
  }
  if (!projectId) {
    throw new MemoryProjectNotFoundError('missing');
  }
  requireSafeProjectId(projectId);
  return path.join(home, 'projects', projectId, 'memory.md');
}

function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'w' });
  try {
    fs.renameSync(temporary, filePath);
  } catch {
    // Some Windows filesystem drivers refuse rename-over-existing; fall back
    // to a copy and remove the temporary file.
    fs.copyFileSync(temporary, filePath);
    fs.unlinkSync(temporary);
  }
}

function toProposal(row: typeof schema.memoryProposals.$inferSelect): MemoryProposal {
  return memoryProposalSchema.parse({
    id: row.id,
    scope: row.scope,
    projectId: row.projectId,
    content: row.content,
    source: JSON.parse(row.sourceJson) as unknown,
    sourceRunId: row.sourceRunId,
    state: row.state,
    proposedAt: row.proposedAt,
    decidedAt: row.decidedAt,
    memoryEntryId: row.memoryEntryId,
    proposedContentSha256: row.proposedContentSha256,
    decidedContentSha256: row.decidedContentSha256,
  });
}

export function createMemoryStore(db: Db, home: string): MemoryStore {
  function projectExists(projectId: string): boolean {
    return (
      db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get() !==
      undefined
    );
  }

  function requireProject(projectId: string): void {
    if (!projectExists(projectId)) {
      throw new MemoryProjectNotFoundError(projectId);
    }
  }

  function loadFile(scope: MemoryScope, projectId: string | null): LoadedMemoryFile {
    if (scope === 'project') {
      if (!projectId) {
        throw new MemoryProjectNotFoundError('missing');
      }
      requireProject(projectId);
    }
    const key = fileKey(scope, projectId);
    const filePath = memoryFilePath(home, scope, projectId);
    let markdown = '';
    let exists = false;
    let sha256Value: string | null = null;
    let problems: string[] = [];
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fileDescriptor);
      exists = true;
      if (!stat.isFile()) {
        return {
          key,
          scope,
          projectId,
          path: filePath,
          exists: true,
          sha256: null,
          markdown: '',
          entries: [],
          problems: [`The memory path is not a file: ${filePath}`],
        };
      }
      if (stat.size > MEMORY_FILE_MAX_BYTES) {
        problems = [
          `The memory file is larger than ${MEMORY_FILE_MAX_BYTES} bytes; it was not parsed.`,
        ];
      } else {
        // Read at most the configured limit plus one byte. The extra byte
        // catches a file that grows after fstat without ever loading an
        // unbounded external edit into memory.
        const buffer = Buffer.alloc(MEMORY_FILE_MAX_BYTES + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          const count = fs.readSync(
            fileDescriptor,
            buffer,
            bytesRead,
            buffer.length - bytesRead,
            bytesRead,
          );
          if (count === 0) {
            break;
          }
          bytesRead += count;
        }
        if (bytesRead > MEMORY_FILE_MAX_BYTES) {
          problems = [
            `The memory file is larger than ${MEMORY_FILE_MAX_BYTES} bytes; it was not parsed.`,
          ];
        } else {
          markdown = buffer.subarray(0, bytesRead).toString('utf8');
          sha256Value = sha256(markdown);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return {
          key,
          scope,
          projectId,
          path: filePath,
          exists: false,
          sha256: null,
          markdown: '',
          entries: [],
          problems: [`The memory file could not be read: ${(err as Error).message}`],
        };
      }
    } finally {
      if (fileDescriptor !== undefined) {
        fs.closeSync(fileDescriptor);
      }
    }
    if (exists && problems.length === 0) {
      const parsed = parseMemoryFile(markdown, { scope, projectId });
      return {
        key,
        scope,
        projectId,
        path: filePath,
        exists,
        sha256: sha256Value,
        markdown,
        entries: parsed.entries,
        problems: parsed.problems,
      };
    }
    return {
      key,
      scope,
      projectId,
      path: filePath,
      exists,
      sha256: sha256Value,
      markdown,
      entries: [],
      problems,
    };
  }

  function indexFile(file: LoadedMemoryFile, now: string): void {
    db.delete(schema.memoryEntries)
      .where(eq(schema.memoryEntries.fileKey, file.key))
      .run();
    for (const entry of file.entries) {
      db.insert(schema.memoryEntries)
        .values({
          id: entry.id,
          fileKey: file.key,
          scope: entry.scope,
          projectId: entry.projectId,
          sourceJson: JSON.stringify(entry.source),
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          contentSha256: sha256(entry.content),
        })
        .run();
    }
    db.insert(schema.memoryFiles)
      .values({
        key: file.key,
        scope: file.scope,
        projectId: file.projectId,
        path: file.path,
        sha256: file.sha256,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.memoryFiles.key,
        set: {
          scope: file.scope,
          projectId: file.projectId,
          path: file.path,
          sha256: file.sha256,
          syncedAt: now,
        },
      })
      .run();
  }

  function viewOf(file: LoadedMemoryFile): MemoryFileView {
    const indexed = db
      .select()
      .from(schema.memoryFiles)
      .where(eq(schema.memoryFiles.key, file.key))
      .get();
    return memoryFileViewSchema.parse({
      scope: file.scope,
      projectId: file.projectId,
      path: file.path,
      exists: file.exists,
      sha256: file.sha256,
      entries: file.entries,
      problems: file.problems,
      externalChange:
        file.exists && (indexed === undefined || indexed.sha256 !== file.sha256),
    });
  }

  function loadedFromMarkdown(
    scope: MemoryScope,
    projectId: string | null,
    filePath: string,
    markdown: string,
  ): LoadedMemoryFile {
    const parsed = parseMemoryFile(markdown, { scope, projectId });
    return {
      key: fileKey(scope, projectId),
      scope,
      projectId,
      path: filePath,
      exists: true,
      sha256: sha256(markdown),
      markdown,
      entries: parsed.entries,
      problems: parsed.problems,
    };
  }

  function scopeClause(scope: MemoryScope, projectId: string | null): SQL {
    const project =
      projectId === null
        ? isNull(schema.memoryProposals.projectId)
        : eq(schema.memoryProposals.projectId, projectId);
    return and(eq(schema.memoryProposals.scope, scope), project) as SQL;
  }

  function pendingContentKeys(scope: MemoryScope, projectId: string | null): Set<string> {
    const keys = new Set<string>();
    for (const row of db
      .select()
      .from(schema.memoryProposals)
      .where(
        and(
          scopeClause(scope, projectId),
          eq(schema.memoryProposals.state, 'pending'),
        ),
      )
      .all()) {
      if (row.content !== null) {
        keys.add(memoryContentKey(row.content));
      }
    }
    return keys;
  }

  const proposals = {
    createProposal(
      input: {
        scope: MemoryScope;
        projectId: string | null;
        content: string;
        source: MemorySource;
        sourceRunId: string | null;
      },
      now: string,
    ): MemoryProposal {
      const content = normalizeMemoryContent(input.content);
      if (content.length === 0) {
        throw new MemoryLimitError('A memory proposal cannot be empty.');
      }
      if (content.length > MEMORY_CONTENT_MAX_CHARS) {
        throw new MemoryLimitError(
          `A memory proposal is limited to ${MEMORY_CONTENT_MAX_CHARS} characters.`,
        );
      }
      const finding = findSecretMaterial(content);
      if (finding) {
        throw new MemorySecretError(finding.reason);
      }
      if (input.scope === 'global' && input.projectId !== null) {
        throw new MemoryLimitError('Global memory cannot carry a projectId.');
      }
      if (input.scope === 'project') {
        if (!input.projectId) {
          throw new MemoryLimitError('Project memory requires a projectId.');
        }
        requireProject(input.projectId);
      }
      const file = loadFile(input.scope, input.projectId);
      const key = memoryContentKey(content);
      if (file.entries.some((entry) => memoryContentKey(entry.content) === key)) {
        throw new MemoryDuplicateError();
      }
      if (pendingContentKeys(input.scope, input.projectId).has(key)) {
        throw new MemoryDuplicateError();
      }
      const row = {
        id: randomUUID(),
        scope: input.scope,
        projectId: input.projectId,
        content,
        sourceJson: JSON.stringify(input.source),
        sourceRunId: input.sourceRunId,
        state: 'pending' as const,
        proposedAt: now,
        decidedAt: null,
        memoryEntryId: null,
        proposedContentSha256: sha256(content),
        decidedContentSha256: null,
      };
      db.insert(schema.memoryProposals).values(row).run();
      return toProposal(row);
    },

    getProposal(id: string): MemoryProposal | null {
      const row = db
        .select()
        .from(schema.memoryProposals)
        .where(eq(schema.memoryProposals.id, id))
        .get();
      return row ? toProposal(row) : null;
    },

    listProposals(states?: readonly MemoryProposalState[]): MemoryProposal[] {
      const query = db.select().from(schema.memoryProposals);
      const rows =
        states && states.length > 0
          ? query
              .where(inArray(schema.memoryProposals.state, states as MemoryProposalState[]))
              .orderBy(desc(schema.memoryProposals.proposedAt), desc(schema.memoryProposals.id))
              .all()
          : query
              .orderBy(desc(schema.memoryProposals.proposedAt), desc(schema.memoryProposals.id))
              .all();
      return rows.map(toProposal);
    },

    rejectProposal(id: string, now: string): MemoryProposal {
      const row = db
        .select()
        .from(schema.memoryProposals)
        .where(eq(schema.memoryProposals.id, id))
        .get();
      if (!row) {
        throw new MemoryProposalNotFoundError(id);
      }
      const proposal = toProposal(row);
      if (!canTransitionMemoryProposal(proposal.state, 'rejected')) {
        throw new InvalidMemoryProposalTransitionError(proposal.state, 'rejected');
      }
      db.update(schema.memoryProposals)
        .set({
          state: 'rejected',
          content: null,
          decidedAt: now,
          decidedContentSha256: null,
        })
        .where(eq(schema.memoryProposals.id, id))
        .run();
      return toProposal({
        ...row,
        state: 'rejected',
        content: null,
        decidedAt: now,
        decidedContentSha256: null,
      });
    },

    approveProposal(
      id: string,
      input: {
        content?: string;
        expectedFileSha256: string | null;
        knownSecrets?: readonly string[];
      },
      now: string,
    ): { proposal: MemoryProposal; entry: MemoryEntry; file: MemoryFileView } {
      const row = db
        .select()
        .from(schema.memoryProposals)
        .where(eq(schema.memoryProposals.id, id))
        .get();
      if (!row) {
        throw new MemoryProposalNotFoundError(id);
      }
      const proposal = toProposal(row);
      if (!canTransitionMemoryProposal(proposal.state, 'approved')) {
        throw new InvalidMemoryProposalTransitionError(proposal.state, 'approved');
      }
      const content = normalizeMemoryContent(input.content ?? proposal.content ?? '');
      if (content.length === 0) {
        throw new MemoryLimitError('A memory cannot be empty.');
      }
      if (content.length > MEMORY_CONTENT_MAX_CHARS) {
        throw new MemoryLimitError(
          `A memory is limited to ${MEMORY_CONTENT_MAX_CHARS} characters.`,
        );
      }
      const finding = findSecretMaterial(content, input.knownSecrets);
      if (finding) {
        throw new MemorySecretError(finding.reason);
      }
      const file = loadFile(proposal.scope, proposal.projectId);
      if (file.sha256 !== input.expectedFileSha256) {
        throw new MemoryFileChangedError(file.sha256);
      }
      if (file.problems.length > 0) {
        throw new MemoryFileUnreadableError(file.problems);
      }
      if (file.entries.length >= MEMORY_MAX_ENTRIES_PER_FILE) {
        throw new MemoryLimitError(
          `This memory file already has ${MEMORY_MAX_ENTRIES_PER_FILE} entries; delete one before approving another.`,
        );
      }
      const key = memoryContentKey(content);
      if (file.entries.some((entry) => memoryContentKey(entry.content) === key)) {
        throw new MemoryDuplicateError();
      }
      const entry = memoryEntrySchema.parse({
        id: randomUUID(),
        scope: proposal.scope,
        projectId: proposal.projectId,
        content,
        source: proposal.source,
        createdAt: now,
        updatedAt: now,
      });
      const markdown = appendMemoryEntry(
        file.markdown,
        entry,
        memoryFileHeader(proposal.scope),
      );
      writeFileAtomic(file.path, markdown);
      const after = loadedFromMarkdown(
        proposal.scope,
        proposal.projectId,
        file.path,
        markdown,
      );
      indexFile(after, now);
      db.update(schema.memoryProposals)
        .set({
          state: 'approved',
          content: null,
          decidedAt: now,
          memoryEntryId: entry.id,
          decidedContentSha256: sha256(content),
        })
        .where(eq(schema.memoryProposals.id, id))
        .run();
      return {
        proposal: toProposal({
          ...row,
          state: 'approved',
          content: null,
          decidedAt: now,
          memoryEntryId: entry.id,
          decidedContentSha256: sha256(content),
        }),
        entry,
        file: viewOf(after),
      };
    },
  };

  function locateEntry(
    entryId: string,
  ): { scope: MemoryScope; projectId: string | null } | null {
    const indexed = db
      .select()
      .from(schema.memoryEntries)
      .where(eq(schema.memoryEntries.id, entryId))
      .get();
    if (indexed) {
      return { scope: memoryScopeSchema.parse(indexed.scope), projectId: indexed.projectId };
    }
    // The Markdown is canonical; an externally added block is discoverable
    // even before the metadata index is rebuilt.
    for (const view of memoryStore.listFileViews()) {
      if (view.entries.some((entry) => entry.id === entryId)) {
        const file = loadFile(view.scope, view.projectId);
        indexFile(file, new Date().toISOString());
        return { scope: view.scope, projectId: view.projectId };
      }
    }
    return null;
  }

  const memoryStore: MemoryStore = {
    ...proposals,

    readFileView(scope: MemoryScope, projectId: string | null): MemoryFileView {
      return viewOf(loadFile(scope, projectId));
    },

    listFileViews(): MemoryFileView[] {
      const views: MemoryFileView[] = [viewOf(loadFile('global', null))];
      for (const project of db
        .select()
        .from(schema.projects)
        .orderBy(schema.projects.createdAt)
        .all()) {
        views.push(viewOf(loadFile('project', project.id)));
      }
      return views;
    },

    reload(scope: MemoryScope, projectId: string | null, now: string): MemoryFileView {
      const file = loadFile(scope, projectId);
      indexFile(file, now);
      return viewOf(file);
    },

    reloadAll(now: string): MemoryFileView[] {
      const views: MemoryFileView[] = [];
      const globalFile = loadFile('global', null);
      indexFile(globalFile, now);
      views.push(viewOf(globalFile));
      for (const project of db
        .select()
        .from(schema.projects)
        .orderBy(schema.projects.createdAt)
        .all()) {
        const file = loadFile('project', project.id);
        indexFile(file, now);
        views.push(viewOf(file));
      }
      return views;
    },

    updateEntry(
      id: string,
      input: {
        content: string;
        expectedFileSha256: string;
        knownSecrets?: readonly string[];
      },
      now: string,
    ): { entry: MemoryEntry; file: MemoryFileView } {
      const location = locateEntry(id);
      if (!location) {
        throw new MemoryEntryNotFoundError(id);
      }
      const file = loadFile(location.scope, location.projectId);
      if (file.sha256 !== input.expectedFileSha256) {
        throw new MemoryFileChangedError(file.sha256);
      }
      if (file.problems.length > 0) {
        throw new MemoryFileUnreadableError(file.problems);
      }
      const existing = file.entries.find((entry) => entry.id === id);
      if (!existing) {
        throw new MemoryEntryNotFoundError(id);
      }
      const content = normalizeMemoryContent(input.content);
      if (content.length === 0) {
        throw new MemoryLimitError('A memory cannot be empty.');
      }
      if (content.length > MEMORY_CONTENT_MAX_CHARS) {
        throw new MemoryLimitError(
          `A memory is limited to ${MEMORY_CONTENT_MAX_CHARS} characters.`,
        );
      }
      const finding = findSecretMaterial(content, input.knownSecrets);
      if (finding) {
        throw new MemorySecretError(finding.reason);
      }
      const key = memoryContentKey(content);
      if (
        file.entries.some(
          (entry) => entry.id !== id && memoryContentKey(entry.content) === key,
        )
      ) {
        throw new MemoryDuplicateError();
      }
      const entry = memoryEntrySchema.parse({
        ...existing,
        content,
        updatedAt: now,
      });
      const markdown = replaceMemoryEntry(file.markdown, entry, {
        scope: location.scope,
        projectId: location.projectId,
      });
      writeFileAtomic(file.path, markdown);
      const after = loadedFromMarkdown(
        location.scope,
        location.projectId,
        file.path,
        markdown,
      );
      indexFile(after, now);
      return { entry, file: viewOf(after) };
    },

    deleteEntry(
      id: string,
      expectedFileSha256: string,
      now: string,
    ): { entryId: string; scope: MemoryScope; projectId: string | null; file: MemoryFileView } {
      const location = locateEntry(id);
      if (!location) {
        throw new MemoryEntryNotFoundError(id);
      }
      const file = loadFile(location.scope, location.projectId);
      if (file.sha256 !== expectedFileSha256) {
        throw new MemoryFileChangedError(file.sha256);
      }
      if (file.problems.length > 0) {
        throw new MemoryFileUnreadableError(file.problems);
      }
      if (!file.entries.some((entry) => entry.id === id)) {
        throw new MemoryEntryNotFoundError(id);
      }
      const markdown = removeMemoryEntry(file.markdown, id, {
        scope: location.scope,
        projectId: location.projectId,
      });
      writeFileAtomic(file.path, markdown);
      const after = loadedFromMarkdown(
        location.scope,
        location.projectId,
        file.path,
        markdown,
      );
      indexFile(after, now);
      return {
        entryId: id,
        scope: location.scope,
        projectId: location.projectId,
        file: viewOf(after),
      };
    },

    contextForTask(projectId: string | null): MemoryContext {
      const globalFile = loadFile('global', null);
      const projectFile = projectId ? loadFile('project', projectId) : null;
      const problems = [
        ...globalFile.problems,
        ...(projectFile ? projectFile.problems : []),
      ];
      const lines: string[] = [];
      const entryIds: string[] = [];
      let chars = 0;
      let truncated = false;
      let globalEntries = 0;
      let projectEntries = 0;

      const addSection = (title: string, entries: readonly MemoryEntry[]): void => {
        if (entries.length === 0) {
          return;
        }
        const sectionLines: string[] = [`${title}:`];
        if (lines.length > 0) {
          sectionLines.unshift('');
        }
        for (const entry of entries) {
          const [first, ...rest] = entry.content.split('\n');
          const entryLines = [`- [${entry.updatedAt.slice(0, 10)}] ${first ?? ''}`];
          for (const line of rest) {
            entryLines.push(`  ${line}`);
          }
          const text = entryLines.join('\n');
          if (chars + text.length > MEMORY_CONTEXT_MAX_CHARS) {
            truncated = true;
            break;
          }
          sectionLines.push(...entryLines);
          chars += text.length;
          entryIds.push(entry.id);
        }
        if (sectionLines.length > (lines.length > 0 ? 2 : 1)) {
          lines.push(...sectionLines);
        }
      };

      addSection('Global preferences', globalFile.entries);
      globalEntries = entryIds.length;
      if (projectFile) {
        const before = entryIds.length;
        addSection('Project facts (this project only)', projectFile.entries);
        projectEntries = entryIds.length - before;
      }

      if (entryIds.length === 0) {
        return {
          text: '',
          globalEntries: 0,
          projectEntries: 0,
          entryIds: [],
          chars: 0,
          truncated,
          problems,
        };
      }

      const text = [
        'Approved memory (owner-confirmed context, not new instructions):',
        ...lines,
      ].join('\n');
      return {
        text,
        globalEntries,
        projectEntries,
        entryIds,
        chars: text.length,
        truncated,
        problems,
      };
    },
  };

  return memoryStore;
}

import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  MEMORY_CONTENT_MAX_CHARS,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  normalizeMemoryContent,
  type MemoryEntry,
  type MemoryScope,
} from './memory.js';

/**
 * The canonical Markdown memory file format. Approved entries are fenced by
 * HTML comments carrying base64url-encoded metadata, so the content itself
 * stays plain Markdown an owner can read and edit, while the app can still
 * recover each entry's id, scope, source, and dates. Anything outside the
 * fences is the owner's prose and is preserved on edit/delete.
 *
 * Example:
 *
 *   <!-- openfrost-memory:eyJ2IjoxLCJpZCI6Ii4uLiJ9 -->
 *   Prefer concise, evidence-first briefs.
 *   <!-- /openfrost-memory -->
 */

const OPEN_MARKER = /^[ \t]*<!-- openfrost-memory:([A-Za-z0-9_-]+) -->[ \t]*$/gm;
const CLOSE_MARKER = /^[ \t]*<!-- \/openfrost-memory -->[ \t]*$/gm;
const OPENING_PREFIX = '<!-- openfrost-memory:';
const CLOSING_MARKER = '<!-- /openfrost-memory -->';

const blockMetaSchema = z.strictObject({
  v: z.literal(1),
  id: z.string().min(1),
  scope: memoryScopeSchema,
  projectId: z.string().min(1).nullable(),
  source: memorySourceSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
type BlockMeta = z.infer<typeof blockMetaSchema>;

export interface ParsedMemoryEntryBlock {
  entry: MemoryEntry;
  /** Index of the opening marker in the file. */
  start: number;
  /** Index immediately after the closing marker. */
  end: number;
}

export interface ParsedMemoryFile {
  entries: MemoryEntry[];
  blocks: ParsedMemoryEntryBlock[];
  problems: string[];
}

export interface MemoryFileScope {
  scope: MemoryScope;
  projectId: string | null;
}

export class MemoryFileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryFileFormatError';
  }
}

export class MemoryFileEntryNotFoundError extends Error {
  constructor(entryId: string) {
    super(`Memory entry ${entryId} is not present in the Markdown file`);
    this.name = 'MemoryFileEntryNotFoundError';
  }
}

function encodeMeta(meta: BlockMeta): string {
  return Buffer.from(JSON.stringify(meta), 'utf8').toString('base64url');
}

function decodeMeta(encoded: string): BlockMeta {
  const text = Buffer.from(encoded, 'base64url').toString('utf8');
  const parsed: unknown = JSON.parse(text);
  return blockMetaSchema.parse(parsed);
}

/** Files inherit the line ending already in use; new files use LF. */
export function detectEol(markdown: string): string {
  return markdown.includes('\r\n') ? '\r\n' : '\n';
}

function assertRenderable(entry: MemoryEntry): void {
  if (
    entry.content.includes(OPENING_PREFIX) ||
    entry.content.includes(CLOSING_MARKER)
  ) {
    throw new MemoryFileFormatError(
      'Memory content must not contain the memory block markers.',
    );
  }
  for (const character of entry.content) {
    const code = character.codePointAt(0) ?? 0;
    const allowedWhitespace = code === 9 || code === 10 || code === 13;
    if (code < 32 && !allowedWhitespace) {
      throw new MemoryFileFormatError(
        'Memory content contains control characters.',
      );
    }
  }
}

/**
 * Parses every fenced entry. Malformed blocks are skipped and reported, never
 * guessed at; the caller decides whether it can still use the valid entries.
 */
export function parseMemoryFile(
  markdown: string,
  expected: MemoryFileScope,
): ParsedMemoryFile {
  const entries: MemoryEntry[] = [];
  const blocks: ParsedMemoryEntryBlock[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  for (;;) {
    OPEN_MARKER.lastIndex = cursor;
    const open = OPEN_MARKER.exec(markdown);
    if (!open) {
      break;
    }
    const start = open.index;
    const encoded = open[1];
    if (encoded === undefined) {
      problems.push('A memory block is missing its metadata.');
      cursor = start + open[0].length;
      continue;
    }
    const bodyStart = start + open[0].length;
    CLOSE_MARKER.lastIndex = bodyStart;
    const close = CLOSE_MARKER.exec(markdown);
    if (!close) {
      problems.push('A memory block has an opening marker but no closing marker.');
      break;
    }
    const end = close.index + close[0].length;
    cursor = end;

    let meta: BlockMeta;
    try {
      meta = decodeMeta(encoded);
    } catch {
      problems.push('A memory block has unreadable metadata and was skipped.');
      continue;
    }
    if (meta.scope !== expected.scope) {
      problems.push(
        `A memory block for scope "${meta.scope}" appears in a "${expected.scope}" file and was skipped.`,
      );
      continue;
    }
    if (meta.projectId !== expected.projectId) {
      problems.push(
        'A memory block belongs to a different project and was skipped.',
      );
      continue;
    }
    if (seen.has(meta.id)) {
      problems.push(`A duplicate memory id (${meta.id}) was skipped.`);
      continue;
    }
    const content = normalizeMemoryContent(markdown.slice(bodyStart, close.index));
    if (content.length === 0) {
      problems.push(`Memory entry ${meta.id} is empty and was skipped.`);
      continue;
    }
    if (content.length > MEMORY_CONTENT_MAX_CHARS) {
      problems.push(
        `Memory entry ${meta.id} exceeds ${MEMORY_CONTENT_MAX_CHARS} characters and was skipped.`,
      );
      continue;
    }
    try {
      const entry = memoryEntrySchema.parse({
        id: meta.id,
        scope: meta.scope,
        projectId: meta.projectId,
        content,
        source: meta.source,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      });
      seen.add(meta.id);
      entries.push(entry);
      blocks.push({ entry, start, end });
    } catch {
      problems.push(`Memory entry ${meta.id} has invalid metadata and was skipped.`);
    }
  }

  return { entries, blocks, problems };
}

export function memoryFileHeader(scope: MemoryScope): string {
  if (scope === 'global') {
    return [
      '# OpenFrost memory: owner preferences',
      '',
      'Every entry below is an owner-approved global preference. This file is the',
      'canonical memory content; OpenFrost reads these entries into future task',
      'context. Deleting an entry here removes it from future retrieval; it does',
      'not delete the task, report, or conversation that inspired it.',
    ].join('\n');
  }
  return [
    '# OpenFrost memory: project facts',
    '',
    'Every entry below is an owner-approved fact for this project. This file is',
    'the canonical memory content. Other projects never read this file, and',
    'deleting an entry does not delete the project notes or source tasks that',
    'inspired it.',
  ].join('\n');
}

/** Renders one fenced block (no trailing newline). */
export function renderMemoryEntryBlock(entry: MemoryEntry, eol = '\n'): string {
  assertRenderable(entry);
  const meta: BlockMeta = {
    v: 1,
    id: entry.id,
    scope: entry.scope,
    projectId: entry.projectId,
    source: entry.source,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  const content = normalizeMemoryContent(entry.content);
  return [
    `<!-- openfrost-memory:${encodeMeta(meta)} -->`,
    content,
    CLOSING_MARKER,
  ].join(eol);
}

/**
 * Appends an approved entry. A missing file is created with a short canonical
 * header; an existing file keeps every byte of owner-authored prose above and
 * around the fenced blocks.
 */
export function appendMemoryEntry(
  markdown: string,
  entry: MemoryEntry,
  header = memoryFileHeader(entry.scope),
): string {
  const eol = detectEol(markdown);
  const block = renderMemoryEntryBlock(entry, eol);
  if (markdown.trim().length === 0) {
    return `${header}${eol}${eol}${block}${eol}`;
  }
  const base = markdown.replace(/[ \t\r\n]+$/, '');
  return `${base}${eol}${eol}${block}${eol}`;
}

/** Replaces one entry's block with the same id, preserving surrounding prose. */
export function replaceMemoryEntry(
  markdown: string,
  entry: MemoryEntry,
  expected: MemoryFileScope,
): string {
  const parsed = parseMemoryFile(markdown, expected);
  const block = parsed.blocks.find((candidate) => candidate.entry.id === entry.id);
  if (!block) {
    throw new MemoryFileEntryNotFoundError(entry.id);
  }
  if (parsed.problems.length > 0) {
    throw new MemoryFileFormatError(
      `The memory file has ${parsed.problems.length} problem(s); repair or reload it before editing.`,
    );
  }
  const eol = detectEol(markdown);
  return (
    markdown.slice(0, block.start) +
    renderMemoryEntryBlock(entry, eol) +
    markdown.slice(block.end)
  );
}

/** Removes one entry's block and one adjacent blank line; prose stays intact. */
export function removeMemoryEntry(
  markdown: string,
  entryId: string,
  expected: MemoryFileScope,
): string {
  const parsed = parseMemoryFile(markdown, expected);
  const block = parsed.blocks.find((candidate) => candidate.entry.id === entryId);
  if (!block) {
    throw new MemoryFileEntryNotFoundError(entryId);
  }
  if (parsed.problems.length > 0) {
    throw new MemoryFileFormatError(
      `The memory file has ${parsed.problems.length} problem(s); repair or reload it before editing.`,
    );
  }
  let start = block.start;
  let end = block.end;
  if (markdown.slice(end, end + 2) === '\r\n') {
    end += 2;
  } else if (markdown[end] === '\n') {
    end += 1;
  }
  if (markdown.slice(start - 2, start) === '\r\n') {
    start -= 2;
  } else if (markdown[start - 1] === '\n') {
    start -= 1;
  }
  return markdown.slice(0, start) + markdown.slice(end);
}

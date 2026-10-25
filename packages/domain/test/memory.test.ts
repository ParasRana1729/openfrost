import { describe, expect, it } from 'vitest';
import {
  MEMORY_CONTENT_MAX_CHARS,
  MemoryFileEntryNotFoundError,
  appendMemoryEntry,
  approveMemoryProposalRequestSchema,
  canTransitionMemoryProposal,
  deleteMemoryEntryRequestSchema,
  findSecretMaterial,
  memoryEntrySchema,
  memoryFileHeader,
  memoryProposalSchema,
  normalizeMemoryContent,
  parseMemoryFile,
  removeMemoryEntry,
  replaceMemoryEntry,
  updateMemoryEntryRequestSchema,
  type MemoryEntry,
} from '../src/index.js';

const NOW = '2026-10-25T12:00:00.000Z';
const LATER = '2026-10-25T13:00:00.000Z';
const HASH = 'a'.repeat(64);

function sampleEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return memoryEntrySchema.parse({
    id: 'mem-1',
    scope: 'global',
    projectId: null,
    content: 'Prefer concise, evidence-first briefs.',
    source: {
      kind: 'task',
      taskId: 'task-1',
      artifactId: null,
      label: 'Compare note-taking apps',
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

describe('memory entry schema', () => {
  it('accepts global and project-scoped entries', () => {
    expect(sampleEntry().scope).toBe('global');
    const project = sampleEntry({
      id: 'mem-2',
      scope: 'project',
      projectId: 'project-1',
      content: 'The parser module is the riskiest part of the build.',
    });
    expect(project.projectId).toBe('project-1');
  });

  it('rejects scope/project mismatches, empty content, and unknown fields', () => {
    expect(() => sampleEntry({ projectId: 'project-1' })).toThrowError();
    expect(() => sampleEntry({ scope: 'project', projectId: null })).toThrowError();
    expect(() => sampleEntry({ content: '' })).toThrowError();
    expect(() => sampleEntry({ content: 'x'.repeat(MEMORY_CONTENT_MAX_CHARS + 1) })).toThrowError();
    expect(() => sampleEntry({ surprise: true } as never)).toThrowError();
  });
});

describe('memory proposal schema and transitions', () => {
  it('accepts a pending proposal and rejects a pending one without content', () => {
    const pending = memoryProposalSchema.parse({
      id: 'proposal-1',
      scope: 'global',
      projectId: null,
      content: 'Prefer short answers.',
      source: { kind: 'task', taskId: 'task-1', artifactId: null, label: 'Task one' },
      sourceRunId: 'run-1',
      state: 'pending',
      proposedAt: NOW,
      decidedAt: null,
      memoryEntryId: null,
      proposedContentSha256: HASH,
      decidedContentSha256: null,
    });
    expect(pending.content).toBe('Prefer short answers.');
    expect(() => memoryProposalSchema.parse({ ...pending, content: null })).toThrowError();
  });

  it('requires an approved proposal to point at an entry', () => {
    expect(() =>
      memoryProposalSchema.parse({
        id: 'proposal-1',
        scope: 'global',
        projectId: null,
        content: null,
        source: { kind: 'task', taskId: 'task-1', artifactId: null, label: 'Task one' },
        sourceRunId: 'run-1',
        state: 'approved',
        proposedAt: NOW,
        decidedAt: NOW,
        memoryEntryId: null,
        proposedContentSha256: HASH,
        decidedContentSha256: null,
      }),
    ).toThrowError();
  });

  it('allows exactly the owner-decision edges', () => {
    expect(canTransitionMemoryProposal('pending', 'approved')).toBe(true);
    expect(canTransitionMemoryProposal('pending', 'rejected')).toBe(true);
    expect(canTransitionMemoryProposal('approved', 'rejected')).toBe(false);
    expect(canTransitionMemoryProposal('rejected', 'approved')).toBe(false);
  });
});

describe('memory Markdown file format', () => {
  it('round-trips entries through a file while preserving owner prose', () => {
    const first = sampleEntry();
    let markdown = appendMemoryEntry('', first);
    markdown = `Owner notes at the top.\n\n${markdown}`;
    markdown += '\nManual note at the bottom.\n';

    const parsed = parseMemoryFile(markdown, { scope: 'global', projectId: null });
    expect(parsed.problems).toEqual([]);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.content).toBe('Prefer concise, evidence-first briefs.');
    expect(markdown).toContain('Owner notes at the top.');
    expect(markdown).toContain('Manual note at the bottom.');

    const second = sampleEntry({
      id: 'mem-2',
      content: 'Keep a visible uncertainty section.',
      updatedAt: LATER,
    });
    markdown = appendMemoryEntry(markdown, second);
    expect(parseMemoryFile(markdown, { scope: 'global', projectId: null }).entries).toHaveLength(2);

    const edited = { ...second, content: 'Always keep an uncertainty section.', updatedAt: LATER };
    markdown = replaceMemoryEntry(markdown, edited, { scope: 'global', projectId: null });
    const afterEdit = parseMemoryFile(markdown, { scope: 'global', projectId: null });
    expect(afterEdit.entries.map((entry) => entry.content)).toContain(
      'Always keep an uncertainty section.',
    );
    expect(markdown).toContain('Owner notes at the top.');
    expect(markdown).toContain('Manual note at the bottom.');

    markdown = removeMemoryEntry(markdown, 'mem-1', { scope: 'global', projectId: null });
    const afterDelete = parseMemoryFile(markdown, { scope: 'global', projectId: null });
    expect(afterDelete.entries.map((entry) => entry.id)).toEqual(['mem-2']);
    expect(markdown).toContain('Owner notes at the top.');
    expect(markdown).toContain('Manual note at the bottom.');
    expect(() =>
      removeMemoryEntry(markdown, 'mem-1', { scope: 'global', projectId: null }),
    ).toThrowError(MemoryFileEntryNotFoundError);
  });

  it('keeps project memory in project scope and skips blocks from other scopes', () => {
    const projectEntry = sampleEntry({
      id: 'mem-project',
      scope: 'project',
      projectId: 'project-1',
      content: 'The thesis draft is due in March.',
    });
    const markdown = appendMemoryEntry('', projectEntry, memoryFileHeader('project'));
    const parsed = parseMemoryFile(markdown, { scope: 'project', projectId: 'project-1' });
    expect(parsed.entries).toHaveLength(1);

    const otherProject = parseMemoryFile(markdown, {
      scope: 'project',
      projectId: 'project-2',
    });
    expect(otherProject.entries).toEqual([]);
    expect(otherProject.problems[0]).toContain('different project');
  });

  it('reports malformed and duplicate blocks instead of guessing', () => {
    const entry = sampleEntry();
    const block = appendMemoryEntry('', entry);
    const malformed = `${block}\n${block}\n<!-- openfrost-memory:not-base64 -->\nbody\n`;
    const parsed = parseMemoryFile(malformed, { scope: 'global', projectId: null });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.problems.some((problem) => problem.includes('duplicate'))).toBe(true);
    expect(parsed.problems.some((problem) => problem.includes('no closing marker'))).toBe(true);

    const unreadable = `${block}\n<!-- openfrost-memory:not-base64 -->\nbody\n<!-- /openfrost-memory -->\n`;
    const second = parseMemoryFile(unreadable, { scope: 'global', projectId: null });
    expect(second.problems.some((problem) => problem.includes('unreadable metadata'))).toBe(true);
  });

  it('refuses content that would forge or close a block', () => {
    expect(() =>
      appendMemoryEntry('', sampleEntry({ content: 'text <!-- /openfrost-memory --> more' })),
    ).toThrowError();
  });

  it('normalizes line endings and whitespace for storage', () => {
    expect(normalizeMemoryContent('  a\r\n\r\nb  ')).toBe('a\n\nb');
  });
});

describe('memory secret exclusion', () => {
  const fakeOpenAiKey = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz'].join('-');
  const fakeGoogleKey = ['AIza', 'SyA1234567890abcdefghijklmnopqrstu'].join('');

  it('flags provider key shapes without echoing the value', () => {
    const finding = findSecretMaterial(`Remember ${fakeOpenAiKey}`);
    expect(finding?.reason).toContain('OpenAI-style');
    expect(finding?.reason).not.toContain(fakeOpenAiKey);
    expect(findSecretMaterial(`key=${fakeGoogleKey}`)?.reason).toContain('Google API key');
    expect(findSecretMaterial('Bearer abcdefghijklmnop')?.reason).toContain('bearer');
    expect(findSecretMaterial('api_key = super-secret-value')?.reason).toContain(
      'credential assignment',
    );
    expect(findSecretMaterial('-----BEGIN OPENSSH PRIVATE KEY-----')?.reason).toContain(
      'private key',
    );
  });

  it('flags configured secret values and allows ordinary preferences', () => {
    expect(findSecretMaterial('the phrase is correct horse battery', ['correct horse battery']))
      .toMatchObject({ reason: expect.stringContaining('configured provider credential') });
    expect(findSecretMaterial('Prefer concise notes with exact citations.')).toBeNull();
    expect(findSecretMaterial('The password reset flow is confusing.')).toBeNull();
  });
});

describe('memory request schemas', () => {
  it('accepts approval with or without edited content and a null file hash', () => {
    expect(approveMemoryProposalRequestSchema.parse({ fileSha256: null })).toEqual({
      fileSha256: null,
    });
    expect(
      approveMemoryProposalRequestSchema.parse({ content: 'Edited text', fileSha256: HASH }),
    ).toEqual({ content: 'Edited text', fileSha256: HASH });
    expect(() => approveMemoryProposalRequestSchema.parse({})).toThrowError();
  });

  it('requires the file hash for edits and deletes', () => {
    expect(updateMemoryEntryRequestSchema.parse({ content: 'x', fileSha256: HASH })).toBeTruthy();
    expect(deleteMemoryEntryRequestSchema.parse({ fileSha256: HASH })).toEqual({
      fileSha256: HASH,
    });
    expect(() => updateMemoryEntryRequestSchema.parse({ content: 'x' })).toThrowError();
    expect(() => deleteMemoryEntryRequestSchema.parse({ fileSha256: 'short' })).toThrowError();
  });
});

import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MEMORY_FILE_MAX_BYTES, parseMemoryFile } from '@openfrost/domain';
import {
  MemoryDuplicateError,
  MemoryFileChangedError,
  MemoryFileUnreadableError,
  MemoryProjectNotFoundError,
  MemorySecretError,
  createStore,
  openDatabase,
  type OpenDatabaseResult,
  type Store,
} from '../src/index.js';

const T0 = Date.parse('2026-10-25T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const SOURCE = {
  kind: 'task' as const,
  taskId: 'task-1',
  artifactId: null,
  label: 'Compare note-taking apps',
};

interface MemoryFixture {
  home: string;
  opened: OpenDatabaseResult;
  store: Store;
}

const fixtures: MemoryFixture[] = [];

function openFixture(label: string): MemoryFixture {
  const home = mkdtempSync(join(tmpdir(), `openfrost-memory-${label}-`));
  const opened = openDatabase(home);
  const store = createStore(opened.db, { home: opened.home });
  const fixture = { home, opened, store };
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (!fixture) {
      continue;
    }
    try {
      fixture.opened.sqlite.close();
    } catch {
      // Already closed by a restart test.
    }
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

function globalPath(home: string): string {
  return join(home, 'memory', 'owner.md');
}

function projectPath(home: string, projectId: string): string {
  return join(home, 'projects', projectId, 'memory.md');
}

function propose(
  store: Store,
  content: string,
  scope: 'global' | 'project' = 'global',
  projectId: string | null = null,
): ReturnType<Store['memory']['createProposal']> {
  return store.memory.createProposal(
    {
      scope,
      projectId,
      content,
      source: SOURCE,
      sourceRunId: 'run-1',
    },
    at(0),
  );
}

describe('owner-approved memory store', () => {
  it('keeps proposals out of task context until the owner approves them', () => {
    const { home, opened, store } = openFixture('approve');
    const proposal = propose(store, 'Prefer concise, evidence-first briefs.');

    expect(store.memory.contextForTask(null)).toMatchObject({
      text: '',
      globalEntries: 0,
      entryIds: [],
    });
    expect(existsSync(globalPath(home))).toBe(false);

    const before = store.memory.readFileView('global', null);
    expect(before).toMatchObject({ exists: false, sha256: null, externalChange: false });

    const decided = store.memory.approveProposal(
      proposal.id,
      { expectedFileSha256: before.sha256 },
      at(1),
    );
    expect(decided.entry).toMatchObject({
      scope: 'global',
      projectId: null,
      content: 'Prefer concise, evidence-first briefs.',
      source: SOURCE,
      createdAt: at(1),
      updatedAt: at(1),
    });
    expect(decided.proposal).toMatchObject({
      state: 'approved',
      content: null,
      memoryEntryId: decided.entry.id,
    });

    // Markdown is canonical: the file carries the content and provenance.
    const markdown = readFileSync(globalPath(home), 'utf8');
    expect(markdown).toContain('Prefer concise, evidence-first briefs.');
    const parsed = parseMemoryFile(markdown, { scope: 'global', projectId: null });
    expect(parsed.problems).toEqual([]);
    expect(parsed.entries[0]?.source).toEqual(SOURCE);

    // Approved memory enters context with the entry id; pending proposals never do.
    const context = store.memory.contextForTask(null);
    expect(context.text).toContain('Prefer concise, evidence-first briefs.');
    expect(context.globalEntries).toBe(1);
    expect(context.entryIds).toEqual([decided.entry.id]);

    // SQLite retains audit metadata only: proposal text is cleared and the
    // entry index has no content column at all.
    const proposalRow = opened.sqlite
      .prepare('SELECT content, state, decided_content_sha256 FROM memory_proposals WHERE id = ?')
      .get(proposal.id) as {
      content: string | null;
      state: string;
      decided_content_sha256: string | null;
    };
    expect(proposalRow.content).toBeNull();
    expect(proposalRow.state).toBe('approved');
    expect(proposalRow.decided_content_sha256).toHaveLength(64);
    const entryRow = opened.sqlite
      .prepare('SELECT * FROM memory_entries WHERE id = ?')
      .get(decided.entry.id) as Record<string, unknown>;
    expect(entryRow['content']).toBeUndefined();
    expect(entryRow['content_sha256']).toHaveLength(64);
  });

  it('lets the owner edit proposed text during approval', () => {
    const { store } = openFixture('edit-approval');
    const proposal = propose(store, 'Prefer short answers.');

    const decided = store.memory.approveProposal(
      proposal.id,
      {
        content: 'Prefer concise answers with sources.',
        expectedFileSha256: null,
      },
      at(1),
    );
    expect(decided.entry.content).toBe('Prefer concise answers with sources.');
    expect(decided.proposal.content).toBeNull();
    expect(decided.proposal.proposedContentSha256).not.toBe(
      decided.proposal.decidedContentSha256,
    );
    expect(store.memory.contextForTask(null).text).toContain(
      'Prefer concise answers with sources.',
    );
    expect(store.memory.contextForTask(null).text).not.toContain('Prefer short answers.');
  });

  it('rejects a proposal without creating memory and keeps source history', () => {
    const { home, store } = openFixture('reject');
    const proposal = propose(store, 'Remember this temporary detail.');

    const rejected = store.memory.rejectProposal(proposal.id, at(2));
    expect(rejected).toMatchObject({
      state: 'rejected',
      content: null,
      decidedAt: at(2),
      source: SOURCE,
    });
    expect(store.memory.contextForTask(null).text).toBe('');
    expect(existsSync(globalPath(home))).toBe(false);
    expect(store.memory.getProposal(proposal.id)?.state).toBe('rejected');
  });

  it('deletes an entry from retrieval while keeping its task/source history', () => {
    const { home, store } = openFixture('delete');
    const proposal = propose(store, 'The parser module is the riskiest part.');
    const approved = store.memory.approveProposal(
      proposal.id,
      { expectedFileSha256: null },
      at(1),
    );
    const current = store.memory.readFileView('global', null);
    expect(current.sha256).not.toBeNull();

    const deleted = store.memory.deleteEntry(
      approved.entry.id,
      current.sha256 ?? '',
      at(2),
    );
    expect(deleted.entryId).toBe(approved.entry.id);
    expect(deleted.file.entries).toEqual([]);
    expect(store.memory.contextForTask(null).text).toBe('');
    expect(readFileSync(globalPath(home), 'utf8')).not.toContain(
      'The parser module is the riskiest part.',
    );

    // Deletion removes future retrieval, not the proposal that sourced it.
    const history = store.memory.getProposal(proposal.id);
    expect(history).toMatchObject({
      state: 'approved',
      memoryEntryId: approved.entry.id,
      source: SOURCE,
    });
    expect(history?.decidedContentSha256).toHaveLength(64);
  });

  it('isolates project facts from other projects and unscoped tasks', () => {
    const { home, store } = openFixture('isolation');
    const alpha = store.projects.create({ name: 'Alpha' }, at(0));
    const beta = store.projects.create({ name: 'Beta' }, at(1));

    const globalProposal = propose(store, 'Prefer primary sources.');
    const alphaProposal = propose(store, 'Alpha uses a March deadline.', 'project', alpha.id);
    const betaProposal = propose(store, 'Beta uses the blue palette.', 'project', beta.id);
    for (const proposal of [globalProposal, alphaProposal, betaProposal]) {
      store.memory.approveProposal(proposal.id, { expectedFileSha256: null }, at(2));
    }

    const alphaContext = store.memory.contextForTask(alpha.id);
    expect(alphaContext.text).toContain('Prefer primary sources.');
    expect(alphaContext.text).toContain('Alpha uses a March deadline.');
    expect(alphaContext.text).not.toContain('Beta uses the blue palette.');
    expect(alphaContext.globalEntries).toBe(1);
    expect(alphaContext.projectEntries).toBe(1);

    const betaContext = store.memory.contextForTask(beta.id);
    expect(betaContext.text).toContain('Beta uses the blue palette.');
    expect(betaContext.text).not.toContain('Alpha uses a March deadline.');

    const unscoped = store.memory.contextForTask(null);
    expect(unscoped.text).toContain('Prefer primary sources.');
    expect(unscoped.text).not.toContain('Alpha uses a March deadline.');
    expect(unscoped.text).not.toContain('Beta uses the blue palette.');

    // Every project has its own canonical file.
    expect(existsSync(projectPath(home, alpha.id))).toBe(true);
    expect(existsSync(projectPath(home, beta.id))).toBe(true);
    expect(store.memory.readFileView('project', alpha.id).path).toBe(
      projectPath(home, alpha.id),
    );

    expect(() => propose(store, 'Ghost fact.', 'project', 'missing-project')).toThrowError(
      MemoryProjectNotFoundError,
    );
  });

  it('survives restart with Markdown canonical and pending text still pending', () => {
    const fixture = openFixture('restart');
    const alpha = fixture.store.projects.create({ name: 'Restart project' }, at(0));
    const globalProposal = propose(fixture.store, 'Prefer dated updates.');
    const projectProposal = propose(
      fixture.store,
      'Restart project ships on Fridays.',
      'project',
      alpha.id,
    );
    const pending = propose(fixture.store, 'Still waiting for a decision.');
    fixture.store.memory.approveProposal(
      globalProposal.id,
      { expectedFileSha256: null },
      at(1),
    );
    const projectView = fixture.store.memory.readFileView('project', alpha.id);
    fixture.store.memory.approveProposal(
      projectProposal.id,
      { expectedFileSha256: projectView.sha256 },
      at(2),
    );

    const globalViewBeforeRestart = fixture.store.memory.readFileView('global', null);
    fixture.opened.sqlite.close();
    const reopened = openDatabase(fixture.home);
    const restarted = createStore(reopened.db, { home: reopened.home });
    try {
      const context = restarted.memory.contextForTask(alpha.id);
      expect(context.text).toContain('Prefer dated updates.');
      expect(context.text).toContain('Restart project ships on Fridays.');
      expect(context.text).not.toContain('Still waiting for a decision.');
      expect(restarted.memory.listProposals(['pending']).map((p) => p.id)).toEqual([
        pending.id,
      ]);
      expect(restarted.memory.getProposal(globalProposal.id)?.state).toBe('approved');
      expect(restarted.memory.readFileView('global', null).sha256).toBe(
        globalViewBeforeRestart.sha256,
      );
    } finally {
      reopened.sqlite.close();
    }
  });

  it('refuses to overwrite an externally edited file until it is reloaded', () => {
    const { home, store } = openFixture('external');
    const first = propose(store, 'Prefer short paragraphs.');
    const approved = store.memory.approveProposal(
      first.id,
      { expectedFileSha256: null },
      at(1),
    );
    const seen = store.memory.readFileView('global', null);
    expect(seen.externalChange).toBe(false);

    // The owner edits the canonical Markdown outside OpenFrost.
    appendFileSync(globalPath(home), '\nOwner-added prose after approval.\n');
    const changed = store.memory.readFileView('global', null);
    expect(changed.externalChange).toBe(true);
    expect(changed.entries.map((entry) => entry.id)).toEqual([approved.entry.id]);

    const second = propose(store, 'Prefer exact citations.');
    const beforeConflict = readFileSync(globalPath(home), 'utf8');
    expect(() =>
      store.memory.approveProposal(
        second.id,
        { expectedFileSha256: seen.sha256 },
        at(2),
      ),
    ).toThrowError(MemoryFileChangedError);
    expect(readFileSync(globalPath(home), 'utf8')).toBe(beforeConflict);
    expect(store.memory.getProposal(second.id)?.state).toBe('pending');

    expect(() =>
      store.memory.updateEntry(
        approved.entry.id,
        {
          content: 'Prefer shorter paragraphs.',
          expectedFileSha256: seen.sha256 ?? '',
        },
        at(3),
      ),
    ).toThrowError(MemoryFileChangedError);
    expect(() =>
      store.memory.deleteEntry(approved.entry.id, seen.sha256 ?? '', at(4)),
    ).toThrowError(MemoryFileChangedError);
    expect(readFileSync(globalPath(home), 'utf8')).toBe(beforeConflict);

    // Reload indexes the external version without destroying owner prose.
    const [reloaded] = store.memory.reloadAll(at(5));
    expect(reloaded?.externalChange).toBe(false);
    expect(readFileSync(globalPath(home), 'utf8')).toContain(
      'Owner-added prose after approval.',
    );

    const updated = store.memory.updateEntry(
      approved.entry.id,
      {
        content: 'Prefer shorter paragraphs.',
        expectedFileSha256: reloaded?.sha256 ?? '',
      },
      at(6),
    );
    expect(updated.entry.content).toBe('Prefer shorter paragraphs.');
    const afterUpdate = readFileSync(globalPath(home), 'utf8');
    expect(afterUpdate).toContain('Prefer shorter paragraphs.');
    expect(afterUpdate).toContain('Owner-added prose after approval.');

    const current = store.memory.readFileView('global', null);
    store.memory.deleteEntry(approved.entry.id, current.sha256 ?? '', at(7));
    const afterDelete = readFileSync(globalPath(home), 'utf8');
    expect(afterDelete).not.toContain('Prefer shorter paragraphs.');
    expect(afterDelete).toContain('Owner-added prose after approval.');
  });

  it('reports and refuses to edit a malformed memory file', () => {
    const { home, store } = openFixture('malformed');
    writeFileSync(
      globalPath(home),
      'Owner notes.\n\n<!-- openfrost-memory:not-base64 -->\nbody\n<!-- /openfrost-memory -->\n',
      'utf8',
    );
    const view = store.memory.readFileView('global', null);
    expect(view.problems.length).toBeGreaterThan(0);
    expect(view.entries).toEqual([]);

    const proposal = propose(store, 'A valid fact.');
    expect(() =>
      store.memory.approveProposal(
        proposal.id,
        { expectedFileSha256: view.sha256 },
        at(1),
      ),
    ).toThrowError(MemoryFileUnreadableError);
    expect(readFileSync(globalPath(home), 'utf8')).toContain('Owner notes.');
  });

  it('refuses memory files larger than the bounded read size', () => {
    const { home, store } = openFixture('oversized');
    writeFileSync(globalPath(home), 'x'.repeat(MEMORY_FILE_MAX_BYTES + 1), 'utf8');

    const view = store.memory.readFileView('global', null);
    expect(view).toMatchObject({ exists: true, sha256: null, entries: [] });
    expect(view.problems).toContain(
      `The memory file is larger than ${MEMORY_FILE_MAX_BYTES} bytes; it was not parsed.`,
    );
    expect(store.memory.contextForTask(null)).toMatchObject({
      text: '',
      globalEntries: 0,
      problems: view.problems,
    });
  });

  it('excludes secrets from proposals, approvals, and edits', () => {
    const { home, store } = openFixture('secrets');
    const key = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    expect(() => propose(store, `Remember ${key}`)).toThrowError(MemorySecretError);
    expect(store.memory.listProposals()).toEqual([]);

    const proposal = propose(store, 'Prefer local notes.');
    expect(() =>
      store.memory.approveProposal(
        proposal.id,
        { content: `My key is ${key}`, expectedFileSha256: null },
        at(1),
      ),
    ).toThrowError(MemorySecretError);
    expect(existsSync(globalPath(home))).toBe(false);
    expect(store.memory.getProposal(proposal.id)?.state).toBe('pending');

    const approved = store.memory.approveProposal(
      proposal.id,
      {
        expectedFileSha256: null,
        knownSecrets: ['correct horse battery staple'],
      },
      at(2),
    );
    const current = store.memory.readFileView('global', null);
    expect(() =>
      store.memory.updateEntry(
        approved.entry.id,
        {
          content: 'The phrase is correct horse battery staple.',
          expectedFileSha256: current.sha256 ?? '',
          knownSecrets: ['correct horse battery staple'],
        },
        at(3),
      ),
    ).toThrowError(MemorySecretError);
    expect(readFileSync(globalPath(home), 'utf8')).not.toContain(
      'correct horse battery staple',
    );
  });

  it('refuses duplicate pending or approved memories', () => {
    const { store } = openFixture('duplicates');
    const proposal = propose(store, 'Prefer concise updates.');
    expect(() => propose(store, '  prefer   concise updates.  ')).toThrowError(
      MemoryDuplicateError,
    );
    store.memory.approveProposal(proposal.id, { expectedFileSha256: null }, at(1));
    expect(() => propose(store, 'Prefer concise updates.')).toThrowError(
      MemoryDuplicateError,
    );
    expect(store.memory.listProposals()).toHaveLength(1);
  });

  it('preserves owner-authored Markdown prose through approval, edit, and delete', () => {
    const { home, store } = openFixture('prose');
    writeFileSync(
      globalPath(home),
      '# My memory notes\n\nAsk me for sources.\n',
      'utf8',
    );
    const before = store.memory.readFileView('global', null);
    const proposal = propose(store, 'Prefer a short uncertainty section.');
    const approved = store.memory.approveProposal(
      proposal.id,
      { expectedFileSha256: before.sha256 },
      at(1),
    );

    let markdown = readFileSync(globalPath(home), 'utf8');
    expect(markdown).toContain('# My memory notes');
    expect(markdown).toContain('Ask me for sources.');
    expect(markdown).toContain('Prefer a short uncertainty section.');

    const view = store.memory.readFileView('global', null);
    store.memory.updateEntry(
      approved.entry.id,
      {
        content: 'Always include an uncertainty section.',
        expectedFileSha256: view.sha256 ?? '',
      },
      at(2),
    );
    markdown = readFileSync(globalPath(home), 'utf8');
    expect(markdown).toContain('# My memory notes');
    expect(markdown).toContain('Ask me for sources.');
    expect(markdown).toContain('Always include an uncertainty section.');

    const edited = store.memory.readFileView('global', null);
    store.memory.deleteEntry(approved.entry.id, edited.sha256 ?? '', at(3));
    markdown = readFileSync(globalPath(home), 'utf8');
    expect(markdown).toContain('# My memory notes');
    expect(markdown).toContain('Ask me for sources.');
    expect(markdown).not.toContain('Always include an uncertainty section.');
  });
});

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryFileView, MemoryProposal } from '@openfrost/domain';
import { jarHeaders, setupOwner, startApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeEach(async () => {
  app = await startApp();
  await setupOwner(app);
});

afterEach(async () => {
  await app.close();
});

interface Snapshot {
  global: MemoryFileView;
  projects: Array<MemoryFileView & { projectId: string; projectName: string }>;
  proposals: MemoryProposal[];
  limits: {
    contentMaxChars: number;
    entriesPerFile: number;
    contextMaxChars: number;
  };
}

function createProposal(
  content: string,
  scope: 'global' | 'project' = 'global',
  projectId: string | null = null,
): MemoryProposal {
  return app.store.memory.createProposal(
    {
      scope,
      projectId,
      content,
      source: {
        kind: 'task',
        taskId: 'task-memory',
        artifactId: null,
        label: 'Memory API test',
      },
      sourceRunId: 'run-memory',
    },
    '2026-10-25T12:00:00.000Z',
  );
}

async function getSnapshot(): Promise<Snapshot> {
  const response = await app.built.app.inject({
    method: 'GET',
    url: '/api/memory',
    headers: { cookie: app.cookie! },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as Snapshot;
}

function globalFile(): string {
  return join(app.home, 'memory', 'owner.md');
}

describe('memory API', () => {
  it('requires an owner session and exposes inspectable scope, source, and dates', async () => {
    const proposal = createProposal('Prefer concise summaries.');

    const anon = await app.built.app.inject({ method: 'GET', url: '/api/memory' });
    expect(anon.statusCode).toBe(401);

    const snapshot = await getSnapshot();
    expect(snapshot.global).toMatchObject({
      scope: 'global',
      projectId: null,
      exists: false,
      sha256: null,
      entries: [],
      problems: [],
      externalChange: false,
    });
    expect(snapshot.global.path).toBe(globalFile());
    expect(snapshot.proposals).toHaveLength(1);
    expect(snapshot.proposals[0]).toMatchObject({
      id: proposal.id,
      scope: 'global',
      projectId: null,
      content: 'Prefer concise summaries.',
      state: 'pending',
      proposedAt: '2026-10-25T12:00:00.000Z',
      source: {
        kind: 'task',
        taskId: 'task-memory',
        label: 'Memory API test',
      },
    });
    expect(snapshot.limits.contentMaxChars).toBeGreaterThan(0);

    const noCsrf = await app.built.app.inject({
      method: 'POST',
      url: `/api/memory/proposals/${proposal.id}/approve`,
      headers: { cookie: app.cookie! },
      payload: { fileSha256: null },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('approves, edits, and deletes memory with canonical Markdown and audit events', async () => {
    const proposal = createProposal('Prefer evidence-first briefs.');
    const before = await getSnapshot();

    const approved = await app.built.app.inject({
      method: 'POST',
      url: `/api/memory/proposals/${proposal.id}/approve`,
      headers: jarHeaders(app),
      payload: { fileSha256: before.global.sha256 },
    });
    expect(approved.statusCode).toBe(200);
    const approvedBody = approved.json() as {
      entry: { id: string; content: string; scope: string; projectId: string | null };
      file: MemoryFileView;
    };
    expect(approvedBody.entry).toMatchObject({
      content: 'Prefer evidence-first briefs.',
      scope: 'global',
      projectId: null,
    });
    expect(approvedBody.file.sha256).toHaveLength(64);
    expect(readFileSync(globalFile(), 'utf8')).toContain('Prefer evidence-first briefs.');
    expect(app.store.memory.contextForTask(null).text).toContain(
      'Prefer evidence-first briefs.',
    );

    const edited = await app.built.app.inject({
      method: 'PUT',
      url: `/api/memory/entries/${approvedBody.entry.id}`,
      headers: jarHeaders(app),
      payload: {
        content: 'Prefer evidence-first briefs with exact citations.',
        fileSha256: approvedBody.file.sha256,
      },
    });
    expect(edited.statusCode).toBe(200);
    const editedBody = edited.json() as { entry: { content: string }; file: MemoryFileView };
    expect(editedBody.entry.content).toBe(
      'Prefer evidence-first briefs with exact citations.',
    );
    expect(readFileSync(globalFile(), 'utf8')).toContain('with exact citations');

    const deleted = await app.built.app.inject({
      method: 'DELETE',
      url: `/api/memory/entries/${approvedBody.entry.id}`,
      headers: jarHeaders(app),
      payload: { fileSha256: editedBody.file.sha256 },
    });
    expect(deleted.statusCode).toBe(200);
    expect(app.store.memory.contextForTask(null).text).toBe('');
    expect(readFileSync(globalFile(), 'utf8')).not.toContain('with exact citations');

    const after = await getSnapshot();
    expect(after.global.entries).toEqual([]);
    expect(after.proposals[0]).toMatchObject({
      id: proposal.id,
      state: 'approved',
      content: null,
      memoryEntryId: approvedBody.entry.id,
    });

    const eventTypes = app.store.events
      .listRecent(50)
      .filter((event) => event.type.startsWith('memory.'))
      .map((event) => event.type);
    expect(eventTypes).toContain('memory.approved');
    expect(eventTypes).toContain('memory.updated');
    expect(eventTypes).toContain('memory.deleted');
    // Source history survives deletion.
    expect(app.store.memory.getProposal(proposal.id)?.source).toMatchObject({
      taskId: 'task-memory',
      label: 'Memory API test',
    });
  });

  it('rejects a proposal without creating memory', async () => {
    const proposal = createProposal('Temporary detail.');
    const rejected = await app.built.app.inject({
      method: 'POST',
      url: `/api/memory/proposals/${proposal.id}/reject`,
      headers: jarHeaders(app),
    });
    expect(rejected.statusCode).toBe(200);
    const body = rejected.json() as { proposal: MemoryProposal };
    expect(body.proposal).toMatchObject({
      id: proposal.id,
      state: 'rejected',
      content: null,
      source: { label: 'Memory API test' },
    });
    expect(existsSync(globalFile())).toBe(false);
    expect(app.store.memory.contextForTask(null).text).toBe('');
    expect(
      app.store.events.listRecent(20).some((event) => event.type === 'memory.rejected'),
    ).toBe(true);
  });

  it('keeps project memory isolated and names each project in the snapshot', async () => {
    const alpha = app.store.projects.create({ name: 'Alpha' }, '2026-10-25T12:00:00.000Z');
    const beta = app.store.projects.create({ name: 'Beta' }, '2026-10-25T12:00:01.000Z');
    const globalProposal = createProposal('Prefer primary sources.');
    const alphaProposal = createProposal('Alpha ships on Fridays.', 'project', alpha.id);
    const betaProposal = createProposal('Beta uses blue diagrams.', 'project', beta.id);

    const initial = await getSnapshot();
    expect(initial.projects.map((project) => project.projectName)).toEqual(['Alpha', 'Beta']);
    expect(initial.projects.every((project) => project.entries.length === 0)).toBe(true);

    for (const proposal of [globalProposal, alphaProposal, betaProposal]) {
      const view =
        proposal.scope === 'global'
          ? app.store.memory.readFileView('global', null)
          : app.store.memory.readFileView('project', proposal.projectId);
      const response = await app.built.app.inject({
        method: 'POST',
        url: `/api/memory/proposals/${proposal.id}/approve`,
        headers: jarHeaders(app),
        payload: { fileSha256: view.sha256 },
      });
      expect(response.statusCode).toBe(200);
    }

    const alphaContext = app.store.memory.contextForTask(alpha.id);
    expect(alphaContext.text).toContain('Prefer primary sources.');
    expect(alphaContext.text).toContain('Alpha ships on Fridays.');
    expect(alphaContext.text).not.toContain('Beta uses blue diagrams.');
    const betaContext = app.store.memory.contextForTask(beta.id);
    expect(betaContext.text).toContain('Beta uses blue diagrams.');
    expect(betaContext.text).not.toContain('Alpha ships on Fridays.');
    expect(app.store.memory.contextForTask(null).text).not.toContain('Alpha ships on Fridays.');

    const snapshot = await getSnapshot();
    expect(snapshot.projects.find((project) => project.projectId === alpha.id)?.entries)
      .toHaveLength(1);
    expect(snapshot.projects.find((project) => project.projectId === beta.id)?.entries)
      .toHaveLength(1);

    const missingProject = await app.built.app.inject({
      method: 'GET',
      url: '/api/memory',
      headers: { cookie: app.cookie! },
    });
    expect(missingProject.statusCode).toBe(200);
    expect(() =>
      app.store.memory.readFileView('project', 'missing-project'),
    ).toThrowError();
  });

  it('detects external edits before overwrite and reloads them without data loss', async () => {
    const first = createProposal('Prefer short paragraphs.');
    const approveResponse = await app.built.app.inject({
      method: 'POST',
      url: `/api/memory/proposals/${first.id}/approve`,
      headers: jarHeaders(app),
      payload: { fileSha256: null },
    });
    expect(approveResponse.statusCode).toBe(200);
    const approved = approveResponse.json() as {
      entry: { id: string };
      file: MemoryFileView;
    };

    appendFileSync(globalFile(), '\nOwner prose added outside the app.\n');
    const snapshot = await getSnapshot();
    expect(snapshot.global.externalChange).toBe(true);
    expect(snapshot.global.sha256).not.toBe(approved.file.sha256);

    const second = createProposal('Prefer exact citations.');
    const staleApprove = await app.built.app.inject({
      method: 'POST',
      url: `/api/memory/proposals/${second.id}/approve`,
      headers: jarHeaders(app),
      payload: { fileSha256: approved.file.sha256 },
    });
    expect(staleApprove.statusCode).toBe(409);
    expect(staleApprove.json()).toMatchObject({
      error: expect.stringContaining('changed on disk') as string,
      currentSha256: snapshot.global.sha256,
    });
    expect(app.store.memory.getProposal(second.id)?.state).toBe('pending');

    const staleEdit = await app.built.app.inject({
      method: 'PUT',
      url: `/api/memory/entries/${approved.entry.id}`,
      headers: jarHeaders(app),
      payload: {
        content: 'Prefer shorter paragraphs.',
        fileSha256: approved.file.sha256,
      },
    });
    expect(staleEdit.statusCode).toBe(409);

    const staleDelete = await app.built.app.inject({
      method: 'DELETE',
      url: `/api/memory/entries/${approved.entry.id}`,
      headers: jarHeaders(app),
      payload: { fileSha256: approved.file.sha256 },
    });
    expect(staleDelete.statusCode).toBe(409);
    expect(readFileSync(globalFile(), 'utf8')).toContain('Owner prose added outside the app.');

    const reload = await app.built.app.inject({
      method: 'POST',
      url: '/api/memory/reload',
      headers: jarHeaders(app),
    });
    expect(reload.statusCode).toBe(200);
    const reloaded = reload.json() as { files: MemoryFileView[] };
    expect(reloaded.files[0]?.externalChange).toBe(false);
    expect(reloaded.files[0]?.entries.map((entry) => entry.id)).toEqual([
      approved.entry.id,
    ]);
    expect(
      app.store.events
        .listRecent(20)
        .find((event) => event.type === 'memory.reloaded')?.payload,
    ).toMatchObject({ files: 1, externalChanges: 1 });

    const fresh = await getSnapshot();
    const freshEdit = await app.built.app.inject({
      method: 'PUT',
      url: `/api/memory/entries/${approved.entry.id}`,
      headers: jarHeaders(app),
      payload: {
        content: 'Prefer shorter paragraphs.',
        fileSha256: fresh.global.sha256,
      },
    });
    expect(freshEdit.statusCode).toBe(200);
    const markdown = readFileSync(globalFile(), 'utf8');
    expect(markdown).toContain('Prefer shorter paragraphs.');
    expect(markdown).toContain('Owner prose added outside the app.');
  });

  it('refuses credential material at the API boundary', async () => {
    const proposal = createProposal('Prefer local notes.');
    const key = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const response = await app.built.app.inject({
      method: 'POST',
      url: `/api/memory/proposals/${proposal.id}/approve`,
      headers: jarHeaders(app),
      payload: {
        content: `Remember ${key}`,
        fileSha256: null,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining('credential') as string,
    });
    expect(response.body).not.toContain(key);
    expect(existsSync(globalFile())).toBe(false);
    expect(app.store.memory.getProposal(proposal.id)?.state).toBe('pending');
  });

  it('returns 404 for unknown proposals and entries', async () => {
    const missingProposal = await app.built.app.inject({
      method: 'POST',
      url: '/api/memory/proposals/missing/approve',
      headers: jarHeaders(app),
      payload: { fileSha256: null },
    });
    expect(missingProposal.statusCode).toBe(404);

    const missingEntry = await app.built.app.inject({
      method: 'PUT',
      url: '/api/memory/entries/missing',
      headers: jarHeaders(app),
      payload: { content: 'x', fileSha256: 'a'.repeat(64) },
    });
    expect(missingEntry.statusCode).toBe(404);

    const missingReject = await app.built.app.inject({
      method: 'POST',
      url: '/api/memory/proposals/missing/reject',
      headers: jarHeaders(app),
    });
    expect(missingReject.statusCode).toBe(404);
  });
});

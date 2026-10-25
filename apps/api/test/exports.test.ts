import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jarHeaders, setupOwner, startApp, type TestApp } from './helpers.js';

let app: TestApp;
let destDir: string;
let canonicalDir: string;

beforeAll(async () => {
  app = await startApp({
    steps: [
      { type: 'final', text: 'unused — exports never call the model (brief 1)' },
      { type: 'final', text: 'unused — exports never call the model (brief 2)' },
      { type: 'final', text: 'unused — exports never call the model (brief 3)' },
    ],
  });
  await setupOwner(app);
  destDir = mkdtempSync(join(tmpdir(), 'openfrost-api-export-'));
  canonicalDir = fs.realpathSync(destDir);
});

afterAll(async () => {
  await app.close();
  rmSync(destDir, { recursive: true, force: true });
});

interface ApprovalResponse {
  id: string;
  taskId: string;
  state: string;
  filename: string;
  destinationPath: string;
  artifactMarkdown: string | null;
  taskTitle: string | null;
}

async function listApprovals(state?: string): Promise<ApprovalResponse[]> {
  const res = await app.built.app.inject({
    method: 'GET',
    url: `/api/approvals${state ? `?state=${state}` : ''}`,
    headers: { cookie: app.cookie! },
  });
  expect(res.statusCode).toBe(200);
  return res.json().approvals;
}

async function waitForTaskState(taskId: string, states: string[]): Promise<string> {
  for (let index = 0; index < 200; index += 1) {
    const detail = await app.built.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: app.cookie! },
    });
    const state = detail.json().task.state as string;
    if (states.includes(state)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`task never reached ${states.join('/')}`);
}

describe('export destinations over the API', () => {
  it('requires authentication and CSRF', async () => {
    const anon = await app.built.app.inject({ method: 'GET', url: '/api/exports/destinations' });
    expect(anon.statusCode).toBe(401);
    const noCsrf = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports/destinations',
      headers: { cookie: app.cookie! },
      payload: { path: canonicalDir },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('grants canonical destinations, refuses duplicates and unsafe roots', async () => {
    const granted = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports/destinations',
      headers: jarHeaders(app),
      payload: { path: destDir },
    });
    expect(granted.statusCode).toBe(201);
    expect(granted.json().destination.path).toBe(canonicalDir);

    const duplicate = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports/destinations',
      headers: jarHeaders(app),
      payload: { path: canonicalDir },
    });
    expect(duplicate.statusCode).toBe(409);

    const missing = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports/destinations',
      headers: jarHeaders(app),
      payload: { path: join(destDir, 'nope') },
    });
    expect(missing.statusCode).toBe(400);

    const homeRoot = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports/destinations',
      headers: jarHeaders(app),
      payload: { path: app.home },
    });
    expect(homeRoot.statusCode).toBe(400);

    const list = await app.built.app.inject({
      method: 'GET',
      url: '/api/exports/destinations',
      headers: { cookie: app.cookie! },
    });
    expect(list.json().destinations.some((d: { path: string }) => d.path === canonicalDir)).toBe(true);
  });

  it('removes a destination and 404s unknown ids', async () => {
    const temp = fs.realpathSync(mkdtempSync(join(tmpdir(), 'openfrost-api-dest2-')));
    const granted = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports/destinations',
      headers: jarHeaders(app),
      payload: { path: temp },
    });
    const id = granted.json().destination.id as string;
    const removed = await app.built.app.inject({
      method: 'DELETE',
      url: `/api/exports/destinations/${id}`,
      headers: jarHeaders(app),
    });
    expect(removed.statusCode).toBe(200);
    const unknown = await app.built.app.inject({
      method: 'DELETE',
      url: `/api/exports/destinations/${id}`,
      headers: jarHeaders(app),
    });
    expect(unknown.statusCode).toBe(404);
    fs.rmSync(temp, { recursive: true, force: true });
  });
});

describe('approval-bound export over the API', () => {
  it('proposes, reviews, approves, and writes the file end to end', async () => {
    // A completed research task provides the artifact.
    const create = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: { title: 'Brief for export', request: 'research something' },
    });
    const taskId = create.json().task.id as string;
    await waitForTaskState(taskId, ['completed']);
    const detail = await app.built.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: app.cookie! },
    });
    const artifactId = detail.json().artifact.id as string;

    // Reject an export pointing at an unknown artifact/destination.
    const badArtifact = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports',
      headers: jarHeaders(app),
      payload: {
        artifactId: 'missing-artifact',
        destinationId: 'missing-destination',
        filename: 'missing.md',
      },
    });
    expect(badArtifact.statusCode).toBe(404);
    const badFilename = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports',
      headers: jarHeaders(app),
      payload: { artifactId, destinationId: 'missing', filename: '../evil.md' },
    });
    expect(badFilename.statusCode).toBe(400);

    // Propose the export; the task parks awaiting review.
    const destinationId = app.store.exportDestinations.list()[0]!.id;
    const proposed = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports',
      headers: jarHeaders(app),
      payload: { artifactId, destinationId, filename: 'brief-copy.md' },
    });
    expect(proposed.statusCode).toBe(202);
    const exportTaskId = proposed.json().task.id as string;
    expect(proposed.json().task.kind).toBe('export_report');
    await waitForTaskState(exportTaskId, ['awaiting_approval']);

    // The review view carries the exact proposed content.
    const pending = await listApprovals('pending');
    const proposal = pending.find((a) => a.taskId === exportTaskId)!;
    expect(proposal.filename).toBe('brief-copy.md');
    expect(proposal.artifactMarkdown).toContain('unused — exports never call the model');
    expect(proposal.destinationPath).toBe(canonicalDir);
    expect(proposal.riskTier).toBe('telegram');

    // A duplicate decision attempt before deciding is fine to try twice via
    // the HTTP surface only after a decision; first decide and confirm the
    // decision endpoint refuses replays.
    const decided = await app.built.app.inject({
      method: 'POST',
      url: `/api/approvals/${proposal.id}/decision`,
      headers: jarHeaders(app),
      payload: { decision: 'granted' },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().approval.state).toBe('granted');

    const replay = await app.built.app.inject({
      method: 'POST',
      url: `/api/approvals/${proposal.id}/decision`,
      headers: jarHeaders(app),
      payload: { decision: 'rejected' },
    });
    expect(replay.statusCode).toBe(409);

    const finalState = await waitForTaskState(exportTaskId, ['completed', 'failed', 'canceled']);
    expect(finalState).toBe('completed');
    const written = join(canonicalDir, 'brief-copy.md');
    expect(fs.existsSync(written)).toBe(true);

    // The task detail exposes the executed approval with its outcome.
    const finalDetail = await app.built.app.inject({
      method: 'GET',
      url: `/api/tasks/${exportTaskId}`,
      headers: { cookie: app.cookie! },
    });
    expect(finalDetail.json().approval.state).toBe('executed');
    expect(finalDetail.json().approval.outcome.file).toBe(written);
  });

  it('rejecting through the API writes nothing and cancels the task', async () => {
    const create = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: { title: 'Rejected brief', request: 'research something' },
    });
    const taskId = create.json().task.id as string;
    await waitForTaskState(taskId, ['completed']);
    const artifactId = (await app.built.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: app.cookie! },
    })).json().artifact.id as string;

    const destinationId = app.store.exportDestinations.list()[0]!.id;
    const proposed = await app.built.app.inject({
      method: 'POST',
      url: '/api/exports',
      headers: jarHeaders(app),
      payload: { artifactId, destinationId, filename: 'rejected-copy.md' },
    });
    const exportTaskId = proposed.json().task.id as string;
    await waitForTaskState(exportTaskId, ['awaiting_approval']);
    const proposal = (await listApprovals('pending')).find((a) => a.taskId === exportTaskId)!;

    const rejected = await app.built.app.inject({
      method: 'POST',
      url: `/api/approvals/${proposal.id}/decision`,
      headers: jarHeaders(app),
      payload: { decision: 'rejected' },
    });
    expect(rejected.statusCode).toBe(200);
    await waitForTaskState(exportTaskId, ['canceled']);
    expect(fs.existsSync(join(canonicalDir, 'rejected-copy.md'))).toBe(false);
    const events = app.store.events.listForTask(exportTaskId).map((e) => e.type);
    expect(events).toContain('approval.rejected');
    expect(events).not.toContain('export.written');
  });
});

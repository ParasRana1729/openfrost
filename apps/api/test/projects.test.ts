import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jarHeaders, setupOwner, startApp, waitFor, type TestApp } from './helpers.js';

let app: TestApp;
let notesRoot: string;
let notesDir: string;
let notesFile: string;

beforeAll(async () => {
  // One scripted provider for the whole suite: the project-update flow below
  // consumes the first two steps (read + final); nothing else runs steps.
  app = await startApp({
    steps: [
      { type: 'tool_calls', calls: [] },
      { type: 'final', text: 'placeholder' },
    ],
  });
  await setupOwner(app);
  notesRoot = mkdtempSync(join(tmpdir(), 'openfrost-api-projects-'));
  notesDir = join(notesRoot, 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  notesFile = join(notesDir, 'progress.md');
  fs.writeFileSync(notesFile, '## Progress\n\nThe migration ran cleanly.');
});

afterAll(async () => {
  await app.close();
  rmSync(notesRoot, { recursive: true, force: true });
});

interface ProjectResponse {
  id: string;
  name: string;
  instructions: string | null;
  grants: Array<{ id: string; path: string }>;
}

function createProject(body: Record<string, unknown>): Promise<{ statusCode: number; json: () => { project?: ProjectResponse; error?: string } }> {
  return app.built.app
    .inject({
      method: 'POST',
      url: '/api/projects',
      headers: jarHeaders(app),
      payload: body,
    })
    .then((res) => ({ statusCode: res.statusCode, json: () => res.json() }));
}

describe('projects API', () => {
  it('requires authentication and CSRF', async () => {
    const anon = await app.built.app.inject({ method: 'GET', url: '/api/projects' });
    expect(anon.statusCode).toBe(401);

    const noCsrf = await app.built.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: app.cookie! },
      payload: { name: 'X' },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('creates, lists, and updates a project', async () => {
    const created = await createProject({
      name: 'Thesis',
      instructions: 'Cite files by path.',
    });
    expect(created.statusCode).toBe(201);
    const project = created.json().project!;
    expect(project.name).toBe('Thesis');
    expect(project.grants).toEqual([]);

    const list = await app.built.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: app.cookie! },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().projects.some((p: ProjectResponse) => p.id === project.id)).toBe(true);

    const updated = await app.built.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}`,
      headers: jarHeaders(app),
      payload: { name: 'Thesis 2026' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().project.name).toBe('Thesis 2026');
    expect(updated.json().project.instructions).toBe('Cite files by path.');

    const invalid = await createProject({ name: '' });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.built.app.inject({
      method: 'PUT',
      url: '/api/projects/does-not-exist',
      headers: jarHeaders(app),
      payload: { name: 'X' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('grants a folder canonically and refuses unsafe roots', async () => {
    const created = await createProject({ name: 'Grants' });
    const projectId = created.json().project!.id;

    // A forward-slash spelling resolves to the same canonical folder.
    const granted = await app.built.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/grants`,
      headers: jarHeaders(app),
      payload: { path: notesDir.replace(/\\/g, '/') },
    });
    expect(granted.statusCode).toBe(201);
    const grant = granted.json().grant as { id: string; path: string };
    expect(grant.path).toBe(fs.realpathSync(notesDir));

    const duplicate = await app.built.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/grants`,
      headers: jarHeaders(app),
      payload: { path: notesDir },
    });
    expect(duplicate.statusCode).toBe(409);

    const missing = await app.built.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/grants`,
      headers: jarHeaders(app),
      payload: { path: join(notesRoot, 'nope') },
    });
    expect(missing.statusCode).toBe(400);

    const relative = await app.built.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/grants`,
      headers: jarHeaders(app),
      payload: { path: 'relative/path' },
    });
    expect(relative.statusCode).toBe(400);

    // The OpenFrost home of this test app is never grantable.
    const homeGrant = await app.built.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/grants`,
      headers: jarHeaders(app),
      payload: { path: app.home },
    });
    expect(homeGrant.statusCode).toBe(400);

    // Drive roots are refused.
    const driveRoot = await app.built.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/grants`,
      headers: jarHeaders(app),
      payload: { path: 'C:\\' },
    });
    expect(driveRoot.statusCode).toBe(400);

    const revoked = await app.built.app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/grants/${grant.id}`,
      headers: jarHeaders(app),
    });
    expect(revoked.statusCode).toBe(200);
    const after = await app.built.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
      headers: { cookie: app.cookie! },
    });
    expect(after.json().project.grants).toEqual([]);
  });

  it('validates task project scoping', async () => {
    const created = await createProject({ name: 'Scoped' });
    const projectId = created.json().project!.id;

    const updateWithoutProject = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: { title: 'Update', request: 'x', kind: 'project_update' },
    });
    expect(updateWithoutProject.statusCode).toBe(400);

    const unknownProject = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: {
        title: 'Update',
        request: 'x',
        kind: 'project_update',
        projectId: 'does-not-exist',
      },
    });
    expect(unknownProject.statusCode).toBe(404);

    const scopedBrief = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: { title: 'Brief', request: 'x', projectId },
    });
    expect(scopedBrief.statusCode).toBe(202);
    expect(scopedBrief.json().task.projectId).toBe(projectId);
    expect(scopedBrief.json().task.kind).toBe('research_brief');
    // Drain the queue before the full update flow below consumes its steps.
    await waitFor(async () => {
      const tasks = await app.built.app
        .inject({ method: 'GET', url: '/api/tasks', headers: { cookie: app.cookie! } })
        .then((res) => res.json().tasks as Array<{ id: string; state: string }>);
      return tasks.every((t) => !['queued', 'running'].includes(t.state));
    });
  });

  it('runs a project update end to end and saves the cited update', async () => {
    // Dedicated app: its scripted provider reads the granted file, then
    // finishes, so the full HTTP path (projects → grants → scoped task →
    // artifact) is exercised with a real file read.
    const flowApp = await startApp({
      steps: [
        {
          type: 'tool_calls',
          calls: [{ name: 'read_project_file', argsJson: JSON.stringify({ path: notesFile }) }],
        },
        {
          type: 'final',
          text: 'Update: the notes state the migration ran cleanly.',
          usage: { inputTokens: 100, outputTokens: 20 },
        },
      ],
    });
    await setupOwner(flowApp);
    try {
      const created = await flowApp.built.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: jarHeaders(flowApp),
        payload: { name: 'E2E', instructions: 'Quote the notes exactly.' },
      });
      const projectId = created.json().project.id as string;
      const grant = await flowApp.built.app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/grants`,
        headers: jarHeaders(flowApp),
        payload: { path: notesDir },
      });
      expect(grant.statusCode).toBe(201);

      const submit = await flowApp.built.app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: jarHeaders(flowApp),
        payload: {
          title: 'Weekly update',
          request: 'Prepare the weekly project update.',
          projectId,
          kind: 'project_update',
        },
      });
      expect(submit.statusCode).toBe(202);
      const taskId = submit.json().task.id as string;

      await waitFor(async () => {
        const tasks = await flowApp.built.app
          .inject({ method: 'GET', url: '/api/tasks', headers: { cookie: flowApp.cookie! } })
          .then((res) => res.json().tasks as Array<{ id: string; state: string }>);
        return tasks.some((t) => t.id === taskId && (t.state === 'completed' || t.state === 'failed'));
      });

      const detail = await flowApp.built.app.inject({
        method: 'GET',
        url: `/api/tasks/${taskId}`,
        headers: { cookie: flowApp.cookie! },
      });
      expect(detail.statusCode).toBe(200);
      const body = detail.json();
      expect(body.task.state).toBe('completed');
      expect(body.task.kind).toBe('project_update');
      expect(body.artifact.markdown).toContain('the notes state the migration ran cleanly');
      expect(body.artifact.markdown).toContain('## Project files consulted');
      expect(body.artifact.markdown).toContain(`${fs.realpathSync(notesFile)} — read,`);
      // The tool executed at the auto risk tier with a real read.
      const readEvents = body.events.filter(
        (e: { type: string; payload: { tool?: string; ok?: boolean } }) =>
          e.type === 'tool.executed' && e.payload.tool === 'read_project_file' && e.payload.ok === true,
      );
      expect(readEvents).toHaveLength(1);
    } finally {
      await flowApp.close();
    }
  });
});

describe('fake provider kind routing', () => {
  it('scripts a project-update run when the task message carries the file inventory', async () => {
    const { ActiveProvider } = await import('../src/activeProvider.js');
    const { loadConfig } = await import('../src/config.js');
    const provider = new ActiveProvider({
      config: { ...loadConfig({}), provider: 'fake' as const, homeDir: app.home },
      store: app.store,
    });
    const signal = new AbortController().signal;

    const updateStep = await provider.step({
      messages: [
        { role: 'system', content: 'policy' },
        {
          role: 'user',
          content:
            'Task: u\n\nrequest\n\nGranted project files (absolute paths; read them with read_project_file):\n\n- C:\\notes\\a.md (10 bytes)',
        },
      ],
      tools: [],
      step: 1,
      signal,
    });
    expect(updateStep.kind).toBe('tool_calls');
    if (updateStep.kind === 'tool_calls') {
      expect(updateStep.calls[0]?.name).toBe('read_project_file');
      // The inventory token was replaced with the first listed file.
      expect(updateStep.calls[0]?.argsJson).toContain('C:\\\\notes\\\\a.md');
    }

    // A second run without the inventory gets the research script.
    const researchStep = await provider.step({
      messages: [
        { role: 'system', content: 'policy' },
        { role: 'user', content: 'Task: r\n\nrequest' },
      ],
      tools: [],
      step: 1,
      signal,
    });
    expect(researchStep.kind).toBe('tool_calls');
    if (researchStep.kind === 'tool_calls') {
      expect(researchStep.calls[0]?.name).toBe('fetch_page');
    }
  });
});

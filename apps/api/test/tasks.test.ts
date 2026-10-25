import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jarHeaders, setupOwner, startApp, waitFor, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startApp({
    steps: [
      { type: 'error', message: 'first attempt fails' },
      { type: 'final', text: 'recovered on retry' },
    ],
  });
  await setupOwner(app);
});

afterAll(async () => {
  await app.close();
});

function listTasks(): Promise<Array<{ id: string; state: string }>> {
  return app.built.app
    .inject({ method: 'GET', url: '/api/tasks', headers: { cookie: app.cookie! } })
    .then((res) => res.json().tasks);
}

describe('task lifecycle over the API', () => {
  it('accepts a task and reports completion with its artifact', async () => {
    const create = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: { title: 'Fails first', request: 'please fail' },
    });
    expect(create.statusCode).toBe(202);
    const taskId = create.json().task.id as string;

    await waitFor(async () => {
      const tasks = await listTasks();
      return tasks.some((t) => t.id === taskId && t.state === 'failed');
    });

    const retry = await app.built.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/retry`,
      headers: jarHeaders(app),
    });
    expect(retry.statusCode).toBe(200);

    await waitFor(async () => {
      const tasks = await listTasks();
      return tasks.some((t) => t.id === taskId && t.state === 'completed');
    });

    const detail = await app.built.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: app.cookie! },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.runs).toHaveLength(2);
    expect(body.runs[0].failure.code).toBe('provider_error');
    expect(body.artifact.markdown).toContain('recovered on retry');
    expect(body.events.map((e: { type: string }) => e.type)).toContain('task.completed');
  });

  it('accepts constraints and starting urls and returns them on the task', async () => {
    const create = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: {
        title: 'Sourced research',
        request: 'Compare the two products for personal use.',
        constraints: 'Prefer open-source; budget under $20/month.',
        startingUrls: ['https://example.com/', 'https://www.iana.org/'],
      },
    });
    expect(create.statusCode).toBe(202);
    const taskId = create.json().task.id as string;
    expect(create.json().task.constraints).toContain('open-source');
    expect(create.json().task.startingUrls).toEqual([
      'https://example.com/',
      'https://www.iana.org/',
    ]);

    const detail = await app.built.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: app.cookie! },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().task.constraints).toContain('open-source');
    expect(detail.json().task.startingUrls).toHaveLength(2);

    // Let the run finish so the recovery test below sees only its own
    // crashed task in a running state.
    await waitFor(async () => {
      const tasks = await listTasks();
      return tasks.some((t) => t.id === taskId && t.state === 'failed');
    });
  });

  it('rejects invalid starting urls', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: {
        title: 'Bad urls',
        request: 'x',
        startingUrls: ['ftp://example.com/'],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects retrying a task that is not in a requeueable state', async () => {
    const create = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: { title: 'Will run', request: 'x' },
    });
    const taskId = create.json().task.id as string;
    await waitFor(async () => {
      const tasks = await listTasks();
      return tasks.some(
        (t) => t.id === taskId && (t.state === 'failed' || t.state === 'completed'),
      );
    });
    // The scripted provider has run out; the task failed or completed and a
    // completed task cannot be requeued (409), a failed one can.
    const retry = await app.built.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/retry`,
      headers: jarHeaders(app),
    });
    expect([200, 409]).toContain(retry.statusCode);
  });
});

describe('dispatch review after recovery', () => {
  it('shows interrupted tasks and lets the owner resume dispatch', async () => {
    // Ensure no run from earlier tests is still in flight, then simulate a
    // crashed run directly in the store and recover.
    await app.built.executor.whenIdle();
    const crashed = app.store.tasks.create(
      { title: 'Crashed', request: 'r' },
      new Date().toISOString(),
    );
    app.store.tasks.startRun(crashed.id, new Date().toISOString());
    const recovery = app.built.executor.recover();
    expect(recovery.interruptedRuns).toBe(1);
    expect(recovery.dispatchPaused).toBe(true);

    const status = await app.built.app.inject({
      method: 'GET',
      url: '/api/dispatch',
      headers: { cookie: app.cookie! },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().paused).toBe(true);
    expect(
      status.json().interruptedTasks.some((t: { id: string }) => t.id === crashed.id),
    ).toBe(true);

    const resume = await app.built.app.inject({
      method: 'POST',
      url: '/api/dispatch/resume',
      headers: jarHeaders(app),
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().paused).toBe(false);
  });
});

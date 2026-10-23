import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jarHeaders, login, setupOwner, startApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.close();
});

describe('owner auth', () => {
  it('reports an unonboarded state before setup', async () => {
    const res = await app.built.app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ authenticated: false, ownerCreated: false });
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const res = await app.built.app.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('creates the owner exactly once and starts a session', async () => {
    await setupOwner(app);
    const session = await app.built.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: app.cookie! },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ authenticated: true, ownerCreated: true });
    expect(session.json().onboardingCompletedAt).toBeTruthy();
  });

  it('refuses a second owner setup', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'owner', password: 'another-passphrase' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects wrong passwords without a session', async () => {
    app.cookie = null;
    app.csrfToken = null;
    expect(await login(app, 'wrong-password-1')).toBe(401);
    const tasks = await app.built.app.inject({ method: 'GET', url: '/api/tasks' });
    expect(tasks.statusCode).toBe(401);
  });

  it('logs in with the correct password', async () => {
    expect(await login(app)).toBe(200);
    const tasks = await app.built.app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: app.cookie! },
    });
    expect(tasks.statusCode).toBe(200);
  });

  it('logs out and invalidates the session', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: jarHeaders(app),
    });
    expect(res.statusCode).toBe(200);
    const tasks = await app.built.app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: app.cookie! },
    });
    expect(tasks.statusCode).toBe(401);
    app.cookie = null;
    app.csrfToken = null;
  });
});

describe('CSRF protection', () => {
  beforeAll(async () => {
    await login(app);
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: app.cookie! },
      payload: { title: 'T', request: 'r' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a mismatched CSRF token', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: app.cookie!, 'x-csrf-token': 'deadbeef' },
      payload: { title: 'T', request: 'r' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts the session-bound CSRF token', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: { title: 'T', request: 'r' },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe('origin validation', () => {
  it('rejects a foreign origin even with valid session and CSRF token', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        ...jarHeaders(app),
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      payload: { title: 'T', request: 'r' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Origin');
  });

  it('rejects a foreign origin on the SSE stream', async () => {
    const res = await app.built.app.inject({
      method: 'GET',
      url: '/api/events/stream',
      headers: { ...jarHeaders(app), origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows the configured web origin', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        ...jarHeaders(app),
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      payload: { title: 'T', request: 'r' },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe('input validation', () => {
  it('rejects malformed task bodies with 400', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: jarHeaders(app),
      payload: { title: '', request: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown tasks', async () => {
    const res = await app.built.app.inject({
      method: 'GET',
      url: '/api/tasks/does-not-exist',
      headers: { cookie: app.cookie! },
    });
    expect(res.statusCode).toBe(404);
  });
});

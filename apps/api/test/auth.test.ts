import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.close();
});

describe('loopback health and direct local access', () => {
  it('exposes GET /health without authentication', async () => {
    const res = await app.built.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('serves /api routes directly on loopback without local login', async () => {
    const res = await app.built.app.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tasks: [] });
  });

  it('does not expose removed /api/auth/* routes', async () => {
    const session = await app.built.app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(session.statusCode).toBe(404);
    const login = await app.built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'owner', password: 'password' },
    });
    expect(login.statusCode).toBe(404);
  });
});

describe('origin validation', () => {
  it('rejects a foreign origin on mutating requests', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
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
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows the configured web origin', async () => {
    const res = await app.built.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
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
      payload: { title: '', request: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown tasks', async () => {
    const res = await app.built.app.inject({
      method: 'GET',
      url: '/api/tasks/does-not-exist',
    });
    expect(res.statusCode).toBe(404);
  });
});

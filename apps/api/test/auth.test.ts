import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { jarHeaders, login, PASSWORD, setupOwner, startApp, type TestApp } from './helpers.js';

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


describe('concurrent owner setup', () => {
  it('returns one 201 and one 409 even for different usernames', async () => {
    const isolated = await startApp();
    try {
      const responses = await Promise.all(['first-owner', 'second-owner'].map((username) =>
        isolated.built.app.inject({
          method: 'POST',
          url: '/api/auth/setup',
          payload: { username, password: PASSWORD },
        })));
      expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);
      expect(isolated.store.users.count()).toBe(1);
    } finally {
      await isolated.close();
    }
  });
});

describe('login backoff (injected clock)', () => {
  const T0 = Date.parse('2026-10-23T12:00:00.000Z');
  let now: number;
  let isolated: TestApp;

  beforeEach(async () => {
    now = T0;
    isolated = await startApp({ now: () => new Date(now).toISOString() });
    await setupOwner(isolated);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await isolated.close();
  });

  function attempt(password = 'wrong-password', username = 'owner') {
    return isolated.built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
    });
  }

  async function fail(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      expect((await attempt()).statusCode).toBe(401);
    }
  }

  it('locks after five failures, even for a correct password, without issuing a session', async () => {
    await fail(5);
    const verify = vi.spyOn(isolated.store.users, 'verifyOwnerCredentials');
    const response = await attempt(PASSWORD);
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    expect(response.json()).toEqual({
      error: 'Too many failed login attempts. Please try again later.',
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });

  it('ceil-rounds Retry-After using ctx.now; blocked attempts do not extend the window', async () => {
    await fail(5);
    for (const [elapsed, seconds] of [[1, '30'], [1000, '29'], [29_999, '1']] as const) {
      now = T0 + elapsed;
      const response = await attempt();
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe(seconds);
    }
    now = T0 + 30_000;
    const response = await attempt(PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.json()).toMatchObject({ authenticated: true, csrfToken: expect.any(String) });
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('starts a new five-failure budget at expiry, not another immediate lockout', async () => {
    await fail(5);
    now += 30_000;
    await fail(5);
    expect((await attempt()).statusCode).toBe(429);
  });

  it('resets consecutive failures after successful authentication', async () => {
    await fail(4);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
    await fail(4);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
    await fail(5);
    expect((await attempt()).statusCode).toBe(429);
  });

  it('cannot bypass backoff by changing the username or client address', async () => {
    await fail(4);
    expect((await attempt(PASSWORD, 'unknown-owner')).statusCode).toBe(401);
    const response = await isolated.built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '127.0.0.2',
      payload: { username: 'owner', password: PASSWORD },
    });
    expect(response.statusCode).toBe(429);
  });

  it('serializes simultaneous attempts: only five verifications run before lockout', async () => {
    const verify = vi.spyOn(isolated.store.users, 'verifyOwnerCredentials');
    const responses = await Promise.all(Array.from({ length: 8 }, () => attempt()));
    expect(responses.map(({ statusCode }) => statusCode))
      .toEqual([401, 401, 401, 401, 401, 429, 429, 429]);
    expect(verify).toHaveBeenCalledTimes(5);
  });

  it('does not count malformed requests or requests rejected by the origin guard', async () => {
    await fail(4);
    const malformed = await isolated.built.app.inject({
      method: 'POST', url: '/api/auth/login', payload: { password: '' },
    });
    expect(malformed.statusCode).toBe(400);
    const foreign = await isolated.built.app.inject({
      method: 'POST', url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'owner', password: 'wrong-password' },
    });
    expect(foreign.statusCode).toBe(403);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
  });
});

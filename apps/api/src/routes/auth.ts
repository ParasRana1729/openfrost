import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../types.js';
import { SESSION_COOKIE, newCsrfToken } from '../app.js';

function csrfHeaderValid(token: unknown, expected: string): boolean {
  return typeof token === 'string' && token === expected;
}

const setupRequestSchema = z.strictObject({
  username: z.string().min(1).max(60).default('owner'),
  password: z.string().min(8).max(200),
});

const loginRequestSchema = z.strictObject({
  username: z.string().min(1).max(60).default('owner'),
  password: z.string().min(1).max(200),
});

function sessionExpiry(now: string, ttlMs: number): string {
  return new Date(Date.parse(now) + ttlMs).toISOString();
}

function createSessionCookie(reply: FastifyReply, ctx: AppContext, userId: string): {
  csrfToken: string;
} {
  const csrfToken = newCsrfToken();
  const nowIso = ctx.now();
  const session = ctx.store.sessions.create({
    userId,
    csrfToken,
    expiresAt: sessionExpiry(nowIso, ctx.config.sessionTtlMs),
    now: nowIso,
  });
  reply.setCookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });
  return { csrfToken };
}

/**
 * Public auth routes. Setup is first-run only; the onboarding disclosure the
 * owner must see before first use lives in the web app and is completed
 * together with owner creation.
 */
export const makeAuthRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  app.get('/health', async () => ({ ok: true }));

  app.get('/api/auth/session', async (request) => {
    const sid = request.cookies[SESSION_COOKIE];
    const session = sid ? ctx.store.sessions.get(sid) : null;
    const valid = session !== null && session.expiresAt > ctx.now();
    return {
      authenticated: valid,
      ownerCreated: ctx.store.users.count() > 0,
      onboardingCompletedAt: ctx.store.state.getValue('onboarding.completedAt'),
      csrfToken: valid && session ? session.csrfToken : undefined,
    };
  });

  app.post('/api/auth/setup', async (request, reply) => {
    if (ctx.store.users.count() > 0) {
      return reply.code(409).send({ error: 'The owner account already exists' });
    }
    const input = setupRequestSchema.parse(request.body);
    const owner = ctx.store.users.createOwner(input.username, input.password, ctx.now());
    ctx.store.state.setValue('onboarding.completedAt', ctx.now());
    ctx.store.events.append(
      'auth.owner_created',
      { payload: { username: owner.username } },
      ctx.now(),
    );
    const { csrfToken } = createSessionCookie(reply, ctx, owner.id);
    return reply.code(201).send({ authenticated: true, csrfToken });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = loginRequestSchema.parse(request.body);
    const owner = ctx.store.users.verifyOwnerCredentials(input.username, input.password);
    if (!owner) {
      ctx.store.events.append(
        'auth.login_failed',
        { payload: { username: input.username } },
        ctx.now(),
      );
      return reply.code(401).send({ error: 'Invalid username or password' });
    }
    const { csrfToken } = createSessionCookie(reply, ctx, owner.id);
    ctx.store.events.append('auth.logged_in', { payload: {} }, ctx.now());
    return { authenticated: true, csrfToken };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const sid = request.cookies[SESSION_COOKIE];
    const session = sid ? ctx.store.sessions.get(sid) : null;
    if (session && !csrfHeaderValid(request.headers['x-csrf-token'], session.csrfToken)) {
      return reply.code(403).send({ error: 'CSRF token missing or invalid' });
    }
    if (sid) {
      ctx.store.sessions.remove(sid);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    ctx.store.events.append('auth.logged_out', {}, ctx.now());
    return { authenticated: false };
  });
};

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../types.js';
import { SESSION_COOKIE, newCsrfToken, tokensMatch } from '../app.js';

function csrfHeaderValid(token: unknown, expected: string): boolean {
  return typeof token === 'string' && tokensMatch(token, expected);
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

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_BACKOFF_MS = 30_000;

/**
 * Public auth routes. Setup is first-run only; the onboarding disclosure the
 * owner must see before first use lives in the Control Center and is completed
 * together with owner creation.
 */
export const makeAuthRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  // One local owner: do not let username/IP changes bypass the backoff.
  let failedLogins = 0;
  let blockedUntil = 0;
  let loginQueue: Promise<void> = Promise.resolve();

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
    const owner = await ctx.store.users.createOwner(input.username, input.password, ctx.now());
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
    // Serialize verification so simultaneous requests cannot all pass the
    // backoff check before async scrypt records the fifth failure.
    const attempt = loginQueue.then(async () => {
      const now = Date.parse(ctx.now());
      if (blockedUntil > now) {
        return reply.code(429)
          .header('Retry-After', Math.ceil((blockedUntil - now) / 1000))
          .send({ error: 'Too many failed login attempts. Please try again later.' });
      }
      if (blockedUntil !== 0) {
        failedLogins = 0;
        blockedUntil = 0;
      }
      const owner = await ctx.store.users.verifyOwnerCredentials(input.username, input.password);
      if (!owner) {
        failedLogins++;
        if (failedLogins >= LOGIN_FAILURE_LIMIT) {
          blockedUntil = Date.parse(ctx.now()) + LOGIN_BACKOFF_MS;
        }
        ctx.store.events.append(
          'auth.login_failed',
          { payload: { username: input.username } },
          ctx.now(),
        );
        return reply.code(401).send({ error: 'Invalid username or password' });
      }
      failedLogins = 0;
      blockedUntil = 0;
      const { csrfToken } = createSessionCookie(reply, ctx, owner.id);
      ctx.store.events.append('auth.logged_in', { payload: {} }, ctx.now());
      return { authenticated: true, csrfToken };
    });
    loginQueue = attempt.then(() => undefined, () => undefined);
    return attempt;
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

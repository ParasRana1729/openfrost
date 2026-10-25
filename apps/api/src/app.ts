import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import pino, { type Logger } from 'pino';
import {
  InvalidApprovalTransitionError,
  InvalidMemoryProposalTransitionError,
  InvalidTransitionError,
  MemoryFileEntryNotFoundError,
  MemoryFileFormatError,
  DEFAULT_EXECUTION_LIMITS,
} from '@openfrost/domain';
import {
  DpapiUnavailableError,
  ApprovalNotFoundError,
  ExportDestinationNotFoundError,
  MemoryDuplicateError,
  MemoryEntryNotFoundError,
  MemoryFileChangedError,
  MemoryFileUnreadableError,
  MemoryLimitError,
  MemoryProjectNotFoundError,
  MemoryProposalNotFoundError,
  MemorySecretError,
  OwnerExistsError,
  ProjectNotFoundError,
  TaskNotFoundError,
  createStore,
  openDatabase,
  type OpenDatabaseResult,
  type Store,
} from '@openfrost/db';
import { TaskExecutor, type LlmProvider } from '@openfrost/agent';
import type { ZodError, ZodIssue } from 'zod';
import { ActiveProvider } from './activeProvider.js';
import { EventBus } from './bus.js';
import type { AppContext, BuildAppOptions } from './types.js';
import { makeAuthRoutes } from './routes/auth.js';
import { makeSettingsRoutes } from './routes/settings.js';
import { makeTaskRoutes } from './routes/tasks.js';
import { makeProjectRoutes } from './routes/projects.js';
import { makeMemoryRoutes } from './routes/memory.js';
import { makeExportRoutes } from './routes/exports.js';
import { makeDispatchRoutes } from './routes/dispatch.js';
import { makeEventRoutes } from './routes/events.js';

export const SESSION_COOKIE = 'openfrost_session';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function newCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time comparison for secret values of equal length. */
export function tokensMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function buildLogger(): Logger {
  return pino({
    level: process.env.OPENFROST_LOG_LEVEL ?? 'info',
    // Never log request headers, cookies, or bodies: raw keys and other
    // sensitive material must not reach logs even by accident.
    serializers: {
      req(req) {
        return { method: req.method, url: req.url };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'headers.cookie'],
      censor: '[redacted]',
    },
  });
}

export type AppInstance = ReturnType<typeof Fastify>;

export interface BuiltApp {
  app: AppInstance;
  store: Store;
  executor: TaskExecutor;
  bus: EventBus;
  ownsDatabase: boolean;
  opened?: OpenDatabaseResult;
}

/** Structural check: the workspace may load zod through more than one
 * module instance (bundlers/aliases), so `instanceof` is not reliable. */
function isZodError(err: unknown): err is ZodError & { issues: ZodIssue[] } {
  return (
    err instanceof Error &&
    err.name === 'ZodError' &&
    Array.isArray((err as ZodError).issues)
  );
}

export async function buildApp(options: BuildAppOptions, logger?: Logger | false): Promise<BuiltApp> {
  const { config } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const bus = options.bus ?? new EventBus();
  const log = logger === undefined ? buildLogger() : logger;

  let opened: OpenDatabaseResult | undefined;
  let store: Store;
  if (options.store) {
    store = options.store;
  } else {
    opened = openDatabase(config.homeDir);
    store = createStore(opened.db, {
      home: opened.home,
      onEvent: (event) => bus.publish(event),
    });
  }

  // The executor talks to ActiveProvider, which resolves the owner's active
  // provider (OpenAI, Gemini, or OpenRouter) per run from Settings; the OPENFROST_PROVIDER
  // =fake dev hook overrides routing entirely. Tests may inject a provider.
  const builtProvider: LlmProvider =
    options.provider !== undefined
      ? options.provider
      : new ActiveProvider({ config, store });

  const executor = new TaskExecutor({
    store,
    provider: builtProvider,
    limits: options.limits ?? DEFAULT_EXECUTION_LIMITS,
    now,
  });

  const app = Fastify({
    loggerInstance: log === false ? undefined : (log as Logger),
    bodyLimit: 1024 * 1024,
  });

  // The error handler must be registered before any plugin scope so every
  // encapsulated route inherits it.
  app.setErrorHandler((err: unknown, _request, reply) => {
    if (isZodError(err)) {
      return reply.code(400).send({ error: 'Invalid request', issues: err.issues });
    }
    if (err instanceof TaskNotFoundError) {
      return reply.code(404).send({ error: err.message });
    }
    if (err instanceof ProjectNotFoundError) {
      return reply.code(404).send({ error: err.message });
    }
    if (err instanceof ApprovalNotFoundError || err instanceof ExportDestinationNotFoundError) {
      return reply.code(404).send({ error: err.message });
    }
    if (
      err instanceof MemoryProposalNotFoundError ||
      err instanceof MemoryEntryNotFoundError ||
      err instanceof MemoryFileEntryNotFoundError ||
      err instanceof MemoryProjectNotFoundError
    ) {
      return reply.code(404).send({ error: err.message });
    }
    if (err instanceof MemoryFileChangedError) {
      return reply.code(409).send({
        error: err.message,
        currentSha256: err.currentSha256,
      });
    }
    if (err instanceof MemorySecretError || err instanceof MemoryLimitError) {
      return reply.code(400).send({ error: err.message });
    }
    if (
      err instanceof MemoryDuplicateError ||
      err instanceof MemoryFileUnreadableError ||
      err instanceof MemoryFileFormatError ||
      err instanceof InvalidMemoryProposalTransitionError
    ) {
      return reply.code(409).send({ error: err.message });
    }
    if (err instanceof InvalidApprovalTransitionError) {
      return reply.code(409).send({ error: err.message });
    }
    if (err instanceof InvalidTransitionError) {
      return reply.code(409).send({ error: err.message });
    }
    if (err instanceof DpapiUnavailableError) {
      return reply.code(503).send({ error: err.message });
    }
    if (err instanceof OwnerExistsError) {
      return reply.code(409).send({ error: err.message });
    }
    const httpError = err as { statusCode?: number; message?: string };
    const status = httpError.statusCode ?? 500;
    if (status >= 500) {
      reply.log.error({ err }, 'unhandled error');
    }
    const message = status >= 500 ? 'Internal error' : (httpError.message ?? 'Request failed');
    return reply.code(status).send({ error: message });
  });

  // Origin guard runs before CORS so disallowed origins never proceed,
  // regardless of method. Requests without an Origin header (local tools,
  // health checks) pass; the session/CSRF guards still apply to /api.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || config.webOrigins.includes(origin)) {
      return;
    }
    return reply.code(403).send({ error: 'Origin not allowed' });
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, callback) => {
      // Non-browser clients send no Origin; serve them without CORS headers.
      // The onRequest origin guard enforces allowlisting whenever an Origin
      // header is actually present.
      if (typeof origin !== 'string' || origin.length === 0) {
        callback(null, false);
        return;
      }
      if (config.webOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed'), false);
    },
    credentials: true,
  });

  const ctx: AppContext = { store, executor, bus, config, now };

  await app.register(makeAuthRoutes(ctx));
  await app.register(
    async (protectedScope) => {
      // Everything under /api (other than auth/setup, auth/login, and
      // auth/session) requires an owner session; state-changing requests
      // additionally require the session-bound CSRF token.
      protectedScope.addHook('preHandler', async (request, reply) => {
        const sid = request.cookies[SESSION_COOKIE];
        const session = sid ? store.sessions.get(sid) : null;
        const nowIso = now();
        if (!session || session.expiresAt <= nowIso) {
          if (sid) {
            store.sessions.remove(sid);
          }
          return reply.code(401).send({ error: 'Authentication required' });
        }
        store.sessions.touch(session.id, nowIso);
        request.ownerSession = session;
        if (MUTATING_METHODS.has(request.method)) {
          const token = request.headers['x-csrf-token'];
          if (typeof token !== 'string' || !tokensMatch(token, session.csrfToken)) {
            return reply.code(403).send({ error: 'CSRF token missing or invalid' });
          }
        }
      });
      await protectedScope.register(makeTaskRoutes(ctx));
      await protectedScope.register(makeProjectRoutes(ctx));
      await protectedScope.register(makeMemoryRoutes(ctx));
      await protectedScope.register(makeExportRoutes(ctx));
      await protectedScope.register(
        makeSettingsRoutes(
          ctx,
          builtProvider instanceof ActiveProvider ? builtProvider : undefined,
        ),
      );
      await protectedScope.register(makeDispatchRoutes(ctx));
      await protectedScope.register(makeEventRoutes(ctx));
    },
    { prefix: '/api' },
  );

  return { app, store, executor, bus, ownsDatabase: opened !== undefined, opened };
}

export async function closeBuiltApp(built: BuiltApp): Promise<void> {
  await built.executor.stop();
  await built.app.close();
  if (built.ownsDatabase && built.opened) {
    built.opened.sqlite.close();
  }
}

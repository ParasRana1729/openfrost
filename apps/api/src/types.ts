import type { Store, Session } from '@openfrost/db';
import type { TaskExecutor, LlmProvider } from '@openfrost/agent';
import type { ExecutionLimits } from '@openfrost/domain';
import type { EventBus } from './bus.js';
import type { ApiConfig } from './config.js';

export interface AppContext {
  store: Store;
  executor: TaskExecutor;
  bus: EventBus;
  config: ApiConfig;
  now(): string;
}

export interface BuildAppOptions {
  config: ApiConfig;
  provider?: LlmProvider | null;
  limits?: ExecutionLimits;
  now?: () => string;
  /** Tests may inject a pre-seeded store; the caller then owns its lifetime. */
  store?: Store;
  bus?: EventBus;
}

declare module 'fastify' {
  interface FastifyRequest {
    ownerSession: Session;
  }
}

export type { Session };

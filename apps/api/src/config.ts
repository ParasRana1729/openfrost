import { resolveHome } from '@openfrost/db';

export interface ApiConfig {
  /** Always loopback (spec §6): the API is not reachable off-machine. */
  host: '127.0.0.1';
  port: number;
  homeDir: string;
  /** Browser origins allowed to call the API (the local web app). */
  webOrigins: string[];
  sessionTtlMs: number;
  /** 'fake' is a dev/test hook that scripts a research run without any API key. */
  provider: 'openai' | 'fake';
  openaiModel: string;
  geminiModel: string;
  openrouterModel: string;
  /** How often the routine scheduler examines due occurrences. */
  routineTickMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.OPENFROST_API_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid OPENFROST_API_PORT: ${String(env.OPENFROST_API_PORT)}`);
  }
  const webOrigins = (env.OPENFROST_WEB_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const provider = env.OPENFROST_PROVIDER === 'fake' ? 'fake' : 'openai';
  const routineTickMs = Number(env.OPENFROST_ROUTINE_TICK_MS ?? 30_000);
  if (!Number.isInteger(routineTickMs) || routineTickMs < 1_000) {
    throw new Error(
      `Invalid OPENFROST_ROUTINE_TICK_MS: ${String(env.OPENFROST_ROUTINE_TICK_MS)}`,
    );
  }
  return {
    host: '127.0.0.1',
    port,
    homeDir: env.OPENFROST_HOME ?? resolveHome(),
    webOrigins,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    provider,
    openaiModel: env.OPENFROST_OPENAI_MODEL ?? 'gpt-4.1-mini',
    geminiModel: env.OPENFROST_GEMINI_MODEL ?? 'gemini-3.8-flash',
    openrouterModel: env.OPENFROST_OPENROUTER_MODEL ?? 'openrouter/auto',
    routineTickMs,
  };
}

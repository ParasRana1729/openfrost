import { resolveHome } from '@openfrost/db';

export interface ApiConfig {
  /** Always loopback (spec §6): the API is not reachable off-machine. */
  host: '127.0.0.1';
  port: number;
  homeDir: string;
  /** Browser origins allowed to call the API (the local web app). */
  webOrigins: string[];
  /** 'fake' is a dev/test hook that scripts a research run without any API key. */
  provider: 'openai' | 'fake';
  openaiModel: string;
  geminiModel: string;
  openrouterModel: string;
  openrouterMaxTokens: number;
  tokenfactoryModel: string;
  tokenfactoryMaxTokens: number;
  /** How often the routine scheduler examines due occurrences. */
  routineTickMs: number;
}

function parseMaxTokens(
  env: NodeJS.ProcessEnv,
  varName: string,
  fallback: number,
): number {
  const raw = env[varName];
  const parsed =
    raw !== undefined && raw.trim().length > 0 ? Number(raw) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${varName}: ${String(raw)}`);
  }
  return Math.min(parsed, 1_000_000);
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
    provider,
    openaiModel: env.OPENFROST_OPENAI_MODEL ?? 'gpt-4.1-mini',
    geminiModel: env.OPENFROST_GEMINI_MODEL ?? 'gemini-3.8-flash',
    openrouterModel: env.OPENFROST_OPENROUTER_MODEL ?? 'openrouter/free',
    openrouterMaxTokens: parseMaxTokens(env, 'OPENFROST_OPENROUTER_MAX_TOKENS', 8192),
    tokenfactoryModel: env.OPENFROST_TOKENFACTORY_MODEL ?? 'Qwen3.8-27B',
    tokenfactoryMaxTokens: parseMaxTokens(env, 'OPENFROST_TOKENFACTORY_MAX_TOKENS', 8192),
    routineTickMs,
  };
}

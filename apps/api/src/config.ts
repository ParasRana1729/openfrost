import { resolveHome } from '@openfrost/db';

export interface ApiConfig {
  /** Always loopback (spec §6): the API is not reachable off-machine. */
  host: '127.0.0.1';
  port: number;
  homeDir: string;
  /** Browser origins allowed to call the API (the local web app). */
  webOrigins: string[];
  sessionTtlMs: number;
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
  return {
    host: '127.0.0.1',
    port,
    homeDir: env.OPENFROST_HOME ?? resolveHome(),
    webOrigins,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  };
}

import { loadEnv, daemonEnvSchema, type DaemonEnv } from "@openfrost/domain";

let cachedEnv: DaemonEnv | undefined;

export function getDaemonEnv(env: NodeJS.ProcessEnv = process.env): DaemonEnv {
  cachedEnv ??= loadEnv(daemonEnvSchema, env);
  return cachedEnv;
}

export function resetDaemonEnvForTests(): void {
  cachedEnv = undefined;
}

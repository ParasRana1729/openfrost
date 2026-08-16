import { apiEnvSchema, loadEnv, type ApiEnv } from "@openfrost/domain";

let cachedEnv: ApiEnv | undefined;

export function getApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  cachedEnv ??= loadEnv(apiEnvSchema, env);
  return cachedEnv;
}

export function resetApiEnvForTests(): void {
  cachedEnv = undefined;
}

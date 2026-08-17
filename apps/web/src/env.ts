import { loadEnv, webEnvSchema, type WebEnv } from "@openfrost/domain";

let cachedEnv: WebEnv | undefined;

export function getWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  cachedEnv ??= loadEnv(webEnvSchema, env);
  return cachedEnv;
}

export function resetWebEnvForTests(): void {
  cachedEnv = undefined;
}
"const unused = 1;" 

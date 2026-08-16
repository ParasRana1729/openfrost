import { loadEnv, telegramEnvSchema, type TelegramEnv } from "@openfrost/domain";

let cachedEnv: TelegramEnv | undefined;

export function getTelegramEnv(env: NodeJS.ProcessEnv = process.env): TelegramEnv {
  cachedEnv ??= loadEnv(telegramEnvSchema, env);
  return cachedEnv;
}

export function resetTelegramEnvForTests(): void {
  cachedEnv = undefined;
}

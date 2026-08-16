import { z } from "zod";

export const nodeEnvSchema = z.enum(["development", "test", "production"]);

export const baseEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default("development"),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export const apiEnvSchema = baseEnvSchema.extend({
  OPENFROST_API_HOST: z.string().min(1).default("127.0.0.1"),
  OPENFROST_API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const webEnvSchema = baseEnvSchema.extend({
  OPENFROST_WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OPENFROST_API_URL: z.string().url().default("http://127.0.0.1:3001"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const telegramEnvSchema = baseEnvSchema.extend({
  OPENFROST_TELEGRAM_TOKEN: z.string().min(1).optional(),
  OPENFROST_API_URL: z.string().url().default("http://127.0.0.1:3001"),
});

export type TelegramEnv = z.infer<typeof telegramEnvSchema>;

export const daemonEnvSchema = baseEnvSchema.extend({
  OPENFROST_DAEMON_POLL_MS: z.coerce.number().int().min(100).default(5000),
  OPENFROST_API_URL: z.string().url().default("http://127.0.0.1:3001"),
});

export type DaemonEnv = z.infer<typeof daemonEnvSchema>;

export type EnvValidationIssue = {
  path: string;
  message: string;
};

export type EnvValidationResult<T> =
  { success: true; data: T } | { success: false; issues: EnvValidationIssue[] };

export function formatEnvIssues(issues: EnvValidationIssue[]): string {
  return issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n");
}

export function validateEnv<Output>(
  schema: z.ZodType<Output, z.ZodTypeDef, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): EnvValidationResult<Output> {
  const result = schema.safeParse(env);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join(".") : "environment",
      message: issue.message,
    })),
  };
}

export function loadEnv<Output>(
  schema: z.ZodType<Output, z.ZodTypeDef, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Output {
  const result = validateEnv(schema, env);

  if (!result.success) {
    throw new Error(
      `Invalid OpenFrost environment configuration:\n${formatEnvIssues(result.issues)}`,
    );
  }

  return result.data;
}

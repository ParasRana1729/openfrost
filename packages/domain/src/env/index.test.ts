import { describe, expect, it } from "vitest";
import {
  apiEnvSchema,
  daemonEnvSchema,
  loadEnv,
  telegramEnvSchema,
  validateEnv,
  webEnvSchema,
} from "./index.js";

describe("@openfrost/domain env validation", () => {
  it("loads valid API env with defaults", () => {
    const env = loadEnv(apiEnvSchema, {
      NODE_ENV: "test",
    });

    expect(env.OPENFROST_API_HOST).toBe("127.0.0.1");
    expect(env.OPENFROST_API_PORT).toBe(3001);
  });

  it("fails fast with a clear message for invalid port number", () => {
    const result = validateEnv(apiEnvSchema, {
      OPENFROST_API_PORT: "not-a-number",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.path).toBe("OPENFROST_API_PORT");
      expect(() => loadEnv(apiEnvSchema, { OPENFROST_API_PORT: "not-a-number" })).toThrow(
        /Invalid OpenFrost environment configuration:\n  - OPENFROST_API_PORT:/,
      );
    }
  });

  it("fails fast with a clear message for invalid URL format", () => {
    expect(() => loadEnv(webEnvSchema, { OPENFROST_API_URL: "not-a-valid-url" })).toThrow(
      /Invalid OpenFrost environment configuration:\n  - OPENFROST_API_URL: Invalid url/,
    );
  });

  it("fails fast with a clear message for invalid NODE_ENV enum", () => {
    expect(() => loadEnv(apiEnvSchema, { NODE_ENV: "invalid-environment" })).toThrow(
      /Invalid OpenFrost environment configuration:\n  - NODE_ENV:/,
    );
  });
});

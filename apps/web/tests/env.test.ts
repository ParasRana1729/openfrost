import { describe, expect, it } from "vitest";
import { getWebEnv, resetWebEnvForTests } from "../src/env.js";

describe("@openfrost/web env loading", () => {
  it("loads validated web env defaults", () => {
    resetWebEnvForTests();
    process.env.NODE_ENV = "test";

    const env = getWebEnv();
    expect(env.OPENFROST_WEB_PORT).toBe(3000);
    expect(env.OPENFROST_API_URL).toBe("http://127.0.0.1:3001");
  });

  it("fails fast with clear error message when OPENFROST_API_URL is invalid", () => {
    resetWebEnvForTests();
    expect(() =>
      getWebEnv({
        ...process.env,
        OPENFROST_API_URL: "not_a_valid_url",
      }),
    ).toThrow(/Invalid OpenFrost environment configuration:\n  - OPENFROST_API_URL: Invalid url/);
  });
});

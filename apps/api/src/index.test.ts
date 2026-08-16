import { describe, expect, it } from "vitest";
import { createApiServer } from "./index.js";
import { getApiEnv, resetApiEnvForTests } from "./env.js";

describe("@openfrost/api", () => {
  it("creates a health endpoint after env validation", async () => {
    resetApiEnvForTests();
    process.env.NODE_ENV = "test";

    const env = getApiEnv();
    const { app } = createApiServer();
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: "api", status: "ok" });
    expect(env.OPENFROST_API_PORT).toBe(3001);

    await app.close();
  });
});

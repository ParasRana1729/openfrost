import { describe, expect, it } from "vitest";
import { createHealthCheck, healthCheckSchema, packageVersionSchema } from "./index.js";

describe("@openfrost/domain schemas", () => {
  it("parses package version metadata", () => {
    const parsed = packageVersionSchema.parse({
      name: "@openfrost/domain",
      version: "0.0.0",
    });

    expect(parsed.name).toBe("@openfrost/domain");
  });

  it("creates a valid health check payload", () => {
    const health = createHealthCheck("api", "ok");
    expect(healthCheckSchema.parse(health).status).toBe("ok");
  });
});

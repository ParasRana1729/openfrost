import { describe, expect, it } from "vitest";
import { createDaemonTick } from "./index.js";
import { getDaemonEnv, resetDaemonEnvForTests } from "./env.js";

describe("@openfrost/daemon", () => {
  it("creates daemon ticks using validated env defaults", () => {
    resetDaemonEnvForTests();
    process.env.NODE_ENV = "test";

    const tick = createDaemonTick(new Date("2026-01-01T00:00:00.000Z"));
    expect(tick.at).toBe("2026-01-01T00:00:00.000Z");
    expect(getDaemonEnv().OPENFROST_DAEMON_POLL_MS).toBe(5000);
  });
});

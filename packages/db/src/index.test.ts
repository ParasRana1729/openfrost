import { describe, expect, it } from "vitest";
import { getDatabaseHealthCheck, getDatabaseStatus } from "./index.js";

describe("@openfrost/db", () => {
  it("returns scaffold database status", () => {
    const status = getDatabaseStatus();
    expect(status.ready).toBe(false);
    expect(getDatabaseHealthCheck().service).toBe("db");
  });
});

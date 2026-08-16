import { describe, expect, it } from "vitest";
import { getAgentRuntimeStatus } from "./index.js";

describe("@openfrost/agent", () => {
  it("reports scaffold runtime status", () => {
    expect(getAgentRuntimeStatus().ready).toBe(false);
  });
});

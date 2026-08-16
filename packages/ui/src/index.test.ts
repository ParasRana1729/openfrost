import { describe, expect, it } from "vitest";
import { formatStatusLabel, getStatusBadgeClassName } from "./index.js";

describe("@openfrost/ui", () => {
  it("formats status labels and badge classes", () => {
    expect(formatStatusLabel("  Ready  ")).toBe("Ready");
    expect(getStatusBadgeClassName("success")).toContain("success");
  });
});

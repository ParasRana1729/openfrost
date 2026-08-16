import { describe, expect, it } from "vitest";
import { createCliProgram } from "./index.js";

describe("@openfrost/cli", () => {
  it("creates the openfrost CLI program", () => {
    const program = createCliProgram();
    expect(program.name()).toBe("openfrost");
    expect(program.commands.some((command) => command.name() === "status")).toBe(true);
  });
});

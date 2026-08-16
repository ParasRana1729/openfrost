import { describe, expect, it } from "vitest";
import { createTelegramBot } from "./index.js";
import { resetTelegramEnvForTests } from "./env.js";

describe("@openfrost/telegram", () => {
  it("starts in scaffold mode without a token", () => {
    resetTelegramEnvForTests();
    process.env.NODE_ENV = "test";

    const runtime = createTelegramBot();
    expect(runtime.mode).toBe("scaffold");
    expect(runtime.bot).toBeNull();
    expect(runtime.env.OPENFROST_API_URL).toBe("http://127.0.0.1:3001");
  });
});

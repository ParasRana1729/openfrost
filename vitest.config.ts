import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/api", "apps/telegram", "apps/daemon", "apps/web"],
  },
});

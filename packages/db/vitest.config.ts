import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Test against package sources so tests run without a prior build.
      '@openfrost/domain': fileURLToPath(
        new URL('../domain/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // DPAPI round-trips spawn real PowerShell subprocesses, which can take
    // several seconds on CI runners; Vitest's 5s default made main's push
    // runs flake while PR runs passed. Match apps/api's generous budget.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

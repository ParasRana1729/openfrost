import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@openfrost/domain': fileURLToPath(
        new URL('../../packages/domain/src/index.ts', import.meta.url),
      ),
      '@openfrost/db': fileURLToPath(new URL('../../packages/db/src/index.ts', import.meta.url)),
      '@openfrost/agent': fileURLToPath(
        new URL('../../packages/agent/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Real sockets + DPAPI subprocesses need a little more room.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@openfrost/domain': fileURLToPath(
        new URL('../domain/src/index.ts', import.meta.url),
      ),
      '@openfrost/db': fileURLToPath(new URL('../db/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

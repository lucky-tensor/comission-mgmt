import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/db/tests/migration.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'packages/db/tests/migration.test.ts',
      'packages/db/tests/encryption-integration.test.ts',
      'packages/db/tests/demo-seed.test.ts',
    ],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

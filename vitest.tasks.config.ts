/**
 * Vitest configuration for task queue integration tests.
 *
 * Covers:
 *   - Worker write-path and E2E worker loop tests (apps/server/tests/integration/tasks/)
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 */
import { defineConfig } from 'vitest/config';
import { vitestAliases } from './vitest.aliases';

export default defineConfig({
  resolve: {
    alias: vitestAliases(__dirname),
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['apps/server/tests/integration/tasks/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

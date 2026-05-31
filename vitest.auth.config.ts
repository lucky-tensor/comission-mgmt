/**
 * Vitest configuration for auth integration tests.
 *
 * Auth tests require an ephemeral Postgres container (Docker) and use
 * workspace package aliases for db/* and core/* imports.
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
    include: [
      'apps/server/tests/integration/auth/**/*.test.ts',
      'apps/server/tests/integration/demo-session/**/*.test.ts',
    ],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

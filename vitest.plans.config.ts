/**
 * Vitest configuration for commission plan API integration tests.
 *
 * Covers:
 *   - POST /plans — create a plan with initial Draft version
 *   - POST /plans/:id/versions — create a new plan version
 *   - POST /plans/:id/versions/:vid/activate — activate a draft version
 *   - GET  /plans/:id/versions — list versions in descending order
 *   - GET  /plans/:id/active — get the active version
 *   - POST /plans/:id/assignments — assign a producer to a plan version
 *   - GET  /plans/:id/assignments — list producer assignments
 *   - Tier threshold validation (422 for overlapping thresholds)
 *   - Multi-tenant isolation
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: commission plan configuration and versioning (#9)
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
    include: ['tests/api/plans/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

/**
 * Vitest configuration for contributor assignment API integration tests.
 *
 * Covers:
 *   - POST /placements/:id/contributors — assign a contributor
 *   - GET  /placements/:id/contributors — list contributors
 *   - DELETE /placements/:id/contributors/:cid — remove contributor
 *   - Split percentage validation on finalization
 *   - Audit log entries for contributor assignments
 *   - All 8 PRD contributor roles accepted; unknown role rejected
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: contribution assignment — contributor roles and split credit (#7)
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
    include: ['tests/api/contributors/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

/**
 * Vitest configuration for clawback and holdback event handling integration tests.
 *
 * Covers:
 *   - POST /placements/:id/guarantee/trigger — clawback trigger integration test
 *   - Recovery schedule arithmetic unit test
 *   - Out-of-window 422 test
 *   - AuditLogEntry count test
 *   - GET /me/clawback-exposure — producer exposure integration test
 *   - Holdback rule: adjustments without recovery schedule
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: clawback and holdback event handling (#20)
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
    include: ['tests/api/clawback/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

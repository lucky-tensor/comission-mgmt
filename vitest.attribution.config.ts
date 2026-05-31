/**
 * Vitest configuration for attribution API integration tests.
 *
 * Covers:
 *   - POST /placements/:id/attribution/submit — submit for manager approval
 *   - POST /placements/:id/attribution/approve — Manager approves
 *   - POST /placements/:id/attribution/reject — Manager rejects with reason
 *   - GET  /placements/:id/attribution/timeline — ordered event history
 *   - State machine: invalid transitions return 422
 *   - RBAC: non-Manager roles receive 403 on approve/reject
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: manager split approval workflow and attribution timeline (#8)
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
    include: ['tests/api/attribution/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

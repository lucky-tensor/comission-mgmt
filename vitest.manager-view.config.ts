/**
 * Vitest configuration for Manager Team View integration tests (issue #21).
 *
 * Covers:
 *   - GET /me/team/placements — placements where manager is a ManagerOverride contributor
 *   - GET /me/team/commission-summary — aggregated accruals/payables/holds by producer
 *   - GET /me/team/pending-approvals — attribution requests awaiting approval
 *   - GET /me/team/disputes — open disputes for the manager's team placements
 *   - RBAC: non-Manager roles receive 403 on all routes
 *   - Isolation: manager token cannot access another manager's team data
 *
 * Requires an ephemeral Postgres container (Docker).
 *
 * Issue: feat: manager team commission view (#21)
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
    include: ['tests/api/manager-view/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

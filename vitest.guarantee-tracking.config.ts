/**
 * Vitest configuration for guarantee period tracking and monitoring integration tests.
 *
 * Covers:
 *   - computeGuaranteeExpiryDate unit tests (date arithmetic)
 *   - POST /placements — guarantee_expiry_date stored correctly
 *   - GET /placements?guarantee=active — filter integration test with fixture dates
 *   - processGuaranteeExpiredRecalc — expiry simulation test using a past expiry date
 *   - AuditLogEntry on clean expiry
 *   - GET /placements/:id/guarantee — detail integration test
 *   - listActiveExpiredGuaranteePeriods — cron scan integration test
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: guarantee period tracking and monitoring (#19)
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
    include: ['tests/api/guarantee-tracking/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

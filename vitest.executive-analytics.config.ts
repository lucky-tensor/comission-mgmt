/**
 * Vitest configuration for executive analytics integration tests.
 *
 * Covers:
 *   - GET /analytics/executive — schema snapshot (all required metrics present)
 *   - gross_fees_booked arithmetic (sum of encrypted Placement.fee_amount)
 *   - clawback_exposure arithmetic (sum of unrecovered negative adjustments)
 *   - exception_rate calculation (approved exceptions / total placements)
 *   - RBAC enforcement (Producer/Manager → 403; Executive/FinanceAdmin → 200)
 *   - Period filtering (placements outside period excluded)
 *   - Multi-tenant isolation
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: executive margin and commission liability dashboard (#22)
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
    include: ['tests/api/analytics/executive/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

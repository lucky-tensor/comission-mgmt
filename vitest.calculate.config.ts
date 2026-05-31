/**
 * Vitest configuration for commission calculation API integration tests.
 *
 * Covers:
 *   - POST /placements/:id/calculate — trigger commission calculation
 *   - GET  /placements/:id/commission-records — list commission records
 *   - GET  /commission-records/:id — fetch single record with explanation
 *   - Collection gate (status=Held when invoice unpaid)
 *   - Guarantee holdback (status=Held when inside guarantee window)
 *   - Draw balance offset (net_payable reduced, gross_commission unchanged)
 *   - Error cases: 404, 409, 422
 *   - Multi-tenant isolation
 *   - Explainability: explanation field present, hold reason, guarantee expiry
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: commission calculation engine (#10)
 * Issue: feat: plain-language commission calculation explainability (#11)
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
    include: ['tests/api/calculate/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

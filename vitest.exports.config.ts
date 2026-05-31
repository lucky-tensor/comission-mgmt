/**
 * Vitest configuration for payroll-ready export from approved commission run integration tests.
 *
 * Covers:
 *   - POST /commission-runs/:id/export — generate payroll CSV artifact (AC#1)
 *   - POST /commission-runs/:id/export on non-Approved run returns 422 (AC#2)
 *   - CSV row count equals unique producers in the run (AC#3)
 *   - Net payroll arithmetic: net = gross - draw - clawback (AC#4)
 *   - Idempotency: POST twice returns same artifact_id (AC#5)
 *   - GET /commission-runs/:id/exports — list prior exports
 *   - Multi-tenant isolation
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: payroll-ready export from approved commission run (#15)
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
    include: ['tests/api/exports/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

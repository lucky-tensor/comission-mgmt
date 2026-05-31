/**
 * Vitest configuration for financial reconciliation report integration tests.
 *
 * Covers:
 *   - GET /reconciliation — generate report with fixture data, all discrepancy types
 *   - GET /reconciliation — ledger-only discrepancy fixture test
 *   - POST /reconciliation/:id/acknowledge — acknowledgement integration test
 *   - POST /commission-runs/:id/finalize — finalization gate with unacknowledged discrepancies
 *   - POST /commission-runs/:id/finalize — succeeds when acknowledged or override supplied
 *   - AuditLogEntry for acknowledgement and finalization override
 *   - RBAC: Producer and Manager return 403
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Canonical docs: docs/prd.md §5.8
 * Issue: feat: financial reconciliation report (#65)
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
    include: ['tests/api/reconciliation/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

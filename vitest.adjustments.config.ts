/**
 * Vitest configuration for refund and credit-memo adjustment ledger entry integration tests.
 *
 * Covers:
 *   - POST /placements/:id/adjustments — post refund, post credit-memo
 *   - Append-only invariant (prior rows are byte-identical after new post)
 *   - Reason-required negative test (400)
 *   - Role 403 isolation test (non-Finance-Admin)
 *   - GET /placements/:id/adjustments — combined read ordering (refunds, credit-memos,
 *     clawback/holdback entries in one ordered history)
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: refund and credit-memo adjustment ledger entries (append-only) (#122)
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
    include: ['tests/api/adjustments/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

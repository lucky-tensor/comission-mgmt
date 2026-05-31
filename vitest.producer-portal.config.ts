/**
 * Vitest configuration for Producer payout portal integration tests.
 *
 * Covers:
 *   - GET /me/commission-records — own records, explanation field, status filter
 *   - GET /me/commission-records?status=Held — held records filter
 *   - GET /me/payouts — historical approved payouts from Approved runs
 *   - Producer isolation: two producers see only their own records
 *   - End-to-end: placement → calculate → /me/commission-records
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: producer payout statement and deal visibility (#16)
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
    include: ['tests/api/producer-portal/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

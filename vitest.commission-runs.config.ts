/**
 * Vitest configuration for Finance Admin commission run and review queue integration tests.
 *
 * Covers:
 *   - POST /commission-runs — open run with pre-flight completeness check
 *   - GET /commission-runs/:id/queue — review queue: ready, held, exception-pending records
 *   - POST /commission-runs/:id/records/:rid/approve — individually approve a record
 *   - POST /commission-runs/:id/approve — approve entire run (requires all approved)
 *   - PATCH /commission-records/:id — returns 409 when record is in an Approved run
 *   - End-to-end: placement → calculate → open run → review queue → approve all → approve run
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: finance admin commission run and review queue (#13)
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
    include: ['tests/api/commission-runs/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

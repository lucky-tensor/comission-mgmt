/**
 * Vitest configuration for the placements API integration suites.
 *
 * Covers the two Postgres-backed suites under
 * `apps/server/tests/integration/placements/`:
 *   - placements.test.ts  — POST/GET /placements, CSV import, tenant isolation
 *   - completeness.test.ts — placement completeness/validation contract
 *
 * These require an ephemeral Postgres container (Docker) and resolve db/* and
 * core/* workspace imports via the shared `vitestAliases()` helper.
 *
 * Before this config existed these two suites were orphaned from CI: the only
 * config whose include glob matched them (apps/server/vitest.integration.config.ts)
 * lives outside the repo root, so the suite-coverage self-check — which scans
 * root-level vitest.*.config.ts — never saw them, and no workflow ran them, so
 * they could not gate a merge (#272).
 *
 * Run: `bun --bun vitest run --config vitest.placements-integration.config.ts`
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
    include: ['apps/server/tests/integration/placements/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

/**
 * Vitest configuration for the shared core package's pure-logic unit tests.
 *
 * Covers the 12 framework-independent suites under `packages/core/tests/`:
 * calculation-engine, commission-calculation-engine, commission-run,
 * clawback-ledger, encryption, kms, explanation-engine, guarantee-state,
 * placement-state, contributor-role, logger-stdout, and the demo-placement-seam
 * contract. These are plain functions over in-memory data — no DOM, no Postgres,
 * no server — so they run fast in node and gate the core domain logic that every
 * surface depends on.
 *
 * Before this config existed these suites were orphaned from CI: no
 * `vitest.*.config.ts` include glob covered `packages/core/tests/` and no
 * workflow ran the root `test:unit` script, so they could never turn a build
 * red (issue #268).
 *
 * Run: `bun --bun vitest run --config vitest.core.config.ts`
 * Issue: fix: stale demo-placement-seam test + orphaned packages/core/tests (#268)
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
    include: ['packages/core/tests/**/*.test.ts'],
  },
});

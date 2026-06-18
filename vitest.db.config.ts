/**
 * Vitest configuration for the Postgres-backed packages/db suites.
 *
 * Covers the db suites that stand up an ephemeral Postgres container (Docker)
 * via pg-container and run real schema migrations:
 *   - arbitration-results       (#186 — dormant arbitration result schema seam)
 *   - arbitration-simulation    (#188 — task-queue agent views + Claude API seam)
 *   - simulation-run            (#262 — simulation_run persistence + TTL reaper)
 *   - task-queue                (claim-execute-submit cycle)
 *   - task-queue-advanced       (#35 — concurrency, lease reclaim, RBAC isolation)
 *   - worker-tokens             (scoped commission token issue/consume/invalidate)
 *
 * The pure-unit db suites (encryption, claude-cli-engine) run separately under
 * vitest.db-unit.config.ts, and the migration/encryption-integration/demo-seed
 * suites under vitest.migration.config.ts — so this config deliberately lists
 * its files explicitly rather than globbing packages/db/tests/**.
 *
 * Before this config existed these six suites were orphaned from CI: no
 * workflow-referenced config matched them and the root `test:db` script was run
 * by no workflow, so they could never gate a merge (#272).
 *
 * Run: `bun --bun vitest run --config vitest.db.config.ts`
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
    include: [
      'packages/db/tests/arbitration-results.test.ts',
      'packages/db/tests/arbitration-simulation.test.ts',
      'packages/db/tests/simulation-run.test.ts',
      'packages/db/tests/task-queue.test.ts',
      'packages/db/tests/task-queue-advanced.test.ts',
      'packages/db/tests/worker-tokens.test.ts',
    ],
    // Run the six suites serially, one Postgres container at a time. Each suite
    // stands up its own pg-container and registers it in a single shared cleanup
    // sentinel at the repo root; if the suites ran in parallel forks, each
    // fork's startup `cleanupStaleContainers()` would read that shared sentinel
    // and `docker stop` a sibling fork's freshly-registered container, producing
    // mid-test ECONNREFUSED / 300s timeouts (observed in CI on #272). Serial
    // execution keeps exactly one container live at a time, matching the
    // single-container-per-job profile of the other postgres-suites matrix jobs.
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

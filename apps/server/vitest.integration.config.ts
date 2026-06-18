/**
 * Vitest configuration for API integration tests.
 *
 * Covers:
 *   - POST /placements — manual placement creation
 *   - POST /placements/import — CSV import
 *   - GET /placements — tenant-scoped list
 *   - GET /placements/:id — detail fetch
 *   - Validation errors and tenant isolation
 *   - Commission plan CRUD, versioning, and assignment (issue #9)
 *
 * Requires an ephemeral Postgres container (Docker) and uses the shared
 * `vitestAliases()` helper for db/* and core/* imports. Using the shared table
 * (rather than a hand-maintained alias list) keeps this config from drifting
 * out of sync with new workspace modules — the previous hand-listed table here
 * was missing `core/entity-names`, which broke this suite the moment it was
 * wired into CI (#272).
 *
 * This config is referenced by `.github/workflows/test-suites.yml` so the two
 * placements integration suites actually gate a merge.
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { vitestAliases } from '../../vitest.aliases';

const root = resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: vitestAliases(root),
  },
  test: {
    globals: false,
    environment: 'node',
    include: [
      'apps/server/tests/integration/placements/**/*.test.ts',
      'tests/api/plans/**/*.test.ts',
    ],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

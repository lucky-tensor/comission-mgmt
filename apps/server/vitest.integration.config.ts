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
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: [
      // core/* — individual subpaths must come before the catch-all
      { find: 'core/auth', replacement: resolve(root, 'packages/core/auth.ts') },
      { find: 'core/logger', replacement: resolve(root, 'packages/core/logger.ts') },
      { find: 'core/trace', replacement: resolve(root, 'packages/core/trace.ts') },
      { find: 'core/encryption', replacement: resolve(root, 'packages/core/encryption.ts') },
      { find: 'core/types', replacement: resolve(root, 'packages/core/types.ts') },
      { find: 'core/tier-progress', replacement: resolve(root, 'packages/core/tier-progress.ts') },
      { find: 'core', replacement: resolve(root, 'packages/core/index.ts') },
      // db/* — individual subpaths before catch-all
      { find: 'db/revocation', replacement: resolve(root, 'packages/db/revocation.ts') },
      { find: 'db/passkeys', replacement: resolve(root, 'packages/db/passkeys.ts') },
      { find: 'db/pg-container', replacement: resolve(root, 'packages/db/pg-container.ts') },
      { find: 'db/ssl', replacement: resolve(root, 'packages/db/ssl.ts') },
      { find: 'db/placements', replacement: resolve(root, 'packages/db/src/placements.ts') },
      { find: 'db/plans', replacement: resolve(root, 'packages/db/src/plans.ts') },
      { find: 'db/index', replacement: resolve(root, 'packages/db/index.ts') },
      { find: 'db', replacement: resolve(root, 'packages/db/index.ts') },
    ],
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

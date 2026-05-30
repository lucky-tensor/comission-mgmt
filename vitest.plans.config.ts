/**
 * Vitest configuration for commission plan API integration tests.
 *
 * Covers:
 *   - POST /plans — create a plan with initial Draft version
 *   - POST /plans/:id/versions — create a new plan version
 *   - POST /plans/:id/versions/:vid/activate — activate a draft version
 *   - GET  /plans/:id/versions — list versions in descending order
 *   - GET  /plans/:id/active — get the active version
 *   - POST /plans/:id/assignments — assign a producer to a plan version
 *   - GET  /plans/:id/assignments — list producer assignments
 *   - Tier threshold validation (422 for overlapping thresholds)
 *   - Multi-tenant isolation
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: commission plan configuration and versioning (#9)
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const root = __dirname;

export default defineConfig({
  resolve: {
    alias: [
      // core/* — individual subpaths must come before the catch-all
      { find: 'core/auth', replacement: resolve(root, 'packages/core/auth.ts') },
      { find: 'core/logger', replacement: resolve(root, 'packages/core/logger.ts') },
      { find: 'core/trace', replacement: resolve(root, 'packages/core/trace.ts') },
      { find: 'core/encryption', replacement: resolve(root, 'packages/core/encryption.ts') },
      { find: 'core/types', replacement: resolve(root, 'packages/core/types.ts') },
      { find: 'core', replacement: resolve(root, 'packages/core/index.ts') },
      // db/* — individual subpaths before catch-all
      { find: 'db/revocation', replacement: resolve(root, 'packages/db/revocation.ts') },
      { find: 'db/passkeys', replacement: resolve(root, 'packages/db/passkeys.ts') },
      { find: 'db/pg-container', replacement: resolve(root, 'packages/db/pg-container.ts') },
      { find: 'db/ssl', replacement: resolve(root, 'packages/db/ssl.ts') },
      { find: 'db/plans', replacement: resolve(root, 'packages/db/src/plans.ts') },
      { find: 'db/index', replacement: resolve(root, 'packages/db/index.ts') },
      { find: 'db', replacement: resolve(root, 'packages/db/index.ts') },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/api/plans/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

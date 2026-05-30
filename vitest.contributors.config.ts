/**
 * Vitest configuration for contributor assignment API integration tests.
 *
 * Covers:
 *   - POST /placements/:id/contributors — assign a contributor
 *   - GET  /placements/:id/contributors — list contributors
 *   - DELETE /placements/:id/contributors/:cid — remove contributor
 *   - Split percentage validation on finalization
 *   - Audit log entries for contributor assignments
 *   - All 8 PRD contributor roles accepted; unknown role rejected
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: contribution assignment — contributor roles and split credit (#7)
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
      { find: 'core/contributor-role', replacement: resolve(root, 'packages/core/contributor-role.ts') },
      { find: 'core/types', replacement: resolve(root, 'packages/core/types.ts') },
      { find: 'core', replacement: resolve(root, 'packages/core/index.ts') },
      // db/* — individual subpaths before catch-all
      { find: 'db/revocation', replacement: resolve(root, 'packages/db/revocation.ts') },
      { find: 'db/passkeys', replacement: resolve(root, 'packages/db/passkeys.ts') },
      { find: 'db/pg-container', replacement: resolve(root, 'packages/db/pg-container.ts') },
      { find: 'db/ssl', replacement: resolve(root, 'packages/db/ssl.ts') },
      { find: 'db/src/placements', replacement: resolve(root, 'packages/db/src/placements.ts') },
      { find: 'db/src/contributors', replacement: resolve(root, 'packages/db/src/contributors.ts') },
      { find: 'db/placements', replacement: resolve(root, 'packages/db/src/placements.ts') },
      { find: 'db/contributors', replacement: resolve(root, 'packages/db/src/contributors.ts') },
      { find: 'db/index', replacement: resolve(root, 'packages/db/index.ts') },
      { find: 'db', replacement: resolve(root, 'packages/db/index.ts') },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/api/contributors/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

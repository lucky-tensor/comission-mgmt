/**
 * Vitest configuration for attribution API integration tests.
 *
 * Covers:
 *   - POST /placements/:id/attribution/submit — submit for manager approval
 *   - POST /placements/:id/attribution/approve — Manager approves
 *   - POST /placements/:id/attribution/reject — Manager rejects with reason
 *   - GET  /placements/:id/attribution/timeline — ordered event history
 *   - State machine: invalid transitions return 422
 *   - RBAC: non-Manager roles receive 403 on approve/reject
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: manager split approval workflow and attribution timeline (#8)
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
      {
        find: 'core/contributor-role',
        replacement: resolve(root, 'packages/core/contributor-role.ts'),
      },
      { find: 'core/types', replacement: resolve(root, 'packages/core/types.ts') },
      { find: 'core/tier-progress', replacement: resolve(root, 'packages/core/tier-progress.ts') },
      { find: 'core', replacement: resolve(root, 'packages/core/index.ts') },
      // db/* — individual subpaths before catch-all
      { find: 'db/revocation', replacement: resolve(root, 'packages/db/revocation.ts') },
      { find: 'db/passkeys', replacement: resolve(root, 'packages/db/passkeys.ts') },
      { find: 'db/pg-container', replacement: resolve(root, 'packages/db/pg-container.ts') },
      { find: 'db/ssl', replacement: resolve(root, 'packages/db/ssl.ts') },
      { find: 'db/src/placements', replacement: resolve(root, 'packages/db/src/placements.ts') },
      {
        find: 'db/src/contributors',
        replacement: resolve(root, 'packages/db/src/contributors.ts'),
      },
      {
        find: 'db/src/attribution',
        replacement: resolve(root, 'packages/db/src/attribution.ts'),
      },
      { find: 'db/placements', replacement: resolve(root, 'packages/db/src/placements.ts') },
      { find: 'db/contributors', replacement: resolve(root, 'packages/db/src/contributors.ts') },
      { find: 'db/attribution', replacement: resolve(root, 'packages/db/src/attribution.ts') },
      { find: 'db/index', replacement: resolve(root, 'packages/db/index.ts') },
      { find: 'db', replacement: resolve(root, 'packages/db/index.ts') },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/api/attribution/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

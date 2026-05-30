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
      {
        find: 'core/calculation-engine',
        replacement: resolve(root, 'packages/core/calculation-engine.ts'),
      },
      {
        find: 'core/explanation-engine',
        replacement: resolve(root, 'packages/core/explanation-engine.ts'),
      },
      {
        find: 'core/contributor-role',
        replacement: resolve(root, 'packages/core/contributor-role.ts'),
      },
      {
        find: 'core/placement-state',
        replacement: resolve(root, 'packages/core/placement-state.ts'),
      },
      {
        find: 'core/invoice-trigger',
        replacement: resolve(root, 'packages/core/invoice-trigger.ts'),
      },
      { find: 'core', replacement: resolve(root, 'packages/core/index.ts') },
      // db/* — individual subpaths before catch-all
      { find: 'db/revocation', replacement: resolve(root, 'packages/db/revocation.ts') },
      { find: 'db/passkeys', replacement: resolve(root, 'packages/db/passkeys.ts') },
      { find: 'db/pg-container', replacement: resolve(root, 'packages/db/pg-container.ts') },
      { find: 'db/ssl', replacement: resolve(root, 'packages/db/ssl.ts') },
      { find: 'db/placements', replacement: resolve(root, 'packages/db/src/placements.ts') },
      { find: 'db/contributors', replacement: resolve(root, 'packages/db/src/contributors.ts') },
      { find: 'db/plans', replacement: resolve(root, 'packages/db/src/plans.ts') },
      {
        find: 'db/commission-records',
        replacement: resolve(root, 'packages/db/src/commission-records.ts'),
      },
      {
        find: 'db/commission-runs',
        replacement: resolve(root, 'packages/db/src/commission-runs.ts'),
      },
      { find: 'db/invoices', replacement: resolve(root, 'packages/db/src/invoices.ts') },
      { find: 'db/index', replacement: resolve(root, 'packages/db/index.ts') },
      { find: 'db', replacement: resolve(root, 'packages/db/index.ts') },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/api/commission-runs/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

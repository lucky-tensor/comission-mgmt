/**
 * Vitest configuration for security-wiring integration tests (CSRF, rate
 * limiting, cookie posture). Requires an ephemeral Postgres container (Docker).
 *
 * These tests drive the full exported `fetchHandler`, so every db/* and core/*
 * subpath the server imports must be aliased here.
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const root = __dirname;
const core = (n: string) => resolve(root, `packages/core/${n}.ts`);
const dbSrc = (n: string) => resolve(root, `packages/db/src/${n}.ts`);
const dbRoot = (n: string) => resolve(root, `packages/db/${n}.ts`);

export default defineConfig({
  resolve: {
    alias: [
      // core/* subpaths before the catch-all
      { find: 'core/auth', replacement: core('auth') },
      { find: 'core/logger', replacement: core('logger') },
      { find: 'core/trace', replacement: core('trace') },
      { find: 'core/encryption', replacement: core('encryption') },
      { find: 'core/types', replacement: core('types') },
      { find: 'core/calculation-engine', replacement: core('calculation-engine') },
      { find: 'core/explanation-engine', replacement: core('explanation-engine') },
      { find: 'core/contributor-role', replacement: core('contributor-role') },
      { find: 'core/placement-state', replacement: core('placement-state') },
      { find: 'core/invoice-trigger', replacement: core('invoice-trigger') },
      { find: 'core/tier-progress', replacement: core('tier-progress') },
      { find: 'core/clawback-ledger', replacement: core('clawback-ledger') },
      { find: 'core/guarantee-state', replacement: core('guarantee-state') },
      { find: 'core/commission-run', replacement: core('commission-run') },
      { find: 'core', replacement: core('index') },
      // db/* subpaths before the catch-all
      { find: 'db/revocation', replacement: dbRoot('revocation') },
      { find: 'db/passkeys', replacement: dbRoot('passkeys') },
      { find: 'db/pg-container', replacement: dbRoot('pg-container') },
      { find: 'db/ssl', replacement: dbRoot('ssl') },
      { find: 'db/task-queue', replacement: dbRoot('task-queue') },
      { find: 'db/worker-tokens', replacement: dbRoot('worker-tokens') },
      { find: 'db/attribution', replacement: dbSrc('attribution') },
      { find: 'db/billing-phases', replacement: dbSrc('billing-phases') },
      { find: 'db/clawback', replacement: dbSrc('clawback') },
      { find: 'db/commission-records', replacement: dbSrc('commission-records') },
      { find: 'db/commission-runs', replacement: dbSrc('commission-runs') },
      { find: 'db/contributors', replacement: dbSrc('contributors') },
      { find: 'db/exceptions', replacement: dbSrc('exceptions') },
      { find: 'db/guarantee-periods', replacement: dbSrc('guarantee-periods') },
      { find: 'db/invoices', replacement: dbSrc('invoices') },
      { find: 'db/payroll-exports', replacement: dbSrc('payroll-exports') },
      { find: 'db/placements', replacement: dbSrc('placements') },
      { find: 'db/plans', replacement: dbSrc('plans') },
      { find: 'db/reconciliation', replacement: dbSrc('reconciliation') },
      { find: 'db/index', replacement: dbRoot('index') },
      { find: 'db', replacement: dbRoot('index') },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['apps/server/tests/integration/security/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

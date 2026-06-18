/**
 * Vitest configuration for the pure-unit packages/db suites (no Postgres).
 *
 * Covers the db suites that run entirely in node over in-memory data or
 * injected boundaries — no Docker, no pg-container:
 *   - encryption        (FieldEncryptor round-trip / KMS cache contract; the
 *                        only mock is the IKmsAdapter boundary)
 *   - claude-cli-engine (#262 — Claude CLI spawn engine with an injected spawn,
 *                        so no real `claude` binary is invoked)
 *
 * These are split from the Postgres-backed db suites (vitest.db.config.ts) so
 * they stay fast and can run in the node-only CI matrix.
 *
 * Before this config existed these two suites were orphaned from CI: no
 * workflow-referenced config matched them, so they could never gate a merge
 * (#272).
 *
 * Run: `bun --bun vitest run --config vitest.db-unit.config.ts`
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
      'packages/db/tests/encryption.test.ts',
      'packages/db/tests/claude-cli-engine.test.ts',
    ],
  },
});

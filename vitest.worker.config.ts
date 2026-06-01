/**
 * Vitest configuration for isolated worker tests — issue #87.
 *
 * Covers:
 *   - Ping agent loop and heartbeat tests (apps/worker/tests/ping.test.ts)
 *   - Guarantee-expiry worker isolated processing and crash-recovery tests
 *     (apps/worker/tests/guarantee-expiry-worker.test.ts)
 *
 * Each test uses an ephemeral Postgres container (Docker required).
 * No API server is spun up — the worker handlers are exercised in isolation.
 *
 * Canonical docs: docs/architecture.md — Worker isolation; issue #87
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
    include: ['apps/worker/tests/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

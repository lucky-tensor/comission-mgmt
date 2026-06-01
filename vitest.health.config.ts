/**
 * Vitest configuration for health check endpoint integration tests.
 *
 * Exercises the /healthz (liveness) and /readyz (readiness) handlers against
 * a real ephemeral Postgres container. The /healthz test needs no DB, while the
 * /readyz tests spin up and tear down a container inside the test suite itself.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, DEPLOY-C-030/031
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
    include: ['apps/server/tests/integration/health.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

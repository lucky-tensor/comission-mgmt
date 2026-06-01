/**
 * Vitest configuration for cron scheduler integration tests.
 *
 * Covers:
 *   - apps/worker/tests/cron/scheduler.test.ts — CronScheduler job registration
 *     and guarantee-expiry handler task dispatch against real ephemeral Postgres.
 *   - apps/worker/tests/cron/boot.test.ts — boot() smoke test.
 *
 * Requires Docker for the ephemeral Postgres container used by scheduler.test.ts.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, Cron scheduler
 * Issue: test: cron/scheduler integration tests — scheduler wiring (#89)
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
    include: ['apps/worker/tests/cron/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

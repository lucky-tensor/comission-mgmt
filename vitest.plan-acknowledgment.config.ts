/**
 * Vitest configuration for commission plan acknowledgment integration tests.
 *
 * Covers:
 *   - POST /plans/:id/versions/:vid/acknowledge — producer acceptance record, idempotency
 *   - GET  /plans/:id/assignments — acknowledgedAt / acknowledgedBy status
 *   - Cross-producer 403 isolation
 *   - Role gating (non-Producer cannot acknowledge)
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Canonical docs: docs/prd.md §4 (HR / People Ops)
 * Issue: feat: commission plan acknowledgment — producer acceptance record and status read (#123)
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
    include: ['tests/api/plan-acknowledgment/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

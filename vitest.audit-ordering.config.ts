/**
 * Vitest configuration for audit-before-read ordering integration tests (#81).
 *
 * Covers:
 *   - sensitiveRead writes the audit row before the read body runs
 *   - sensitiveRead denies the read when the audit write fails
 *   - GET /placements/:id and GET /placements deny on audit-DB unavailability
 *
 * Requires an ephemeral Postgres container (Docker). Uses the shared workspace
 * alias table for db/* and core/* imports.
 *
 * Canonical docs: docs/architecture.md — Audit Write Policy
 * Issue: feat: complete Superfield-adherence remediation (#81)
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
    include: ['tests/api/audit-ordering/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

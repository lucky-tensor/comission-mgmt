/**
 * Vitest configuration for payout dispute and question submission integration tests.
 *
 * Covers:
 *   - POST /disputes — create dispute (state=Submitted)
 *   - GET /disputes — Producer scoping (own only) and Finance Admin (all tenant)
 *   - POST /disputes/:id/resolve — Finance Admin resolves, AuditLogEntry created
 *   - RBAC: Producer attempting resolve returns 403
 *   - Multi-tenant isolation
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: payout dispute and question submission (#18)
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
    include: ['tests/api/disputes/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

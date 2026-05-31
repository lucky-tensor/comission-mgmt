/**
 * Vitest configuration for placement confidential flag and field masking integration tests.
 *
 * Covers:
 *   - Finance Admin sets is_confidential flag via PATCH /placements/:id
 *   - Role differentiation: Producer sees masked fields, Finance Admin sees unmasked
 *   - GET /me/payouts masking: position_title and client_name masked for Producer
 *   - Payroll export row masking: confidential placement rows have masked fields
 *   - Commission amounts are unaffected by the confidential flag
 *   - AuditLogEntry written when is_confidential changes
 *   - External Partner GET /partner/placements/:id returns masked fields
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: placement confidential flag and field masking (#64)
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
    include: ['tests/api/confidential-placement/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

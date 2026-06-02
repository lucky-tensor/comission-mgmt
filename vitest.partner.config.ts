/**
 * Vitest configuration for external partner scoped deal-list endpoint tests.
 *
 * Covers:
 *   - GET /partner/placements returns only the authenticated partner's split deals
 *   - Unrelated placement exclusion (negative test)
 *   - Field masking on confidential placements (mirrors #64 masking)
 *   - Role 403 for non-partner roles
 *   - Cross-partner isolation (partner1 cannot see partner2 deals)
 *   - Tenant isolation
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: external partner scoped deal-list endpoint (#125)
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
    include: ['tests/api/partner/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

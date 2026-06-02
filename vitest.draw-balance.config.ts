/**
 * Vitest configuration for per-producer draw balance and recovery schedule read API tests.
 *
 * Covers:
 *   - GET /producers/:id/draw-balance — balance read with seeded draw and clawback recovery
 *   - Aggregate cross-check against underlying DB records
 *   - Zero-draw case (no error, zero balance)
 *   - RBAC and tenant isolation: HR, producer, other producer (403), FinanceAdmin (403)
 *   - Audit log entry written on each read
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: per-producer draw balance and recovery schedule read API (#124)
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
    include: ['tests/api/draw-balance/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

/**
 * Vitest configuration for the Producer Deal Simulator API integration tests.
 *
 * Covers (issue #262):
 *   - POST /producer/simulations/actual — enqueue + producer-scope (403 on
 *     another producer's deal_id)
 *   - POST /producer/simulations/hypothetical — enqueue
 *   - GET /producer/simulations — caller-scoped history
 *   - POST /producer/simulations/:id/result — delegated single-use token write
 *     path, AuditLogEntry, read-only guarantee, concurrency
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: Implement Producer Deal Simulator forecasting pipeline (#262)
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
    include: ['tests/api/producer-simulations/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

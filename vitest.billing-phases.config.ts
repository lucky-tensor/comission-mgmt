/**
 * Vitest configuration for retained search billing phases API integration tests.
 *
 * Covers:
 *   - POST /placements/:id/billing-phases — create billing phases (retainer, delivery)
 *   - GET  /placements/:id/billing-phases — list billing phases
 *   - PATCH /placements/:id/billing-phases/:phaseId — update phase (link invoice, amounts)
 *   - POST /placements/:id/billing-phases/:phaseId/contributors — assign phase contributor
 *   - GET  /placements/:id/billing-phases/:phaseId/contributors — list phase contributors
 *   - POST /placements/:id/calculate-phases — per-phase commission calculation
 *   - Phase-gated collection: retainer invoice paid → retainer released, delivery held
 *   - Delivery invoice paid → delivery released
 *   - GET /me/commission-records shows blocked_phase with held_pending_phase_invoice
 *   - Relational journal entries with billing_phase_id on each release
 *   - Regression: contingency placement flow unaffected
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: retained search billing phases (#63)
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
    include: ['tests/api/billing-phases/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

/**
 * Vitest configuration for invoice and collection tracking API integration tests.
 *
 * Covers:
 *   - POST /invoices — create invoice linked to placement (status=Issued)
 *   - PATCH /invoices/:id — update status, amount_collected
 *   - PATCH /invoices/:id to status=Paid triggers collection gate release
 *   - PATCH /invoices/:id to status=WrittenOff produces AuditLogEntry
 *   - GET /commission-records?reason=collection_gate — filter Held records
 *   - POST /invoices/import — batch CSV import with re-evaluation
 *   - End-to-end: placement → calculate → invoice Paid → CommissionRecord=Payable
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: invoice and collection tracking (#12)
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
    include: ['tests/api/invoices/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

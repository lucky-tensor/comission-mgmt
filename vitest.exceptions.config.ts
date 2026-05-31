/**
 * Vitest configuration for exception request and approval workflow integration tests.
 *
 * Covers:
 *   - POST /exceptions — submit an exception request, state=Requested
 *   - POST /exceptions/:id/approve — Finance Admin approve; posts ledger adjustment
 *   - POST /exceptions/:id/reject — Finance Admin reject; records rejection reason
 *   - POST /exceptions/:id/approve by Producer returns 403 (RBAC)
 *   - Each state transition creates an AuditLogEntry
 *   - GET /exceptions?state=Requested returns only open requests
 *   - Attachment upload: POST multipart/form-data returns 201, GET includes attachment metadata
 *
 * Requires an ephemeral Postgres container (Docker) and uses workspace package
 * aliases for db/* and core/* imports.
 *
 * Issue: feat: exception request and approval workflow (#14)
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
    include: ['tests/api/exceptions/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

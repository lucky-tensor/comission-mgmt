/**
 * Leadership Visibility — handler tests.
 *
 * Tests:
 *   AC#1 — GET /analytics/executive enforces RBAC: Producer returns 403.
 *   AC#2 — GET /analytics/team stub handler returns 501 Not Implemented.
 *
 * These tests exercise the handlers directly (no HTTP server, no DB for RBAC check).
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Full integration tests for GET /analytics/executive (schema, arithmetic, DB) are
 * covered by tests/api/analytics/executive/executive.test.ts (issue #22).
 *
 * Canonical docs: docs/prd.md §4, docs/architecture/phase-leadership-visibility.md
 * Issue: dev-scout: stub Leadership Visibility integration seams (#28)
 * Issue: feat: executive margin and commission liability dashboard (#22)
 */

import { describe, test, expect } from 'vitest';
import {
  handleGetExecutiveAnalytics,
  handleGetTeamAnalytics,
} from '../../../apps/server/src/api/analytics';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Minimal session claims
// ---------------------------------------------------------------------------

const financeClaims: SessionClaims = {
  org_id: crypto.randomUUID(),
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producerClaims: SessionClaims = {
  org_id: crypto.randomUUID(),
  user_id: crypto.randomUUID(),
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

// ---------------------------------------------------------------------------
// GET /analytics/executive — RBAC enforcement (no DB needed for 403 path)
// ---------------------------------------------------------------------------

describe('GET /analytics/executive', () => {
  test('Producer returns 403 Forbidden (RBAC)', async () => {
    const req = makeRequest('/analytics/executive?period_start=2024-01-01&period_end=2024-12-31');
    const res = await handleGetExecutiveAnalytics(req, producerClaims);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/team — stub returns 501 (issue #21 not yet implemented)
// ---------------------------------------------------------------------------

describe('GET /analytics/team', () => {
  test('stub handler returns 501 Not Implemented', async () => {
    const req = makeRequest('/analytics/team');
    const res = await handleGetTeamAnalytics(req, financeClaims);
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Not Implemented');
  });
});

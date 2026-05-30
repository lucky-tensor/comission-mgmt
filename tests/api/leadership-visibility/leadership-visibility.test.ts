/**
 * Leadership Visibility — stub handler tests (issue #28).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — GET /analytics/executive stub handler returns 501 Not Implemented.
 *   AC#2 — GET /analytics/team stub handler returns 501 Not Implemented.
 *
 * These tests exercise the stub handlers directly (no HTTP server, no DB).
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §8.10, docs/architecture/phase-leadership-visibility.md
 * Issue: dev-scout: stub Leadership Visibility integration seams (#28)
 */

import { describe, test, expect } from 'vitest';
import {
  handleGetExecutiveAnalytics,
  handleGetTeamAnalytics,
} from '../../../apps/server/src/api/analytics';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Minimal session claims for stub tests (no DB needed)
// ---------------------------------------------------------------------------

const claims: SessionClaims = {
  org_id: crypto.randomUUID(),
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

// ---------------------------------------------------------------------------
// GET /analytics/executive — stub returns 501
// ---------------------------------------------------------------------------

describe('GET /analytics/executive', () => {
  test('stub handler returns 501 Not Implemented', async () => {
    const req = makeRequest('/analytics/executive');
    const res = await handleGetExecutiveAnalytics(req, claims);
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Not Implemented');
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/team — stub returns 501
// ---------------------------------------------------------------------------

describe('GET /analytics/team', () => {
  test('stub handler returns 501 Not Implemented', async () => {
    const req = makeRequest('/analytics/team');
    const res = await handleGetTeamAnalytics(req, claims);
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Not Implemented');
  });
});

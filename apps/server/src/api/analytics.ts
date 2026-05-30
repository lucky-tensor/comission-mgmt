/**
 * Leadership Visibility analytics API routes — stub handlers.
 *
 * Routes (stub — returns 501 Not Implemented):
 *   GET /analytics/executive — executive margin, gross fees, clawback exposure, exception rate
 *   GET /analytics/team      — manager team commission view
 *
 * These stubs satisfy the dev-scout acceptance criteria for issue #28.
 * Full implementation is covered by feature issues #21 (executive dashboard)
 * and #22 (manager team view).
 *
 * RBAC (planned):
 *   GET /analytics/executive — FinanceAdmin / Executive role only
 *   GET /analytics/team      — Manager / FinanceAdmin only
 *
 * Aggregation strategy decision recorded in:
 *   docs/architecture/phase-leadership-visibility.md
 *
 * Canonical docs: docs/prd.md §8.10
 * Issue: dev-scout: stub Leadership Visibility integration seams (#28)
 */

import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// GET /analytics/executive — stub (501)
// ---------------------------------------------------------------------------

/**
 * GET /analytics/executive — executive dashboard analytics stub.
 *
 * Returns 501 Not Implemented until the feature is fully implemented in issue #21.
 *
 * Planned response shape:
 *   { gross_fees, net_margin, clawback_exposure, exception_rate, period }
 *
 * @param _req    - Incoming request (unused in stub).
 * @param _claims - Authenticated session claims (unused in stub).
 */
export async function handleGetExecutiveAnalytics(
  _req: Request,
  _claims: SessionClaims,
): Promise<Response> {
  return jsonResponse({ error: 'Not Implemented' }, 501);
}

// ---------------------------------------------------------------------------
// GET /analytics/team — stub (501)
// ---------------------------------------------------------------------------

/**
 * GET /analytics/team — manager team commission view stub.
 *
 * Returns 501 Not Implemented until the feature is fully implemented in issue #22.
 *
 * Planned response shape:
 *   { team_members: [{ user_id, name, total_commission, record_count }], period }
 *
 * @param _req    - Incoming request (unused in stub).
 * @param _claims - Authenticated session claims (unused in stub).
 */
export async function handleGetTeamAnalytics(
  _req: Request,
  _claims: SessionClaims,
): Promise<Response> {
  return jsonResponse({ error: 'Not Implemented' }, 501);
}

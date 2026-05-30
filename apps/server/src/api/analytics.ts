/**
 * Leadership Visibility analytics API routes.
 *
 * Routes:
 *   GET /analytics/executive — executive margin, gross fees, clawback exposure, exception rate
 *   GET /analytics/team      — manager team commission view (stub, issue #21)
 *
 * RBAC:
 *   GET /analytics/executive — FinanceAdmin or Executive role only (403 for all others)
 *   GET /analytics/team      — stub (501) until issue #21 is implemented
 *
 * Query parameters for GET /analytics/executive:
 *   period_start (required) — ISO date string YYYY-MM-DD
 *   period_end   (required) — ISO date string YYYY-MM-DD
 *
 * Aggregation strategy: on-the-fly (decision recorded in
 *   docs/architecture/phase-leadership-visibility.md).
 *
 * Canonical docs: docs/prd.md §4 (Executive user stories)
 * Issue: feat: executive margin and commission liability dashboard (#22)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, getExecutiveAnalytics } from 'db/index';
import type { SessionClaims } from 'core/auth';

type SqlClient = Sql;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ---------------------------------------------------------------------------
// GET /analytics/executive
// ---------------------------------------------------------------------------

/**
 * GET /analytics/executive — executive dashboard analytics.
 *
 * Returns all PRD §4 executive metrics in a single JSON response.
 *
 * RBAC: FinanceAdmin or Executive only. Returns 403 for all other roles.
 *
 * Query params:
 *   period_start — ISO date (YYYY-MM-DD), defaults to 30 days ago
 *   period_end   — ISO date (YYYY-MM-DD), defaults to today
 *
 * @param req    - Incoming request.
 * @param claims - Authenticated session claims.
 * @param sqlClient - Optional injectable SQL client (for tests).
 */
export async function handleGetExecutiveAnalytics(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  // RBAC: only FinanceAdmin and Executive may access executive analytics
  if (claims.role !== 'FinanceAdmin' && claims.role !== 'Executive') {
    return errorResponse('Forbidden: FinanceAdmin or Executive role required', 403);
  }

  const url = new URL(req.url);

  // Parse period parameters; default to last 30 days if not provided
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const defaultStart = thirtyDaysAgo.toISOString().slice(0, 10);

  const periodStart = url.searchParams.get('period_start') ?? defaultStart;
  const periodEnd = url.searchParams.get('period_end') ?? defaultEnd;

  // Basic date format validation (YYYY-MM-DD)
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(periodStart) || !datePattern.test(periodEnd)) {
    return errorResponse(
      'Invalid date format. Use YYYY-MM-DD for period_start and period_end.',
      400,
    );
  }

  if (periodStart > periodEnd) {
    return errorResponse('period_start must be on or before period_end.', 400);
  }

  const db = sqlClient ?? defaultSql;

  try {
    const analytics = await getExecutiveAnalytics(db, claims.org_id, periodStart, periodEnd);
    return jsonResponse(analytics);
  } catch (err) {
    console.error('[analytics] getExecutiveAnalytics error:', err);
    return errorResponse('Internal server error', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /analytics/team — stub (501)
// ---------------------------------------------------------------------------

/**
 * GET /analytics/team — manager team commission view stub.
 *
 * Returns 501 Not Implemented until the feature is fully implemented in issue #21.
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

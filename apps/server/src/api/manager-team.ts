/**
 * Manager Team View API routes (issue #21).
 *
 * Routes:
 *   GET /me/team/placements         — placements where this manager is a ManagerOverride contributor
 *   GET /me/team/commission-summary — accruals / payables / holds grouped by producer
 *   GET /me/team/pending-approvals  — attribution requests awaiting this manager's approval
 *   GET /me/team/disputes           — open disputes for the manager's team placements
 *
 * RBAC:
 *   All routes are restricted to the Manager role (returns 403 for any other role).
 *   Isolation: all queries are scoped to (org_id, claims.user_id) so a Manager token
 *   cannot read another manager's team data — enforced at the DB query layer.
 *
 * A manager's "team" is defined as the set of placements where the authenticated user
 * (claims.user_id) appears as a contributor with role_code = 'ManagerOverride'.
 *
 * Aggregation strategy: on-the-fly SQL — see
 * docs/architecture/phase-leadership-visibility.md for the decision record.
 *
 * Canonical docs: docs/prd.md §8.10, docs/architecture/phase-leadership-visibility.md
 * Issue: feat: manager team commission view (#21)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql } from 'db/index';
import {
  listTeamPlacements,
  getTeamCommissionSummary,
  listTeamPendingApprovals,
  listTeamDisputes,
} from 'db/index';
import type {
  TeamPlacement,
  ProducerCommissionSummary,
  PendingApprovalItem,
  TeamDisputeItem,
} from 'db/index';
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

/**
 * Returns 403 if the session role is not Manager.
 * Finance Admins may also access these routes to facilitate oversight.
 */
function requireManagerOrAdmin(
  claims: SessionClaims,
): { denied: true; response: Response } | { denied: false } {
  if (claims.role !== 'Manager' && claims.role !== 'FinanceAdmin') {
    return {
      denied: true,
      response: errorResponse('Forbidden: Manager or FinanceAdmin role required', 403),
    };
  }
  return { denied: false };
}

// ---------------------------------------------------------------------------
// GET /me/team/placements
// ---------------------------------------------------------------------------

/**
 * Returns all placements where the authenticated Manager is a ManagerOverride contributor.
 *
 * Response: { placements: [{ id, org_id, job_title, status, start_date, created_at }] }
 *
 * @param _req      - Incoming request (unused)
 * @param claims    - Session claims (org_id, user_id, role)
 * @param sqlClient - Optional injectable SQL client for testing
 */
export async function handleGetTeamPlacements(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const rbac = requireManagerOrAdmin(claims);
  if (rbac.denied) return rbac.response;

  const db = sqlClient ?? defaultSql;

  try {
    const placements = await listTeamPlacements(db, claims.org_id, claims.user_id);

    return jsonResponse({
      placements: placements.map((p: TeamPlacement) => ({
        id: p.id,
        org_id: p.orgId,
        job_title: p.jobTitle,
        status: p.status,
        start_date: p.startDate,
        created_at: p.createdAt,
      })),
    });
  } catch (err: unknown) {
    console.error('[me/team/placements] error:', err);
    return errorResponse('Failed to retrieve team placements', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /me/team/commission-summary
// ---------------------------------------------------------------------------

/**
 * Returns commission summary (accruals, payables, holds) grouped by producer
 * for all placements in the manager's team.
 *
 * Response:
 *   { summary: [{ producer_id, total_accrued, total_payable, total_held, record_count }] }
 *
 * @param _req      - Incoming request (unused)
 * @param claims    - Session claims (org_id, user_id, role)
 * @param sqlClient - Optional injectable SQL client for testing
 */
export async function handleGetTeamCommissionSummary(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const rbac = requireManagerOrAdmin(claims);
  if (rbac.denied) return rbac.response;

  const db = sqlClient ?? defaultSql;

  try {
    const summary = await getTeamCommissionSummary(db, claims.org_id, claims.user_id);

    return jsonResponse({
      summary: summary.map((s: ProducerCommissionSummary) => ({
        producer_id: s.producerId,
        total_accrued: s.totalAccrued,
        total_payable: s.totalPayable,
        total_held: s.totalHeld,
        record_count: s.recordCount,
      })),
    });
  } catch (err: unknown) {
    console.error('[me/team/commission-summary] error:', err);
    return errorResponse('Failed to retrieve team commission summary', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /me/team/pending-approvals
// ---------------------------------------------------------------------------

/**
 * Returns placements in PendingApproval state for the manager's team.
 *
 * Response: { pending_approvals: [{ placement_id, job_title, submitted_at }] }
 *
 * @param _req      - Incoming request (unused)
 * @param claims    - Session claims (org_id, user_id, role)
 * @param sqlClient - Optional injectable SQL client for testing
 */
export async function handleGetTeamPendingApprovals(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const rbac = requireManagerOrAdmin(claims);
  if (rbac.denied) return rbac.response;

  const db = sqlClient ?? defaultSql;

  try {
    const items = await listTeamPendingApprovals(db, claims.org_id, claims.user_id);

    return jsonResponse({
      pending_approvals: items.map((item: PendingApprovalItem) => ({
        placement_id: item.placementId,
        job_title: item.jobTitle,
        submitted_at: item.submittedAt,
      })),
    });
  } catch (err: unknown) {
    console.error('[me/team/pending-approvals] error:', err);
    return errorResponse('Failed to retrieve team pending approvals', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /me/team/disputes
// ---------------------------------------------------------------------------

/**
 * Returns open (Submitted or UnderReview) disputes for the manager's team placements.
 *
 * Response:
 *   { disputes: [{ id, org_id, commission_record_id, submitted_by, description, state, created_at, placement_id }] }
 *
 * @param _req      - Incoming request (unused)
 * @param claims    - Session claims (org_id, user_id, role)
 * @param sqlClient - Optional injectable SQL client for testing
 */
export async function handleGetTeamDisputes(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const rbac = requireManagerOrAdmin(claims);
  if (rbac.denied) return rbac.response;

  const db = sqlClient ?? defaultSql;

  try {
    const disputes = await listTeamDisputes(db, claims.org_id, claims.user_id);

    return jsonResponse({
      disputes: disputes.map((d: TeamDisputeItem) => ({
        id: d.id,
        org_id: d.orgId,
        commission_record_id: d.commissionRecordId,
        submitted_by: d.submittedBy,
        description: d.description,
        state: d.state,
        created_at: d.createdAt,
        placement_id: d.placementId,
      })),
    });
  } catch (err: unknown) {
    console.error('[me/team/disputes] error:', err);
    return errorResponse('Failed to retrieve team disputes', 500);
  }
}

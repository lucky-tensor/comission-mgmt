/**
 * Producer Portal /me routes — real implementation.
 *
 * Routes implemented in this issue (#16):
 *   GET  /me/commission-records            — producer's own CommissionRecords with explanation
 *   GET  /me/commission-records?status=Held — filter to held records
 *   GET  /me/payouts                        — historical approved payouts from prior runs
 *
 * Stub routes (still 501 — tracked in downstream issues):
 *   GET  /me                        — producer identity + active plan summary
 *   GET  /me/tier-progress          — on-the-fly tier progress
 *   POST /me/disputes               — open a dispute against a commission record
 *
 * Security:
 *   - Scoped to SessionClaims.user_id (contributor_id = user_id within the org).
 *   - Only the Producer role may call /me routes (enforced by RBAC in core/auth).
 *   - A different producer's data is not accessible — queries are scoped by
 *     contributor_id = claims.user_id, so isolation is enforced at the DB layer.
 *
 * Canonical docs:
 *   - docs/prd.md §5.8, §7.6 — Producer Payout Portal
 *   - docs/architecture/phase-producer-portal.md — scout decision record
 *
 * Issue: feat: producer payout statement and deal visibility (#16)
 */

import type { SessionClaims } from 'core/auth';
import type { Sql } from 'postgres';
import {
  sql as defaultSql,
  listCommissionRecordsByContributor,
  listApprovedPayoutsByContributor,
} from 'db/index';

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

function notImplemented(description: string): Response {
  return new Response(
    JSON.stringify({
      error: 'Not Implemented',
      description,
      scout: 'dev-scout stub — see docs/architecture/phase-producer-portal.md',
    }),
    {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

// ---------------------------------------------------------------------------
// GET /me — producer identity + active plan summary (stub)
// ---------------------------------------------------------------------------

/**
 * GET /me
 *
 * Returns the authenticated producer's identity and active plan summary.
 * Scout stub — returns 501 Not Implemented.
 *
 * Planned implementation notes:
 *   - Resolves the active PlanVersion for the session user_id and org_id.
 *   - Returns producer_id, display name (via users table), role, and plan
 *     version metadata (tier thresholds, base rate).
 *   - Writes a commission_audit entry before returning (audit-log-first, DATA-D-010).
 */
export function handleGetMe(_claims: SessionClaims): Response {
  return notImplemented('Producer identity and active plan summary — not yet implemented');
}

// ---------------------------------------------------------------------------
// GET /me/commission-records
// ---------------------------------------------------------------------------

/**
 * GET /me/commission-records — returns CommissionRecords for the authenticated producer.
 *
 * Scoped to contributor_id = claims.user_id and org_id = claims.org_id.
 * Optional ?status=<value> filter (e.g. status=Held).
 *
 * Returns 200 with { commission_records: [...] } including the explanation field.
 *
 * Isolation guarantee: because we scope contributor_id = claims.user_id, a producer
 * token can only see their own records even if they know another producer's ID.
 *
 * @param req        - HTTP request (may include ?status= query param)
 * @param claims     - Session claims (org_id, user_id)
 * @param sqlClient  - Optional injectable SQL client for testing
 */
export async function handleGetMyCommissionRecords(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get('status') ?? undefined;

  try {
    const records = await listCommissionRecordsByContributor(
      db,
      claims.org_id,
      claims.user_id,
      statusFilter,
    );
    return jsonResponse({
      commission_records: records.map((r) => ({
        id: r.id,
        org_id: r.orgId,
        placement_id: r.placementId,
        contributor_id: r.contributorId,
        plan_version_id: r.planVersionId,
        gross_commission: r.grossAmount,
        net_payable: r.netPayable,
        tier_rate: r.tierRate,
        status: r.status,
        hold_reason: r.holdReason,
        explanation: r.explanation,
        approval_actor: r.approvalActor,
        approval_at: r.approvalAt,
        created_at: r.createdAt,
      })),
    });
  } catch (err: unknown) {
    console.error('[me/commission-records] list error:', err);
    return errorResponse('Failed to retrieve commission records', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /me/payouts
// ---------------------------------------------------------------------------

/**
 * GET /me/payouts — returns historical approved payouts for the authenticated producer.
 *
 * Returns only CommissionRecords that are part of an Approved commission run,
 * scoped to contributor_id = claims.user_id and org_id = claims.org_id.
 *
 * Returns 200 with { payouts: [...] }.
 *
 * @param _req       - HTTP request (unused currently)
 * @param claims     - Session claims (org_id, user_id)
 * @param sqlClient  - Optional injectable SQL client for testing
 */
export async function handleGetMyPayouts(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  try {
    const records = await listApprovedPayoutsByContributor(db, claims.org_id, claims.user_id);
    return jsonResponse({
      payouts: records.map((r) => ({
        id: r.id,
        org_id: r.orgId,
        placement_id: r.placementId,
        contributor_id: r.contributorId,
        plan_version_id: r.planVersionId,
        gross_commission: r.grossAmount,
        net_payable: r.netPayable,
        tier_rate: r.tierRate,
        status: r.status,
        hold_reason: r.holdReason,
        explanation: r.explanation,
        approval_actor: r.approvalActor,
        approval_at: r.approvalAt,
        created_at: r.createdAt,
      })),
    });
  } catch (err: unknown) {
    console.error('[me/payouts] list error:', err);
    return errorResponse('Failed to retrieve payouts', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /me/tier-progress (stub)
// ---------------------------------------------------------------------------

/**
 * GET /me/tier-progress
 *
 * Returns the authenticated producer's tier progress for the current plan period.
 * Computed on-the-fly from CommissionRecord totals (no materialized view).
 * Scout stub — returns 501 Not Implemented.
 *
 * Planned implementation notes:
 *   - SUM(gross_amount) over commission_records WHERE contributor_id = claims.user_id
 *     AND status NOT IN ('ClawbackInitiated', 'Recovered') for the current period.
 *   - Fetches tier thresholds from the active PlanVersion for the producer.
 *   - Returns { period_total, current_tier_rate, next_tier_threshold, next_tier_rate }.
 *   - Decision: on-the-fly aggregation is sufficient for MVP; see
 *     docs/architecture/phase-producer-portal.md §Tier Progress Approach.
 */
export function handleGetMyTierProgress(_claims: SessionClaims): Response {
  return notImplemented('Producer tier progress (on-the-fly aggregation) — not yet implemented');
}

// ---------------------------------------------------------------------------
// POST /me/disputes (stub)
// ---------------------------------------------------------------------------

/**
 * POST /me/disputes
 *
 * Opens a dispute against one of the producer's commission records.
 * Scout stub — returns 501 Not Implemented.
 *
 * Planned implementation notes:
 *   - Validates that the commission record belongs to claims.user_id and claims.org_id.
 *   - Reuses the existing exceptions table and workflow (handleCreateException).
 *   - Returns 201 with the created exception id on success.
 *   - No new storage required — disputes are exceptions with source='producer_dispute'.
 */
export function handleCreateMyDispute(_req: Request, _claims: SessionClaims): Response {
  return notImplemented('Producer dispute submission — not yet implemented');
}

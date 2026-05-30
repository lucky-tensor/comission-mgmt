/**
 * Producer Portal /me routes — stub integration seams.
 *
 * Dev-scout stub for Plan issue #26. No real behaviour is implemented here.
 * All handlers return 501 Not Implemented. Feature implementation is tracked
 * in downstream Producer Portal issues.
 *
 * Planned routes (501 stubs):
 *   GET  /me                        — producer identity + active plan summary
 *   GET  /me/commission-records     — producer-scoped payout records (period-filtered)
 *   GET  /me/tier-progress          — on-the-fly tier progress from CommissionRecord totals
 *   POST /me/disputes               — open a dispute against a commission record
 *
 * Integration seams discovered (see docs/architecture/phase-producer-portal.md):
 *   - Producer scoping uses SessionClaims.user_id to filter commission_records rows
 *     (contributor_id = user_id within the org). No new tables required beyond
 *     commission_records + plans + placements.
 *   - Tier progress: on-the-fly SUM(gross_amount) over commission_records for the
 *     current plan period. No materialized view or aggregation table needed for MVP;
 *     decision recorded in docs/architecture/phase-producer-portal.md §Tier Progress Approach.
 *   - Disputes route will share the existing exceptions table and workflow; no new
 *     storage required.
 *   - /me reads are subject to the same audit-log-first requirement (DATA-D-010) as
 *     all sensitive reads. The producer portal must write a commission_audit entry
 *     before returning payout data.
 *   - RBAC: only the Producer role may call /me routes. FinanceAdmin/Manager access
 *     to a specific producer's data goes through existing /placements and
 *     /commission-records routes, not /me.
 *
 * Canonical docs:
 *   - docs/prd.md §4 (Producer user stories), §5.3 (commission calculation), §5.4 (tier progress)
 *   - docs/architecture/phase-producer-portal.md — scout decision record
 *   - docs/architecture/decisions.md — ER diagram (commission_records, plans)
 *
 * Issue: dev-scout: stub Producer Portal integration seams (#26)
 */

import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Stubs
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

/**
 * GET /me/commission-records
 *
 * Returns commission records for the authenticated producer scoped to their
 * user_id and org_id. Supports optional period query parameters.
 * Scout stub — returns 501 Not Implemented.
 *
 * Planned implementation notes:
 *   - Queries commission_records WHERE contributor_id = claims.user_id
 *     AND org_id = claims.org_id, optionally filtered by period start/end.
 *   - Decrypts gross_amount and net_payable via FieldEncryptor before returning.
 *   - Writes a commission_audit entry before returning (audit-log-first, DATA-D-010).
 *   - Returns paginated JSON array of CommissionRecordRow.
 */
export function handleGetMyCommissionRecords(_req: Request, _claims: SessionClaims): Response {
  return notImplemented('Producer-scoped commission records listing — not yet implemented');
}

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

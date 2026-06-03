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
  auditSql as defaultAuditSql,
  listCommissionRecordsByContributor,
  listApprovedPayoutsByContributor,
  getPlacement,
  getTierProgressForProducer,
} from 'db/index';
import { getBillingPhase } from 'db/billing-phases';
import { handleCreateDispute } from './disputes';
import { sensitiveRead } from '../audit/sensitive-read';

// Roles that see unmasked placement data even when is_confidential=true.
const UNMASKED_ROLES = new Set(['FinanceAdmin', 'Manager']);

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
// GET /me — producer identity + active plan summary (stub)
// ---------------------------------------------------------------------------

/**
 * GET /me
 *
 * Returns the authenticated user's role and identity from session claims.
 * This minimal implementation satisfies the app-shell routing requirement
 * (issue #100) — every role can call this endpoint to learn their role
 * immediately post-login without a DB round-trip.
 *
 * The full producer identity + active plan summary (plan version metadata,
 * tier thresholds, display name from the users table) is tracked as a
 * separate planned enhancement.
 *
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
 */
export function handleGetMe(claims: SessionClaims): Response {
  return jsonResponse({
    user_id: claims.user_id,
    org_id: claims.org_id,
    role: claims.role,
  });
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
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get('status') ?? undefined;

  try {
    // Audit-before-read: a failed audit write denies the read (DATA-D-010).
    const records = await sensitiveRead(
      adb,
      {
        orgId: claims.org_id,
        actorId: claims.user_id,
        action: 'commission_record.list',
        entityType: 'commission_record',
        entityId: claims.user_id,
      },
      () => listCommissionRecordsByContributor(db, claims.org_id, claims.user_id, statusFilter),
    );
    // For phase-blocked records, enrich with phase info so producers can see
    // which phase is blocking their payout and why.
    const enrichedRecords = await Promise.all(
      records.map(async (r) => {
        let blockedPhase: { phase_name: string; blocking_invoice_id: string | null } | null = null;

        if (r.holdReason === 'held_pending_phase_invoice' && r.billingPhaseId) {
          try {
            const phase = await getBillingPhase(db, r.orgId, r.billingPhaseId);
            if (phase) {
              blockedPhase = {
                phase_name: phase.phaseName,
                blocking_invoice_id: phase.invoiceId,
              };
            }
          } catch {
            // Non-fatal — blocked_phase will be null
          }
        }

        return {
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
          billing_phase_id: r.billingPhaseId,
          blocked_phase: blockedPhase,
          explanation: r.explanation,
          approval_actor: r.approvalActor,
          approval_at: r.approvalAt,
          created_at: r.createdAt,
        };
      }),
    );

    return jsonResponse({ commission_records: enrichedRecords });
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
  auditSqlClient?: SqlClient,
): Promise<Response> {
  // RBAC: /me/payouts is a Producer self-service route. ExternalPartner and
  // other non-producer roles must not access internal payout data (PRD §5.11, §9).
  if (claims.role === 'ExternalPartner') {
    return errorResponse('Forbidden', 403);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  try {
    // Audit-before-read: a failed audit write denies the read (DATA-D-010).
    const records = await sensitiveRead(
      adb,
      {
        orgId: claims.org_id,
        actorId: claims.user_id,
        action: 'payout.list',
        entityType: 'commission_record',
        entityId: claims.user_id,
      },
      () => listApprovedPayoutsByContributor(db, claims.org_id, claims.user_id),
    );

    // Build a placement cache to avoid repeated lookups
    const placementCache = new Map<string, { isConfidential: boolean; jobTitle: string }>();
    for (const r of records) {
      if (!placementCache.has(r.placementId)) {
        try {
          const p = await getPlacement(db, r.placementId);
          if (p) {
            placementCache.set(r.placementId, {
              isConfidential: p.isConfidential,
              jobTitle: p.jobTitle,
            });
          }
        } catch {
          // Non-fatal — treat as non-confidential if lookup fails
        }
      }
    }

    const shouldMask = (placementId: string): boolean => {
      if (UNMASKED_ROLES.has(claims.role)) return false;
      return placementCache.get(placementId)?.isConfidential ?? false;
    };

    return jsonResponse({
      payouts: records.map((r) => {
        const masked = shouldMask(r.placementId);
        return {
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
          billing_phase_id: r.billingPhaseId,
          explanation: r.explanation,
          approval_actor: r.approvalActor,
          approval_at: r.approvalAt,
          created_at: r.createdAt,
          position_title: masked
            ? 'Confidential'
            : (placementCache.get(r.placementId)?.jobTitle ?? null),
          client_name: masked ? 'Confidential' : null,
        };
      }),
    });
  } catch (err: unknown) {
    console.error('[me/payouts] list error:', err);
    return errorResponse('Failed to retrieve payouts', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /me/tier-progress
// ---------------------------------------------------------------------------

/**
 * GET /me/tier-progress
 *
 * Returns the authenticated producer's tier progress for the current plan period.
 * Computed on-the-fly from CommissionRecord totals (no materialized view).
 *
 * Response shape:
 *   {
 *     plan_version_id,
 *     period_start,
 *     period_end,
 *     current_period_production,  — SUM(gross_amount) of Accrued/PendingApproval/Approved/Payable records
 *     current_tier_rate,          — the rate that applies to current production (decimal, e.g. 0.25)
 *     next_tier_threshold,        — threshold for the next tier, or null if at top tier
 *     remaining_to_next_tier      — next_tier_threshold − current_period_production, or null
 *   }
 *
 * Returns 404 if the producer has no active plan assignment.
 *
 * Isolation: scoped to claims.user_id — a Producer token cannot read another producer's
 * tier progress because the DB query is always filtered by producerId = claims.user_id.
 *
 * Canonical docs: docs/prd.md §4 (Producer user stories), §5.3
 * Issue: feat: producer tier progress display (#17)
 *
 * @param _req       - HTTP request (unused)
 * @param claims     - Session claims (org_id, user_id)
 * @param sqlClient  - Optional injectable SQL client for testing
 */
export async function handleGetMyTierProgress(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  try {
    const progress = await getTierProgressForProducer(db, claims.org_id, claims.user_id);

    if (progress === null) {
      return errorResponse('No active plan assignment found for this producer', 404);
    }

    return jsonResponse(progress);
  } catch (err: unknown) {
    console.error('[me/tier-progress] error:', err);
    return errorResponse('Failed to retrieve tier progress', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /me/disputes — delegate to handleCreateDispute (issue #18)
// ---------------------------------------------------------------------------

/**
 * POST /me/disputes
 *
 * Opens a dispute against one of the producer's commission records.
 * Delegates to the /disputes handler — the producer's user_id is automatically
 * used as submitted_by from the session claims.
 *
 * Required body: { commission_record_id, description }
 * Returns 201 with the created dispute on success.
 *
 * @param req    - HTTP request with JSON body
 * @param claims - Session claims (org_id, user_id)
 * @param sqlClient      - Optional injectable SQL client (for testing)
 * @param auditSqlClient - Optional injectable audit SQL client (for testing)
 */
export async function handleCreateMyDispute(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  return handleCreateDispute(req, claims, sqlClient, auditSqlClient);
}

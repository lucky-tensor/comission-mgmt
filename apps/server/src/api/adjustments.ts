/**
 * Refund and credit-memo adjustment ledger entry routes.
 *
 * Routes:
 *   POST /placements/:id/adjustments — Finance Admin posts a refund or credit-memo
 *                                      adjustment as an append-only ledger entry.
 *   GET  /placements/:id/adjustments — Finance Admin reads the full adjustment
 *                                      history (refunds, credit-memos, clawbacks,
 *                                      holdbacks) in one ordered view.
 *
 * Behaviour for POST:
 *   1. Validates adjustment_type is 'refund' or 'credit_memo'.
 *   2. Validates reason is present (non-empty string).
 *   3. Validates amount_delta is a non-zero number.
 *   4. Validates commission_record_id belongs to the placement and tenant.
 *   5. Inserts an append-only commission_record_adjustments row (never edits or
 *      deletes prior entries).
 *   6. Writes an AuditLogEntry (best-effort, non-fatal).
 *   Returns 201 with the created adjustment row.
 *
 * Behaviour for GET:
 *   Returns all adjustment entries (all reason_codes) for the placement in
 *   ascending adjusted_at order. Audit-before-read enforced (DATA-D-010).
 *
 * RBAC: Both endpoints require Finance Admin role.
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 *
 * Injectable sql (for testing): all handlers accept optional SqlClient args.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.4, §9 (Audit and Compliance)
 *                 docs/architecture/phase-finance-close.md — adjustment ledger pattern
 * Issue: feat: refund and credit-memo adjustment ledger entries (append-only) (#122)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import { getPlacement } from 'db/placements';
import {
  ADJUSTMENT_TYPES,
  createRefundCreditAdjustment,
  listPlacementAdjustments,
  type AdjustmentType,
} from 'db/adjustments';
import type { SessionClaims } from 'core/auth';
import { sensitiveRead } from '../audit/sensitive-read';

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
 * Write an AuditLogEntry (best-effort, non-fatal).
 */
async function writeAuditLog(
  adb: SqlClient,
  opts: {
    orgId: string;
    actorId: string;
    actorType: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeJson?: object;
    afterJson: object;
  },
): Promise<void> {
  try {
    await adb.unsafe(
      `
      INSERT INTO audit_log_entries (
        org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        opts.orgId,
        opts.actorId,
        opts.actorType,
        opts.action,
        opts.entityType,
        opts.entityId,
        (opts.beforeJson ?? {}) as never,
        opts.afterJson as never,
      ],
    );
  } catch (err: unknown) {
    console.error('[adjustments] audit log write failed (non-fatal):', err);
  }
}

/**
 * Verify that a commission_record belongs to the given placement and org.
 * Returns the commission_record row or null if not found / wrong tenant.
 */
async function getCommissionRecordForPlacement(
  db: SqlClient,
  orgId: string,
  placementId: string,
  commissionRecordId: string,
): Promise<{ id: string } | null> {
  const rows = await db.unsafe(
    `
    SELECT cr.id
    FROM commission_records cr
    WHERE cr.org_id = $1
      AND cr.placement_id = $2
      AND cr.id = $3
    `,
    [orgId, placementId, commissionRecordId],
  );
  if (!rows || rows.length === 0) return null;
  return rows[0] as unknown as { id: string };
}

// ---------------------------------------------------------------------------
// POST /placements/:id/adjustments
// ---------------------------------------------------------------------------

/**
 * POST /placements/:id/adjustments
 *
 * Posts a refund or credit-memo adjustment as an append-only ledger entry
 * on a commission record that belongs to the placement.
 *
 * Required body:
 *   {
 *     adjustment_type:       'refund' | 'credit_memo',
 *     commission_record_id:  string (UUID),
 *     amount_delta:          number (non-zero; negative for deductions),
 *     reason:                string (non-empty, required)
 *   }
 *
 * Returns 400 if:
 *   - adjustment_type is missing or invalid.
 *   - reason is missing or empty.
 *   - amount_delta is missing or zero.
 *   - commission_record_id is missing.
 *
 * Returns 403 if caller is not FinanceAdmin.
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 * Returns 422 if commission_record_id does not belong to this placement.
 *
 * @param placementId      - Placement UUID from path.
 * @param req              - HTTP request.
 * @param claims           - Session claims.
 * @param sqlClient        - Optional injectable SQL client.
 * @param auditSqlClient   - Optional injectable audit SQL client.
 */
export async function handlePostAdjustment(
  placementId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  if (claims.role !== 'FinanceAdmin') {
    return errorResponse('Forbidden: Finance Admin role required', 403);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (typeof body !== 'object' || body === null) {
    return errorResponse('Request body must be a JSON object', 400);
  }

  const typedBody = body as Record<string, unknown>;

  const adjustmentType = typedBody.adjustment_type as string | undefined;
  const commissionRecordId = typedBody.commission_record_id as string | undefined;
  const amountDelta = typedBody.amount_delta;
  const reason = typedBody.reason as string | undefined;

  // Validate adjustment_type
  if (!adjustmentType || !ADJUSTMENT_TYPES.includes(adjustmentType as AdjustmentType)) {
    return errorResponse(`adjustment_type must be one of: ${ADJUSTMENT_TYPES.join(', ')}`, 400);
  }

  // Validate reason (required, non-empty)
  if (!reason || reason.trim().length === 0) {
    return errorResponse('reason is required and must not be empty', 400);
  }

  // Validate amount_delta (required, non-zero number)
  if (typeof amountDelta !== 'number' || amountDelta === 0) {
    return errorResponse('amount_delta must be a non-zero number', 400);
  }

  // Validate commission_record_id
  if (!commissionRecordId || typeof commissionRecordId !== 'string') {
    return errorResponse('commission_record_id is required', 400);
  }

  try {
    // 1. Load placement — 404 if not found or wrong tenant
    const placement = await getPlacement(db, placementId);
    if (!placement || placement.orgId !== claims.org_id) {
      return errorResponse('Placement not found', 404);
    }

    // 2. Verify commission_record belongs to this placement and org — 422 if not
    const cr = await getCommissionRecordForPlacement(
      db,
      claims.org_id,
      placementId,
      commissionRecordId,
    );
    if (!cr) {
      return errorResponse('commission_record_id does not belong to this placement', 422);
    }

    // 3. Capture pre-insert state for append-only invariant verification (audit only)
    const existingRows = await db.unsafe(
      `
      SELECT id FROM commission_record_adjustments
      WHERE commission_record_id = $1
      ORDER BY adjusted_at ASC
      `,
      [commissionRecordId],
    );
    const existingIds = existingRows
      ? (existingRows as unknown as { id: string }[]).map((r) => r.id)
      : [];

    // 4. Insert the append-only ledger adjustment
    const adjustment = await createRefundCreditAdjustment(db, {
      orgId: claims.org_id,
      commissionRecordId,
      adjustmentType: adjustmentType as AdjustmentType,
      amountDelta,
      reason: reason.trim(),
      adjustedBy: claims.user_id,
    });

    // 5. Write audit log (best-effort, non-fatal)
    await writeAuditLog(adb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      actorType: 'FinanceAdmin',
      action: `adjustment.${adjustmentType}.posted`,
      entityType: 'commission_record_adjustment',
      entityId: adjustment.id,
      afterJson: {
        adjustment_id: adjustment.id,
        placement_id: placementId,
        commission_record_id: commissionRecordId,
        adjustment_type: adjustmentType,
        amount_delta: amountDelta,
        reason: reason.trim(),
        prior_adjustment_ids: existingIds,
      },
    });

    return jsonResponse(
      {
        id: adjustment.id,
        placement_id: placementId,
        commission_record_id: adjustment.commissionRecordId,
        adjustment_type: adjustment.reasonCode,
        amount_delta: adjustment.amountDelta,
        reason: adjustment.reason,
        adjusted_by: adjustment.adjustedBy,
        adjusted_at: adjustment.adjustedAt,
        recovered: adjustment.recovered,
      },
      201,
    );
  } catch (err: unknown) {
    console.error('[adjustments] post error:', err);
    return errorResponse('Failed to post adjustment', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /placements/:id/adjustments
// ---------------------------------------------------------------------------

/**
 * GET /placements/:id/adjustments
 *
 * Returns the full ordered adjustment-ledger history for a placement:
 * refund entries, credit-memo entries, clawback entries, holdback entries —
 * all in one chronological view.
 *
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 * Returns 200 with { placement_id, adjustments: [...] } (empty array if none).
 *
 * Audit-before-read is enforced (DATA-D-010).
 *
 * @param placementId      - Placement UUID from path.
 * @param claims           - Session claims.
 * @param sqlClient        - Optional injectable SQL client.
 * @param auditSqlClient   - Optional injectable audit SQL client.
 */
export async function handleGetPlacementAdjustments(
  placementId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  if (claims.role !== 'FinanceAdmin') {
    return errorResponse('Forbidden: Finance Admin role required', 403);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  try {
    const { placement, adjustments } = await sensitiveRead(
      adb,
      {
        orgId: claims.org_id,
        actorId: claims.user_id,
        action: 'adjustment_ledger.read',
        entityType: 'placement',
        entityId: placementId,
      },
      async () => {
        const pl = await getPlacement(db, placementId);
        if (!pl || pl.orgId !== claims.org_id) {
          return { placement: null, adjustments: [] };
        }
        const adjs = await listPlacementAdjustments(db, claims.org_id, placementId);
        return { placement: pl, adjustments: adjs };
      },
    );

    if (!placement) {
      return errorResponse('Placement not found', 404);
    }

    return jsonResponse({
      placement_id: placementId,
      adjustments: adjustments.map((a) => ({
        id: a.id,
        commission_record_id: a.commissionRecordId,
        clawback_event_id: a.clawbackEventId,
        adjustment_type: a.reasonCode,
        amount_delta: a.amountDelta,
        reason: a.reason,
        adjusted_by: a.adjustedBy,
        adjusted_at: a.adjustedAt,
        recovered: a.recovered,
      })),
    });
  } catch (err: unknown) {
    console.error('[adjustments] get error:', err);
    return errorResponse('Failed to retrieve adjustment ledger', 500);
  }
}

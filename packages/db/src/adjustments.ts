/**
 * DB access functions for refund and credit-memo adjustment ledger entries.
 *
 * Tables written:
 *   - commission_record_adjustments — append-only adjustment rows (reason_code IN ('refund', 'credit_memo'))
 *
 * The `clawback_event_id` is NULL for standalone refund/credit-memo adjustments
 * (not triggered by a clawback event).
 *
 * Canonical docs:
 *   - docs/prd.md §4 (Finance Admin), §5.4, §9 (Audit and Compliance)
 *   - docs/architecture/phase-finance-close.md — adjustment ledger pattern (§Seam 3)
 *
 * Issue: feat: refund and credit-memo adjustment ledger entries (append-only) (#122)
 */

import type { Sql } from 'postgres';

/** Accepts either a regular pool connection or a transaction connection. */
type SqlOrTx = Sql;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid adjustment types for refund and credit-memo entries. */
export const ADJUSTMENT_TYPES = ['refund', 'credit_memo'] as const;

/** Union type of all valid adjustment type codes. */
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export interface RefundCreditAdjustmentRow {
  id: string;
  orgId: string;
  commissionRecordId: string;
  clawbackEventId: string | null;
  amountDelta: string; // NUMERIC returned as string
  reasonCode: AdjustmentType;
  reason: string;
  adjustedBy: string;
  adjustedAt: Date;
  recovered: boolean;
}

export interface CreateRefundCreditAdjustmentInput {
  orgId: string;
  commissionRecordId: string;
  adjustmentType: AdjustmentType;
  amountDelta: number; // negative for deductions, positive for credits
  reason: string; // required human-readable explanation
  adjustedBy: string;
}

// ---------------------------------------------------------------------------
// createRefundCreditAdjustment — INSERT an append-only ledger adjustment row
// ---------------------------------------------------------------------------

/**
 * Inserts a commission_record_adjustments row for a refund or credit-memo.
 *
 * Adjustments are additive (append-only). net_payable is never destructively
 * overwritten; the effective net_payable is re-derived from the sum of all
 * adjustment rows (phase-finance-close.md §Seam 3).
 *
 * `clawback_event_id` is NULL for standalone refund/credit-memo adjustments.
 */
export async function createRefundCreditAdjustment(
  sql: SqlOrTx,
  input: CreateRefundCreditAdjustmentInput,
): Promise<RefundCreditAdjustmentRow> {
  const rows = await sql.unsafe(
    `
    INSERT INTO commission_record_adjustments (
      org_id, commission_record_id, clawback_event_id,
      amount_delta, reason_code, reason, adjusted_by
    ) VALUES ($1, $2, NULL, $3, $4, $5, $6)
    RETURNING id, org_id, commission_record_id, clawback_event_id,
              amount_delta, reason_code, reason, adjusted_by, adjusted_at, recovered
    `,
    [
      input.orgId,
      input.commissionRecordId,
      input.amountDelta,
      input.adjustmentType,
      input.reason,
      input.adjustedBy,
    ],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createRefundCreditAdjustment: insert returned no rows');
  }

  return mapAdjustmentRow(rows[0] as unknown as RawAdjustmentRow);
}

// ---------------------------------------------------------------------------
// listPlacementAdjustments — fetch all adjustment entries for a placement
// ---------------------------------------------------------------------------

/**
 * Returns all commission_record_adjustments rows for a placement in chronological
 * order, across all reason codes (clawback, holdback, refund, credit_memo, etc.).
 *
 * This is the generalised adjustment-ledger read used by GET /placements/:id/adjustments.
 * It returns a unified, append-only history so the Finance Admin UI can display all
 * adjustment types in one ordered view.
 *
 * Adjustments are joined via commission_records to scope by placement and tenant.
 */
export async function listPlacementAdjustments(
  sql: SqlOrTx,
  orgId: string,
  placementId: string,
): Promise<RefundCreditAdjustmentRow[]> {
  const rows = await sql.unsafe(
    `
    SELECT cra.id, cra.org_id, cra.commission_record_id, cra.clawback_event_id,
           cra.amount_delta, cra.reason_code, cra.reason, cra.adjusted_by,
           cra.adjusted_at, cra.recovered
    FROM commission_record_adjustments cra
    JOIN commission_records cr ON cr.id = cra.commission_record_id
    WHERE cr.org_id = $1
      AND cr.placement_id = $2
    ORDER BY cra.adjusted_at ASC, cra.id ASC
    `,
    [orgId, placementId],
  );

  if (!rows) return [];
  return (rows as unknown as RawAdjustmentRow[]).map(mapAdjustmentRow);
}

// ---------------------------------------------------------------------------
// Internal raw row types and mappers
// ---------------------------------------------------------------------------

interface RawAdjustmentRow {
  id: string;
  org_id: string;
  commission_record_id: string;
  clawback_event_id: string | null;
  amount_delta: string;
  reason_code: string;
  reason: string | null;
  adjusted_by: string;
  adjusted_at: Date;
  recovered: boolean;
}

function mapAdjustmentRow(row: RawAdjustmentRow): RefundCreditAdjustmentRow {
  return {
    id: row.id,
    orgId: row.org_id,
    commissionRecordId: row.commission_record_id,
    clawbackEventId: row.clawback_event_id ?? null,
    amountDelta: row.amount_delta,
    reasonCode: row.reason_code as AdjustmentType,
    reason: row.reason ?? '',
    adjustedBy: row.adjusted_by,
    adjustedAt: row.adjusted_at,
    recovered: row.recovered,
  };
}

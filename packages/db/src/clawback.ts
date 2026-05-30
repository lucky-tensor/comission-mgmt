/**
 * DB access functions for clawback and holdback event handling.
 *
 * Tables written:
 *   - clawback_events              — trigger event header row
 *   - commission_record_adjustments — negative ledger adjustments (additive, never destructive)
 *   - clawback_recovery_schedules  — installment recovery schedule for clawback rule
 *
 * Canonical docs:
 *   - docs/prd.md §5.6 — Guarantee Period and Clawback Rules
 *   - docs/architecture/phase-post-placement-risk.md — scout decision record
 *   - packages/core/clawback-ledger.ts — interface definition (issue scout stubs)
 *
 * Issue: feat: clawback and holdback event handling (#20)
 */

import type { Sql, TransactionSql } from 'postgres';
import type { ClawbackEventType, ClawbackRule } from 'core/clawback-ledger';

/** Accepts either a regular pool connection or a transaction connection. */
type SqlOrTx = Sql | TransactionSql;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClawbackEventRow {
  id: string;
  orgId: string;
  placementId: string;
  guaranteePeriodId: string;
  eventType: ClawbackEventType;
  rule: ClawbackRule;
  occurredAt: Date;
  triggeredBy: string;
  createdAt: Date;
}

export interface CommissionRecordAdjustmentRow {
  id: string;
  orgId: string;
  commissionRecordId: string;
  clawbackEventId: string | null;
  amountDelta: string; // NUMERIC returned as string
  reasonCode: string;
  adjustedBy: string;
  adjustedAt: Date;
  recovered: boolean;
}

export interface ClawbackRecoveryScheduleRow {
  id: string;
  orgId: string;
  clawbackEventId: string;
  commissionRecordId: string;
  clawbackAmount: string;
  installmentCount: number;
  installmentAmount: string;
  createdAt: Date;
}

export interface CreateClawbackEventInput {
  orgId: string;
  placementId: string;
  guaranteePeriodId: string;
  eventType: ClawbackEventType;
  rule: ClawbackRule;
  occurredAt: string; // ISO 8601
  triggeredBy: string;
}

export interface CreateAdjustmentInput {
  orgId: string;
  commissionRecordId: string;
  clawbackEventId: string;
  amountDelta: number; // negative for deductions
  reasonCode: ClawbackRule;
  adjustedBy: string;
}

export interface CreateRecoveryScheduleInput {
  orgId: string;
  clawbackEventId: string;
  commissionRecordId: string;
  clawbackAmount: number;
  installmentCount: number;
}

// ---------------------------------------------------------------------------
// createClawbackEvent — INSERT a clawback trigger event row
// ---------------------------------------------------------------------------

/**
 * Inserts a clawback_events row. Must be called inside the atomic transaction
 * that also transitions the guarantee period to Triggered.
 */
export async function createClawbackEvent(
  sql: SqlOrTx,
  input: CreateClawbackEventInput,
): Promise<ClawbackEventRow> {
  const rows = await sql.unsafe(
    `
    INSERT INTO clawback_events (
      org_id, placement_id, guarantee_period_id, event_type, rule,
      occurred_at, triggered_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, org_id, placement_id, guarantee_period_id,
              event_type, rule, occurred_at, triggered_by, created_at
    `,
    [
      input.orgId,
      input.placementId,
      input.guaranteePeriodId,
      input.eventType,
      input.rule,
      input.occurredAt,
      input.triggeredBy,
    ],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createClawbackEvent: insert returned no rows');
  }

  return mapClawbackEventRow(rows[0] as unknown as RawClawbackEventRow);
}

// ---------------------------------------------------------------------------
// triggerGuaranteePeriod — transition Active → Triggered atomically
// ---------------------------------------------------------------------------

/**
 * Transitions a guarantee period from Active to Triggered.
 * Must be called inside the atomic transaction.
 *
 * Returns null if the period is not found or is no longer Active
 * (idempotency / race-condition guard).
 */
export async function triggerGuaranteePeriod(
  sql: SqlOrTx,
  guaranteePeriodId: string,
  triggeredAt: string,
): Promise<boolean> {
  const rows = await sql.unsafe(
    `
    UPDATE guarantee_periods
    SET status       = 'Triggered',
        triggered_at = $2,
        resolved_at  = $2,
        resolution   = 'clawback_triggered'
    WHERE id = $1 AND status = 'Active'
    RETURNING id
    `,
    [guaranteePeriodId, triggeredAt],
  );

  return !!(rows && rows.length > 0);
}

// ---------------------------------------------------------------------------
// holdCommissionRecordsForClawback — transition Held records to ClawbackInitiated
// ---------------------------------------------------------------------------

/**
 * Transitions all Held commission_records for a placement that are held under
 * 'guarantee_hold' to ClawbackInitiated status.
 *
 * This marks them as subject to clawback recovery. Non-Held records that are
 * Payable or Approved are also transitioned so Finance Admin has visibility.
 *
 * Returns the number of records transitioned.
 */
export async function holdCommissionRecordsForClawback(
  sql: SqlOrTx,
  orgId: string,
  placementId: string,
): Promise<number> {
  const rows = await sql.unsafe(
    `
    UPDATE commission_records
    SET status      = 'ClawbackInitiated',
        hold_reason = 'clawback_hold'
    WHERE org_id       = $1
      AND placement_id = $2
      AND status IN ('Held', 'Payable', 'Accrued', 'PendingApproval')
    RETURNING id
    `,
    [orgId, placementId],
  );

  return rows ? rows.length : 0;
}

// ---------------------------------------------------------------------------
// listCommissionRecordsForPlacement — fetch records for adjustment posting
// ---------------------------------------------------------------------------

/**
 * Returns all commission_records for a placement, regardless of status.
 * Used to enumerate records that need ledger adjustments on clawback trigger.
 */
export async function listCommissionRecordIdsForPlacement(
  sql: SqlOrTx,
  orgId: string,
  placementId: string,
): Promise<{ id: string; contributorId: string }[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, contributor_id
    FROM commission_records
    WHERE org_id = $1 AND placement_id = $2
    ORDER BY created_at ASC
    `,
    [orgId, placementId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as { id: string; contributor_id: string }[]).map((r) => ({
    id: r.id,
    contributorId: r.contributor_id,
  }));
}

// ---------------------------------------------------------------------------
// createCommissionRecordAdjustment — INSERT a ledger adjustment entry
// ---------------------------------------------------------------------------

/**
 * Inserts a commission_record_adjustments row (negative for clawback/holdback).
 *
 * Adjustments are additive. net_payable is never destructively overwritten;
 * the effective net_payable is re-derived from the sum of all adjustments.
 * This matches the additive ledger pattern from phase-finance-close.md §Seam 3.
 */
export async function createCommissionRecordAdjustment(
  sql: SqlOrTx,
  input: CreateAdjustmentInput,
): Promise<CommissionRecordAdjustmentRow> {
  const rows = await sql.unsafe(
    `
    INSERT INTO commission_record_adjustments (
      org_id, commission_record_id, clawback_event_id,
      amount_delta, reason_code, adjusted_by
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, org_id, commission_record_id, clawback_event_id,
              amount_delta, reason_code, adjusted_by, adjusted_at, recovered
    `,
    [
      input.orgId,
      input.commissionRecordId,
      input.clawbackEventId,
      input.amountDelta,
      input.reasonCode,
      input.adjustedBy,
    ],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createCommissionRecordAdjustment: insert returned no rows');
  }

  return mapAdjustmentRow(rows[0] as unknown as RawAdjustmentRow);
}

// ---------------------------------------------------------------------------
// createClawbackRecoverySchedule — INSERT a recovery schedule row
// ---------------------------------------------------------------------------

/**
 * Inserts a clawback_recovery_schedules row.
 *
 * installment_amount = ROUND(clawback_amount / installment_count, 2)
 * (rounded to cents using standard half-up rounding).
 */
export async function createClawbackRecoverySchedule(
  sql: SqlOrTx,
  input: CreateRecoveryScheduleInput,
): Promise<ClawbackRecoveryScheduleRow> {
  const installmentAmount = (input.clawbackAmount / input.installmentCount).toFixed(2);

  const rows = await sql.unsafe(
    `
    INSERT INTO clawback_recovery_schedules (
      org_id, clawback_event_id, commission_record_id,
      clawback_amount, installment_count, installment_amount
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, org_id, clawback_event_id, commission_record_id,
              clawback_amount, installment_count, installment_amount, created_at
    `,
    [
      input.orgId,
      input.clawbackEventId,
      input.commissionRecordId,
      input.clawbackAmount,
      input.installmentCount,
      installmentAmount,
    ],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createClawbackRecoverySchedule: insert returned no rows');
  }

  return mapRecoveryScheduleRow(rows[0] as unknown as RawRecoveryScheduleRow);
}

// ---------------------------------------------------------------------------
// getClawbackStatusForPlacement — fetch trigger event + adjustments + schedules
// ---------------------------------------------------------------------------

/**
 * Returns the clawback event (if any) for a placement, along with its
 * ledger adjustments and recovery schedules.
 *
 * Used by GET /placements/:id/clawback.
 */
export interface ClawbackStatus {
  clawbackEvent: ClawbackEventRow | null;
  adjustments: CommissionRecordAdjustmentRow[];
  recoverySchedules: ClawbackRecoveryScheduleRow[];
}

export async function getClawbackStatusForPlacement(
  sql: SqlOrTx,
  orgId: string,
  placementId: string,
): Promise<ClawbackStatus> {
  // Fetch the most-recent clawback event for this placement
  const eventRows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, guarantee_period_id,
           event_type, rule, occurred_at, triggered_by, created_at
    FROM clawback_events
    WHERE org_id = $1 AND placement_id = $2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [orgId, placementId],
  );

  if (!eventRows || eventRows.length === 0) {
    return { clawbackEvent: null, adjustments: [], recoverySchedules: [] };
  }

  const clawbackEvent = mapClawbackEventRow(eventRows[0] as unknown as RawClawbackEventRow);

  // Fetch adjustments for this event
  const adjustmentRows = await sql.unsafe(
    `
    SELECT id, org_id, commission_record_id, clawback_event_id,
           amount_delta, reason_code, adjusted_by, adjusted_at, recovered
    FROM commission_record_adjustments
    WHERE clawback_event_id = $1
    ORDER BY adjusted_at ASC
    `,
    [clawbackEvent.id],
  );

  const adjustments = adjustmentRows
    ? (adjustmentRows as unknown as RawAdjustmentRow[]).map(mapAdjustmentRow)
    : [];

  // Fetch recovery schedules for this event
  const scheduleRows = await sql.unsafe(
    `
    SELECT id, org_id, clawback_event_id, commission_record_id,
           clawback_amount, installment_count, installment_amount, created_at
    FROM clawback_recovery_schedules
    WHERE clawback_event_id = $1
    ORDER BY created_at ASC
    `,
    [clawbackEvent.id],
  );

  const recoverySchedules = scheduleRows
    ? (scheduleRows as unknown as RawRecoveryScheduleRow[]).map(mapRecoveryScheduleRow)
    : [];

  return { clawbackEvent, adjustments, recoverySchedules };
}

// ---------------------------------------------------------------------------
// getProducerClawbackExposure — SUM of outstanding adjustments for a producer
// ---------------------------------------------------------------------------

/**
 * Returns the total outstanding clawback exposure (as a number) for a given producer.
 *
 * Computed as: SUM(amount_delta) for all unrecovered clawback/holdback adjustments
 * on commission_records belonging to this producer, across all placements in the org.
 *
 * Returns a negative value (money owed back) or 0 if no exposure.
 */
export async function getProducerClawbackExposure(
  sql: SqlOrTx,
  orgId: string,
  producerId: string,
): Promise<number> {
  const rows = await sql.unsafe(
    `
    SELECT COALESCE(SUM(cra.amount_delta), 0) AS total_exposure
    FROM commission_record_adjustments cra
    JOIN commission_records cr ON cr.id = cra.commission_record_id
    JOIN contributors c ON c.id = cr.contributor_id
    WHERE cr.org_id = $1
      AND c.producer_id = $2
      AND cra.reason_code IN ('clawback', 'holdback')
      AND cra.recovered = false
    `,
    [orgId, producerId],
  );

  if (!rows || rows.length === 0) return 0;
  return parseFloat((rows[0] as unknown as { total_exposure: string }).total_exposure) || 0;
}

// ---------------------------------------------------------------------------
// Internal raw row types and mappers
// ---------------------------------------------------------------------------

interface RawClawbackEventRow {
  id: string;
  org_id: string;
  placement_id: string;
  guarantee_period_id: string;
  event_type: string;
  rule: string;
  occurred_at: Date;
  triggered_by: string;
  created_at: Date;
}

function mapClawbackEventRow(row: RawClawbackEventRow): ClawbackEventRow {
  return {
    id: row.id,
    orgId: row.org_id,
    placementId: row.placement_id,
    guaranteePeriodId: row.guarantee_period_id,
    eventType: row.event_type as ClawbackEventType,
    rule: row.rule as ClawbackRule,
    occurredAt: row.occurred_at,
    triggeredBy: row.triggered_by,
    createdAt: row.created_at,
  };
}

interface RawAdjustmentRow {
  id: string;
  org_id: string;
  commission_record_id: string;
  clawback_event_id: string | null;
  amount_delta: string;
  reason_code: string;
  adjusted_by: string;
  adjusted_at: Date;
  recovered: boolean;
}

function mapAdjustmentRow(row: RawAdjustmentRow): CommissionRecordAdjustmentRow {
  return {
    id: row.id,
    orgId: row.org_id,
    commissionRecordId: row.commission_record_id,
    clawbackEventId: row.clawback_event_id,
    amountDelta: row.amount_delta,
    reasonCode: row.reason_code,
    adjustedBy: row.adjusted_by,
    adjustedAt: row.adjusted_at,
    recovered: row.recovered,
  };
}

interface RawRecoveryScheduleRow {
  id: string;
  org_id: string;
  clawback_event_id: string;
  commission_record_id: string;
  clawback_amount: string;
  installment_count: number;
  installment_amount: string;
  created_at: Date;
}

function mapRecoveryScheduleRow(row: RawRecoveryScheduleRow): ClawbackRecoveryScheduleRow {
  return {
    id: row.id,
    orgId: row.org_id,
    clawbackEventId: row.clawback_event_id,
    commissionRecordId: row.commission_record_id,
    clawbackAmount: row.clawback_amount,
    installmentCount: row.installment_count,
    installmentAmount: row.installment_amount,
    createdAt: row.created_at,
  };
}

/**
 * Clawback ledger adjustment interface — no-op stubs for the Post-Placement Risk phase.
 *
 * ## Purpose (dev-scout)
 * This file establishes the canonical interface for posting negative ledger adjustments to
 * CommissionRecords when a clawback event is triggered. No real adjustment logic is
 * implemented here; behaviour will be filled in by the clawback feature issue (#20).
 *
 * ## Canonical docs
 * - docs/prd.md §5.6  — Guarantee Period and Clawback Rules
 * - docs/prd.md §9    — Audit trail: "All changes must be permanently recorded — never
 *                        silently overwritten — with timestamp, actor, and reason"
 * - docs/architecture/phase-post-placement-risk.md — scout decision record
 * - docs/architecture/phase-finance-close.md §Seam 3 — exception ledger adjustment pattern
 *
 * ## Clawback event types (PRD §5.6)
 * candidate_departure, refund
 *
 * ## Clawback rules (PRD §5.6)
 * clawback, holdback, refund_credit, replacement_search
 *
 * ## Ledger adjustment pattern (integration seam)
 * Clawback adjustments follow the same additive ledger pattern established in
 * phase-finance-close.md §Seam 3: adjustments are posted as negative entries to a
 * commission_record_adjustments table, never silently overwriting net_payable. The
 * aggregate net_payable is re-derived from the sum of all adjustment entries.
 *
 * ## Integration seams discovered during scout
 * 1. `ClawbackLedgerAdjustment` shares the adjustment table with exception-workflow adjustments
 *    (phase-finance-close.md §Seam 3). The clawback feature issue (#20) must reuse or extend
 *    the `commission_record_adjustments` table, not introduce a separate table.
 * 2. `ClawbackTriggerEvent.placementId` must be within an active guarantee window (Guarantee.state
 *    = 'Active'). The feature issue must validate this before posting adjustments and return 422
 *    if the guarantee window has already expired.
 * 3. A payroll recovery schedule (installment_count × installment_amount) is generated
 *    alongside the ledger adjustment. The feature issue must persist the recovery schedule in a
 *    `clawback_recovery_schedules` table (or equivalent) and return it in the API response.
 * 4. The `GuaranteeState` transitions to `Triggered` atomically with the first ledger adjustment
 *    write. Both writes must be in the same Postgres transaction (see guarantee-state.ts §Seam 1).
 */

// ---------------------------------------------------------------------------
// ClawbackEventType — PRD §5.6 trigger event types
// ---------------------------------------------------------------------------

/**
 * Valid event types that can trigger a clawback within the guarantee window.
 *
 * Must be kept in sync with the `event_type` column on the clawback trigger records table.
 */
export const CLAWBACK_EVENT_TYPES = ['candidate_departure', 'refund'] as const;

/** Union type of all valid clawback event types. */
export type ClawbackEventType = (typeof CLAWBACK_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// ClawbackRule — PRD §5.6 applicable rules
// ---------------------------------------------------------------------------

/**
 * Valid clawback rules that can be applied to a triggered guarantee event.
 *
 * Must be kept in sync with the `rule` column on the clawback trigger records table.
 */
export const CLAWBACK_RULES = [
  'clawback',
  'holdback',
  'refund_credit',
  'replacement_search',
] as const;

/** Union type of all valid clawback rules. */
export type ClawbackRule = (typeof CLAWBACK_RULES)[number];

// ---------------------------------------------------------------------------
// ClawbackTriggerEvent — the trigger payload
// ---------------------------------------------------------------------------

/**
 * Payload representing a candidate departure or refund event within the guarantee window.
 *
 * The Finance Admin POST /placements/:id/guarantee/trigger endpoint accepts this shape.
 *
 * @stub — field set will be validated and possibly extended when the clawback feature
 *         issue (#20) is implemented.
 */
export interface ClawbackTriggerEvent {
  /** The placement to which the trigger event belongs. */
  placementId: string;
  /** Tenant / organisation scoping for multi-tenant isolation. */
  orgId: string;
  /** The type of event that triggered the guarantee condition. */
  eventType: ClawbackEventType;
  /** The rule to apply for this trigger event. */
  rule: ClawbackRule;
  /** ISO 8601 timestamp of the trigger event. */
  occurredAt: string;
  /** Actor (Finance Admin user ID) who recorded the trigger event. */
  triggeredBy: string;
}

// ---------------------------------------------------------------------------
// ClawbackLedgerAdjustment — the ledger entry shape
// ---------------------------------------------------------------------------

/**
 * A single negative ledger adjustment posted to a CommissionRecord as a result of a
 * clawback trigger event.
 *
 * Adjustments are additive entries — net_payable is re-derived from the sum of all
 * adjustment rows. Adjustments are never destructively applied to commission_records.
 *
 * @stub — field set will be validated and possibly extended when the clawback feature
 *         issue (#20) is implemented.
 * @see docs/architecture/phase-finance-close.md §Seam 3 for the adjustment ledger pattern
 */
export interface ClawbackLedgerAdjustment {
  /** The CommissionRecord this adjustment applies to. */
  commissionRecordId: string;
  /** The trigger event that caused this adjustment. */
  clawbackEventId: string;
  /** Negative dollar amount representing the clawback deduction (e.g. -1500.00). */
  amountDelta: number;
  /** Reason code for the adjustment, used in audit trail and producer-facing explanation. */
  reasonCode: ClawbackRule;
  /** Actor (Finance Admin user ID) who approved the adjustment. */
  adjustedBy: string;
  /** ISO 8601 timestamp when the adjustment was posted. */
  adjustedAt: string;
}

// ---------------------------------------------------------------------------
// ClawbackLedgerAdjuster interface — no-op stubs
// ---------------------------------------------------------------------------

/**
 * Interface for posting clawback ledger adjustments to CommissionRecords.
 *
 * All methods are no-op stubs. The clawback feature issue (#20) will provide the
 * concrete implementation. The worker task-types issue must define a task payload
 * that carries a `ClawbackTriggerEvent` to drive async clawback processing.
 *
 * @see docs/architecture/phase-post-placement-risk.md §Seam 1
 */
export interface ClawbackLedgerAdjuster {
  /**
   * Posts negative ledger adjustments to all CommissionRecords linked to the triggered placement.
   *
   * Real logic:
   *   1. Validate placement is inside an active guarantee window (Guarantee.state = 'Active').
   *   2. Load all commission_records for event.placementId.
   *   3. Compute clawback_amount per record based on the applicable clawback rule.
   *   4. Write negative ClawbackLedgerAdjustment entries to commission_record_adjustments table.
   *   5. Transition Guarantee.state to 'Triggered' in the same transaction.
   *   6. Generate a payroll recovery schedule if rule = 'clawback'.
   *   7. Write an AuditLogEntry for the trigger event and each adjustment.
   *
   * @stub — returns an empty array without any side-effects.
   */
  applyClawback(event: ClawbackTriggerEvent): Promise<ClawbackLedgerAdjustment[]>;

  /**
   * Returns the total outstanding clawback exposure for a given producer.
   *
   * Real logic: SUM(amountDelta) FROM commission_record_adjustments
   *   JOIN commission_records ON commissionRecordId
   *   WHERE producerId = $1 AND reasonCode IN ('clawback', 'holdback')
   *   AND recovered = false
   *
   * @stub — returns 0 without any DB reads.
   */
  getProducerClawbackExposure(producerId: string, orgId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// NoOpClawbackLedgerAdjuster — stub implementation
// ---------------------------------------------------------------------------

/**
 * No-op implementation of ClawbackLedgerAdjuster.
 *
 * Every method returns a safe default without performing any side-effects.
 * This implementation is the only one that should exist until the clawback feature
 * issue (#20) replaces the stub bodies.
 *
 * @stub — do not add real logic here; create a new implementing class in the feature issue.
 */
export class NoOpClawbackLedgerAdjuster implements ClawbackLedgerAdjuster {
  async applyClawback(_event: ClawbackTriggerEvent): Promise<ClawbackLedgerAdjustment[]> {
    // stub — no-op, returns empty array
    return [];
  }

  async getProducerClawbackExposure(_producerId: string, _orgId: string): Promise<number> {
    // stub — no-op, returns zero
    return 0;
  }
}

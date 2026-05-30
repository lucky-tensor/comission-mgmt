/**
 * CommissionRun state machine — no-op stubs for the Finance Close phase.
 *
 * ## Purpose (dev-scout)
 * This file establishes the canonical CommissionRun state enum and transition table so that
 * all four Finance Close feature issues (invoice tracking, commission run/review, exception
 * workflow, payroll export) share a single authoritative state definition. No real transition
 * logic is implemented here; behaviour will be filled in by the feature issues that own
 * each transition.
 *
 * ## Canonical docs
 * - docs/prd.md §5.4  — Approval and Exception Handling
 * - docs/prd.md §5.7  — Commission Close and Payroll Export
 * - docs/prd.md §6    — Commission (per participant) lifecycle:
 *     Accrued → Pending Approval → Approved → Held → Payable → Paid
 * - docs/architecture/phase-finance-close.md — scout decision record
 * - docs/architecture/decisions.md — ER diagram (commission_records, invoice states)
 *
 * ## CommissionRun lifecycle (PRD §5.4 and §5.7)
 * Open → Approved → Exported
 * "No commission amount reaches payroll without prior approval." (PRD §5.7)
 *
 * ## Integration seams discovered during scout
 * 1. All four Finance Close features (invoice tracking, commission run, exception workflow, payroll
 *    export) share and mutate the CommissionRun row. See phase-finance-close.md §Shared-file coupling.
 * 2. `CommissionRun.status` transitions must be idempotent — the worker may retry the same
 *    invoice-paid event; guards must check current state before attempting transition.
 * 3. `Approved → Exported` transition must be locked (SELECT FOR UPDATE) so that concurrent export
 *    requests do not produce duplicate payroll files.
 * 4. Invoice status changes (see invoice-trigger.ts) are the primary driver of CommissionRun
 *    re-evaluation — only invoice-paid events for placements in the run trigger recalculation.
 */

// ---------------------------------------------------------------------------
// CommissionRunState — PRD Finance Close lifecycle
// ---------------------------------------------------------------------------

/**
 * All valid CommissionRun lifecycle states as defined in PRD §5.4 and §5.7.
 *
 * - Open:     Run has been created; placements are being reviewed. Finance Admin
 *             can add/remove placements, and exceptions can be requested and resolved.
 * - Approved: All placements in the run have been reviewed and approved by a
 *             Finance Admin. No further edits to commission amounts are permitted.
 * - Exported: Payroll-ready export file has been generated and handed off to payroll.
 *             Terminal state — no transitions out.
 */
export const COMMISSION_RUN_STATES = ['Open', 'Approved', 'Exported'] as const;

/** Union type of all valid CommissionRun states. */
export type CommissionRunState = (typeof COMMISSION_RUN_STATES)[number];

// ---------------------------------------------------------------------------
// Transition table — no-op stubs
// ---------------------------------------------------------------------------

/**
 * Allowed transitions per source CommissionRun state.
 *
 * These entries are stubs only. Guards, Finance Admin identity checks, side-effects,
 * and DB writes will be implemented in the feature issues for each workflow step.
 *
 * @see docs/architecture/phase-finance-close.md §Transition Table
 * @stub — guard logic is not yet implemented.
 */
export const COMMISSION_RUN_TRANSITIONS: Record<CommissionRunState, readonly CommissionRunState[]> =
  {
    Open: ['Approved'],
    Approved: ['Exported'],
    Exported: [],
  };

/**
 * Returns true if a transition from `from` to `to` is permitted per the PRD lifecycle.
 *
 * @stub — guard logic (Finance Admin identity, all placements reviewed, exception queue empty,
 *         etc.) is not yet implemented. Feature issue must add guards before enabling transitions.
 */
export function canTransitionRun(from: CommissionRunState, to: CommissionRunState): boolean {
  return (COMMISSION_RUN_TRANSITIONS[from] as readonly string[]).includes(to);
}

// ---------------------------------------------------------------------------
// CommissionRun entity shape — stub
// ---------------------------------------------------------------------------

/**
 * Minimal CommissionRun entity shape for type-checking downstream stubs.
 *
 * @stub — real entity shape (including org_id tenancy, placement_ids, audit fields,
 *         and export_file_url) will be defined in the commission-run feature issue.
 */
export interface CommissionRun {
  /** Unique identifier for this commission run. */
  id: string;
  /** Tenant / organisation this run belongs to. */
  orgId: string;
  /** Current lifecycle state. */
  status: CommissionRunState;
  /** ISO 8601 timestamp when this run was created. */
  createdAt: string;
  /** ISO 8601 timestamp of the most recent state transition. */
  updatedAt: string;
}

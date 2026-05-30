/**
 * Guarantee period state machine — no-op stubs for the Post-Placement Risk phase.
 *
 * ## Purpose (dev-scout)
 * This file establishes the canonical guarantee state enum so that the guarantee tracking
 * feature, the clawback workflow, and the commission hold/release logic all share a single
 * authoritative definition. No real transition logic is implemented here; behaviour will be
 * filled in by the feature issues that own each workflow step.
 *
 * ## Canonical docs
 * - docs/prd.md §5.6  — Guarantee Period and Clawback Rules
 * - docs/prd.md §6    — Placement lifecycle: GuaranteeActive → GuaranteeExpired | ClawbackTriggered
 * - docs/architecture/phase-post-placement-risk.md — scout decision record
 *
 * ## PRD guarantee lifecycle (§5.6, §6)
 * Active → ExpiredClean  (guarantee window passes with no candidate departure)
 * Active → Triggered     (candidate departure or refund event within guarantee window)
 *
 * ## Integration seams discovered during scout
 * 1. `Guarantee.state` must stay in sync with the `GuaranteeActive → GuaranteeExpired |
 *    ClawbackTriggered` transitions on `PlacementState` (packages/core/placement-state.ts).
 *    The feature issue must advance both the Guarantee row and the Placement state atomically.
 * 2. The cron/event trigger decision (cron-based vs event-driven expiry scan) is documented in
 *    docs/architecture/phase-post-placement-risk.md §Decision 1.
 * 3. `guarantee_expiry_date = start_date + guarantee_period_days` must be stored on the
 *    Placement row. The feature issue (#19) must add these columns to the placements table.
 * 4. CommissionRecords held for the guarantee window must be released when `Guarantee.state`
 *    transitions to `ExpiredClean`. The feature issue must update commission_records in the
 *    same transaction that updates the guarantee row.
 */

// ---------------------------------------------------------------------------
// GuaranteeState — all 3 PRD lifecycle states
// ---------------------------------------------------------------------------

/**
 * All valid guarantee period lifecycle states as defined in PRD §5.6.
 *
 * Ordering reflects the primary happy-path sequence followed by alternate-path states.
 */
export const GUARANTEE_STATES = ['Active', 'ExpiredClean', 'Triggered'] as const;

/** Union type of all valid guarantee period states. */
export type GuaranteeState = (typeof GUARANTEE_STATES)[number];

// ---------------------------------------------------------------------------
// Transition table — no-op stubs
// ---------------------------------------------------------------------------

/**
 * Allowed transitions per source state.
 *
 * These entries are stubs only. Guards, side-effects, and DB writes will be
 * implemented in the feature issues that own each workflow step.
 *
 * @see docs/architecture/phase-post-placement-risk.md §Transition Table
 */
export const GUARANTEE_TRANSITIONS: Record<GuaranteeState, readonly GuaranteeState[]> = {
  Active: ['ExpiredClean', 'Triggered'],
  ExpiredClean: [],
  Triggered: [],
};

/**
 * Returns true if a transition from `from` to `to` is permitted per the PRD lifecycle.
 *
 * @stub — guard logic (guarantee window check, actor authorisation, etc.) is not yet implemented.
 */
export function canTransitionGuarantee(from: GuaranteeState, to: GuaranteeState): boolean {
  return (GUARANTEE_TRANSITIONS[from] as readonly string[]).includes(to);
}

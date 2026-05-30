/**
 * Placement lifecycle state machine — no-op stubs for the Placement and Attribution phase.
 *
 * ## Purpose (dev-scout)
 * This file establishes the canonical placement state enum and transition table so that
 * all downstream phase issues share a single authoritative definition. No real transition
 * logic is implemented here; behaviour will be filled in by the feature issues that own
 * each transition.
 *
 * ## Canonical docs
 * - docs/prd.md §6 Entity Lifecycle — Placement
 * - docs/architecture/phase-placement.md — scout decision record
 * - docs/architecture/decisions.md — ER diagram and data model decisions
 *
 * ## PRD lifecycle (verbatim, §6)
 * Created → Contributors Assigned → Pending Approval → Active → Invoiced → Collected
 *   → Guarantee Active → Guarantee Expired → Closed
 * Alternate: Active → Refunded | Disputed; Guarantee Active → Clawback Triggered
 *
 * ## Integration seams discovered during scout
 * 1. `PlacementStatus` is referenced in packages/db/src/placements.ts — kept in sync here.
 * 2. Transition guards will need to read `contributors` table completeness before advancing
 *    Created → ContributorsAssigned (see phase-placement.md §Risk 1).
 * 3. The approval workflow (ContributorsAssigned → PendingApproval → Active) couples placement
 *    state to the manager approval queue — both must be updated atomically (§Risk 2).
 * 4. CSV column mapping validation decision recorded in phase-placement.md §Decision 1.
 */

// ---------------------------------------------------------------------------
// PlacementState — all 12 PRD lifecycle states
// ---------------------------------------------------------------------------

/**
 * All valid placement lifecycle states as defined in PRD §6.
 *
 * Ordering reflects the primary happy-path sequence followed by alternate-path states.
 */
export const PLACEMENT_STATES = [
  'Created',
  'ContributorsAssigned',
  'PendingApproval',
  'Active',
  'Invoiced',
  'Collected',
  'GuaranteeActive',
  'GuaranteeExpired',
  'Closed',
  // Alternate paths
  'Refunded',
  'Disputed',
  'ClawbackTriggered',
] as const;

/** Union type of all valid placement states. */
export type PlacementState = (typeof PLACEMENT_STATES)[number];

// ---------------------------------------------------------------------------
// Transition table — no-op stubs
// ---------------------------------------------------------------------------

/**
 * Allowed transitions per source state.
 *
 * These entries are stubs only. Guards, side-effects, and DB writes will be
 * implemented in the feature issues for each workflow step.
 *
 * @see docs/architecture/phase-placement.md §Transition Table
 */
export const PLACEMENT_TRANSITIONS: Record<PlacementState, readonly PlacementState[]> = {
  Created: ['ContributorsAssigned'],
  ContributorsAssigned: ['PendingApproval'],
  PendingApproval: ['Active', 'ContributorsAssigned'],
  Active: ['Invoiced', 'Refunded', 'Disputed'],
  Invoiced: ['Collected'],
  Collected: ['GuaranteeActive', 'Closed'],
  GuaranteeActive: ['GuaranteeExpired', 'ClawbackTriggered'],
  GuaranteeExpired: ['Closed'],
  Closed: [],
  Refunded: ['Closed'],
  Disputed: ['Active', 'Closed'],
  ClawbackTriggered: ['Closed'],
};

/**
 * Returns true if a transition from `from` to `to` is permitted per the PRD lifecycle.
 *
 * @stub — guard logic (contributor completeness, approval actor, etc.) is not yet implemented.
 */
export function canTransition(from: PlacementState, to: PlacementState): boolean {
  return (PLACEMENT_TRANSITIONS[from] as readonly string[]).includes(to);
}

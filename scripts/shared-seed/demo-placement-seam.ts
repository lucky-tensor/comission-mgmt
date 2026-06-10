/**
 * Demo Polish — placement extension seam (scout stub).
 *
 * This module is the documented seam for the Demo Polish phase. Feature work
 * (#196) will populate `EXTRA_DEMO_PLACEMENTS` with realistic, heterogeneous
 * placements so the producer demo account shows non-zero, traceable commission
 * outcomes (tiered rates, collected payouts, manager-override splits, guarantee
 * holds, retained-search phases). This scout introduces the seam as a NO-OP:
 * the array is empty, so wiring it into `seedEncrypted` changes nothing yet.
 *
 * Why a seam (rather than editing encrypted.ts inline):
 *   - The Phase-2 seed (scripts/shared-seed/encrypted.ts) interleaves demo
 *     "lifecycle" placements with E2E fixture placements (PR-1, MG-*, FA-*,
 *     EP-1, EX-4). Those fixture placements depend on STABLE seeded identity
 *     IDs from tests/e2e/fixtures/ids.ts (SEEDED / CLOSE / PARTNER) and on the
 *     order in which commission runs are created and approved.
 *   - New demo placements MUST be additive and MUST NOT renumber, reorder, or
 *     alter any existing fixture placement, run, dispute, or invoice. The E2E
 *     suite asserts against the CLOSE / PARTNER fixture constants and against
 *     persona scoping — perturbing them breaks `bun run test:e2e`.
 *
 * Fixture-ID safety contract (read before adding placements in #196):
 *   1. NEVER change any value in tests/e2e/fixtures/ids.ts (SEEDED, CLOSE,
 *      PARTNER). The browser E2E bundle imports these and the seed writes them.
 *   2. New placements use fresh `crypto.randomUUID()` candidate/client IDs and
 *      reuse existing SEEDED.* producer/manager/partner IDs for contributors.
 *   3. Append new placements AFTER the existing E2E fixture sections in
 *      encrypted.ts (or via this seam, once wired). Do not insert between the
 *      numbered fixture blocks (§3–§12) — their relative ordering is load-bearing
 *      for run/approval/dispute state.
 *   4. Do not mutate the `SharedSeedFixture` return shape relied on by callers;
 *      add fields rather than rename/remove.
 *
 * Canonical docs:
 *   - docs/prd.md §5.1, §5.5 (collection gating, phase-level billing)
 *   - docs/demo-polish.md (this phase's data-seam contract)
 * Issue: dev-scout: Demo Polish phase branch and seed data seam (#200)
 * Downstream: feat: realistic non-zero demo commission data (#196)
 */

/**
 * Lifecycle status a seeded placement is flipped to after creation.
 *
 * Mirrors the inline `lifecycleStatuses` union used in encrypted.ts. Kept as a
 * string literal union (not an enum) so this module stays dependency-free and
 * safe to import from either the Bun seed side or tooling.
 */
export type DemoPlacementStatus =
  | 'Created'
  | 'Active'
  | 'Invoiced'
  | 'Collected'
  | 'GuaranteeActive'
  | 'GuaranteeExpired'
  | 'Closed'
  | 'ClawbackTriggered'
  | 'ContributorsAssigned';

/** A single contributor split on a demo placement. */
export interface DemoContributorDef {
  /** Must reference a SEEDED.* producer/manager/partner id (stable). */
  producerId: string;
  role: 'CandidateOwner' | 'ManagerOverride' | 'ExternalPartner';
  /** Fraction in [0, 1]. Splits across a placement should sum to 1.0. */
  splitPct: number;
}

/**
 * Declarative definition of an additive demo placement.
 *
 * #196 will translate these into the same `POST /placements` + status-flip +
 * contributor + calculate sequence already used in encrypted.ts. This scout
 * does not consume the shape at runtime — it only fixes the contract.
 */
export interface DemoPlacementDef {
  jobTitle: string;
  /** compensation_base, as a decimal string (encrypted server-side). */
  compensationBase: string;
  /** fee_amount, as a decimal string. */
  feeAmount: string;
  /** ISO date (YYYY-MM-DD). */
  startDate: string;
  /** guarantee_days, or null for none. */
  guaranteeDays: number | null;
  /** Lifecycle status to flip the placement to after creation. */
  status: DemoPlacementStatus;
  /** Contributor splits to attach. */
  contributors: DemoContributorDef[];
  /** Whether to invoke POST /placements/:id/calculate after seeding. */
  calculate: boolean;
}

/**
 * Additive demo placements. EMPTY in the scout — wiring this into the Phase-2
 * seed is therefore a no-op. #196 populates it.
 */
export const EXTRA_DEMO_PLACEMENTS: readonly DemoPlacementDef[] = [];

/**
 * Returns the additive demo placements to seed beyond the existing fixture set.
 *
 * Scout no-op: returns an empty list, so callers that loop over the result do
 * nothing. Provided now so #196 can fill `EXTRA_DEMO_PLACEMENTS` without also
 * having to change call sites.
 */
export function extraDemoPlacements(): readonly DemoPlacementDef[] {
  return EXTRA_DEMO_PLACEMENTS;
}

/**
 * Producer Portal API contract types — the JSON response shapes returned by the
 * `/me/*` producer endpoints (apps/server/src/api/me.ts).
 *
 * These are the single source of truth for the producer-facing surfaces. The web
 * portal imports them via `core/producer-portal` rather than redeclaring response
 * shapes per call site (ARCH-D-001: shared types flow only from packages/core).
 *
 * Field names are snake_case to match the wire format the server emits verbatim.
 *
 * Canonical docs:
 *   - docs/prd.md §5.9 — Producer Payout Portal
 *   - docs/architecture/phase-producer-portal.md
 * Issue: feat: Producer Portal UI + Vitest headless-Chromium browser/E2E harness (#78)
 */

/** A single commission record as returned by GET /me/commission-records. */
export interface CommissionRecord {
  id: string;
  org_id: string;
  placement_id: string;
  contributor_id: string;
  plan_version_id: string;
  /** Gross commission before holdback/net adjustments. Decimal string on the wire. */
  gross_commission: number | string;
  /** Net payable amount after holdback. Decimal string on the wire. */
  net_payable: number | string;
  /** Tier rate applied to this record (decimal, e.g. 0.25 = 25%). */
  tier_rate: number;
  /** Lifecycle status: Accrued | Held | PendingApproval | Approved | Payable | Paid. */
  status: string;
  /**
   * Producer-facing display status — always consistent with hold_reason.
   * Collection-gated → "Pending Collection"; guarantee-gated → "Held";
   * otherwise mirrors `status`. Corrects legacy records where status=Payable but
   * hold_reason=collection_gate (issue #222).
   */
  producer_display_status?: string;
  /** Reason a record is held, or null when not held. */
  hold_reason: string | null;
  billing_phase_id: string | null;
  /** Phase blocking the payout (name + invoice), or null. */
  blocked_phase: { phase_name: string; blocking_invoice_id: string | null } | null;
  /** Plain-language explanation of how the amount was derived. */
  explanation: string | null;
  approval_actor: string | null;
  approval_at: string | null;
  created_at: string;
  /**
   * Role/position title for the placement, or 'Confidential' when masked.
   * Optional: the portal leads each row with this instead of a UUID (#203).
   */
  position_title?: string | null;
}

/** GET /me/commission-records response envelope. */
export interface CommissionRecordsResponse {
  commission_records: CommissionRecord[];
}

/** A historical payout row as returned by GET /me/payouts. */
export interface Payout extends CommissionRecord {
  /** Position title for the placement, or 'Confidential' when masked. */
  position_title: string | null;
  /** Client name, or 'Confidential' when masked. */
  client_name: string | null;
}

/** GET /me/payouts response envelope. */
export interface PayoutsResponse {
  payouts: Payout[];
}

/** GET /me/tier-progress response shape (mirrors db TierProgressResult). */
export interface TierProgress {
  plan_version_id: string;
  period_start: string;
  period_end: string | null;
  /** Sum of qualifying gross production in the current period. */
  current_period_production: number;
  /** Tier rate applying to current production (decimal). */
  current_tier_rate: number;
  /** Threshold of the next tier, or null at the top tier. */
  next_tier_threshold: number | null;
  /** Remaining production to reach the next tier, or null at the top tier. */
  remaining_to_next_tier: number | null;
}

/** Request body for POST /me/disputes. */
export interface CreateDisputeRequest {
  commission_record_id: string;
  description: string;
}

/** A dispute as returned by POST /me/disputes (201) and GET /disputes. */
export interface Dispute {
  id: string;
  org_id: string;
  commission_record_id: string;
  submitted_by: string;
  description: string;
  /** Lifecycle state: Submitted | UnderReview | Resolved. */
  state: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  exception_id: string | null;
  created_at: string;
}

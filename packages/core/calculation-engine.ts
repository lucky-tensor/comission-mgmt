/**
 * Commission calculation engine interface — no-op stubs for the Commission Engine phase.
 *
 * ## Purpose (dev-scout)
 * This file establishes the canonical CalculationEngine interface and its five pipeline
 * methods so that all downstream phase issues (plan config, calculation, explainability,
 * collection gating, draw recovery) share a single typed contract. No real calculation
 * logic is implemented here; each method returns a typed zero/null value.
 *
 * ## Canonical docs
 * - docs/prd.md §5.3  — Commission Calculation
 * - docs/prd.md §5.5  — Collection and Invoice Tracking
 * - docs/prd.md §5.6  — Guarantee and Clawback Management
 * - docs/prd.md §6    — Commission (per participant) lifecycle:
 *     Accrued → Pending Approval → Approved → Held → Payable → Paid
 * - docs/architecture/phase-commission-engine.md — scout decision record
 * - docs/architecture/decisions.md — ER diagram (commission_records, plan_versions, draw_balances)
 * - docs/architecture.md §2 — "DIY" commission rules engine and draw recovery
 *
 * ## Calculation pipeline (PRD §5.3, verbatim)
 * "Calculations account for: percentage of gross fee or net fee income, tiers and thresholds,
 *  desk cost recovery, draw balance offset, manager overrides, team pool allocations, retainer
 *  milestone treatment, and holdback or clawback conditions."
 *
 * Pipeline order (input → output):
 *   1. calculateBase      — derive gross commissionable amount from fee and split pct
 *   2. applyTiers         — apply plan tier rate to base → tiered gross
 *   3. recoverDraw        — offset draw balance against tiered gross
 *   4. gateOnCollection   — hold amount if linked invoice is not yet collected
 *   5. applyGuaranteeHold — hold amount if placement is inside guarantee window
 *
 * ## Integration seams discovered during scout
 * 1. `CalculationEngine` will read plan rules from plan_versions.rules_snapshot (JSONB) — the
 *    plan config feature issue must define and document the rules_snapshot schema so the engine
 *    can parse it without guesswork.
 * 2. `applyTiers` needs the contributor's year-to-date gross to resolve retroactive tier
 *    thresholds. The calculation feature must either pass YTD as input or query commission_records
 *    directly. Decision recorded in phase-commission-engine.md §Decision 1.
 * 3. `recoverDraw` reads and mutates draw_balances.balance. The feature issue must wrap the
 *    read-modify-write in a Postgres SELECT FOR UPDATE to prevent double-recovery under
 *    concurrent payout runs.
 * 4. `gateOnCollection` reads invoices.status. Its trigger is an invoice event, not a
 *    user action — the worker (apps/worker) will enqueue a recalculation task when an
 *    invoice.status transitions to 'Paid' (integration seam with the DB seed invoice rows).
 * 5. `applyGuaranteeHold` reads guarantee_periods.guarantee_ends and .status. Its release
 *    trigger is also worker-driven (scheduled guarantee-expiry check task).
 * 6. Every pipeline stage must write a payout_explanation_lines row linking the delta to the
 *    plan_version_id, placement_id, and triggering event so PRD §9 explainability is met.
 */

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

/**
 * Inputs provided to the calculation pipeline for a single contributor on a single placement.
 *
 * These are the fields the engine reads; feature issues must supply all of them.
 * @stub — field set will be validated and possibly extended when the plan config issue merges.
 */
export interface CalculationInput {
  /** Org the calculation belongs to (multi-tenant isolation). */
  orgId: string;
  /** The contributor whose commission is being calculated. */
  contributorId: string;
  /** The placement this commission is derived from. */
  placementId: string;
  /**
   * The commissionable base amount, in dollars (e.g. gross fee or compensation_base
   * depending on the plan's fee_basis setting).
   */
  commissionableBase: number;
  /** The contributor's credit split as a decimal (0 < splitPct ≤ 1). */
  splitPct: number;
  /**
   * The active plan version's rules snapshot.
   * Schema is not yet defined — see phase-commission-engine.md §Decision 1.
   * @stub — typed as unknown until the plan-config feature issue defines this shape.
   */
  planRules: unknown;
  /**
   * Contributor's cumulative gross commission year-to-date (before this calculation),
   * needed for retroactive tier resolution.
   * @stub — sourced either from the caller or by a DB query; see phase-commission-engine.md §Seam 2.
   */
  ytdGross: number;
  /** True if the linked invoice is in 'Paid' status (collection gate). */
  invoiceCollected: boolean;
  /** True if the placement is currently inside an active guarantee window. */
  insideGuaranteeWindow: boolean;
  /**
   * Current draw balance for the producer associated with this contributor.
   * Positive value = outstanding draw that must be recovered before payout.
   */
  drawBalance: number;
}

/**
 * Intermediate result after `calculateBase`.
 * @stub — real implementation will also include plan_version_id and audit fields.
 */
export interface BaseResult {
  /** Gross commissionable amount credited to this contributor (commissionableBase × splitPct). */
  creditedBase: number;
}

/**
 * Intermediate result after `applyTiers`.
 * @stub
 */
export interface TieredResult {
  /** Gross commission amount after applying the plan's tier rate schedule to creditedBase. */
  tieredGross: number;
  /**
   * The tier rate applied (e.g. 0.25 = 25%).
   * Null when no tier matched (engine falls back to base rate or zero).
   */
  appliedRate: number | null;
}

/**
 * Intermediate result after `recoverDraw`.
 * @stub
 */
export interface DrawRecoveryResult {
  /** Amount remaining after draw balance offset. May be zero if draw exceeds tieredGross. */
  netAfterDraw: number;
  /** Amount deducted from the draw balance in this calculation. */
  drawDeducted: number;
}

/**
 * Final payable result — the amount available for payout after all pipeline stages.
 * @stub
 */
export interface PayableResult {
  /**
   * The net payable amount. Zero when gated by collection or guarantee hold.
   */
  netPayable: number;
  /**
   * True when the amount is being held because the linked invoice is not yet collected.
   */
  heldForCollection: boolean;
  /**
   * True when the amount is being held because the placement is inside the guarantee window.
   */
  heldForGuarantee: boolean;
}

// ---------------------------------------------------------------------------
// CalculationEngine interface
// ---------------------------------------------------------------------------

/**
 * The commission calculation pipeline interface.
 *
 * All five methods are no-op stubs returning typed zero values. The calculation feature
 * issue will replace each stub body with the real computation logic, but must not change
 * the method signatures.
 *
 * @see docs/architecture/phase-commission-engine.md
 */
export interface CalculationEngine {
  /**
   * Stage 1 — Derive the gross commissionable amount credited to this contributor.
   *
   * Real logic: commissionableBase × splitPct (validated 0 < splitPct ≤ 1).
   * @stub returns { creditedBase: 0 }
   */
  calculateBase(input: CalculationInput): Promise<BaseResult>;

  /**
   * Stage 2 — Apply the plan tier rate schedule to the credited base.
   *
   * Real logic: look up the rate tier whose threshold ≤ (ytdGross + creditedBase);
   * multiply creditedBase by that rate. Retroactive tiers re-apply the higher rate to
   * all prior YTD commission (plan-version dependent).
   * @stub returns { tieredGross: 0, appliedRate: null }
   */
  applyTiers(base: BaseResult, input: CalculationInput): Promise<TieredResult>;

  /**
   * Stage 3 — Offset the tiered gross against any outstanding draw balance.
   *
   * Real logic: drawDeducted = min(tieredGross, drawBalance);
   *             netAfterDraw = tieredGross − drawDeducted.
   * Must use SELECT FOR UPDATE on draw_balances to prevent concurrent double-recovery.
   * @stub returns { netAfterDraw: 0, drawDeducted: 0 }
   */
  recoverDraw(tiered: TieredResult, input: CalculationInput): Promise<DrawRecoveryResult>;

  /**
   * Stage 4 — Gate the payable amount on invoice collection status.
   *
   * Real logic: if !invoiceCollected, hold the full netAfterDraw amount (heldForCollection=true).
   * Release is triggered by a worker task when invoice.status → 'Paid'.
   * @stub returns { netPayable: 0, heldForCollection: false, heldForGuarantee: false }
   */
  gateOnCollection(recovery: DrawRecoveryResult, input: CalculationInput): Promise<PayableResult>;

  /**
   * Stage 5 — Apply a guarantee-period hold if the placement is inside the guarantee window.
   *
   * Real logic: if insideGuaranteeWindow, set heldForGuarantee=true and netPayable=0.
   * Release is triggered by a worker task when guarantee_periods.guarantee_ends < NOW().
   * @stub returns { netPayable: 0, heldForCollection: false, heldForGuarantee: false }
   */
  applyGuaranteeHold(payable: PayableResult, input: CalculationInput): Promise<PayableResult>;
}

// ---------------------------------------------------------------------------
// NoOpCalculationEngine — stub implementation
// ---------------------------------------------------------------------------

/**
 * No-op implementation of CalculationEngine.
 *
 * Every method returns a typed zero value without performing any calculation.
 * This implementation is the only one that should exist until the calculation
 * feature issue replaces the stub bodies.
 *
 * @stub — do not add real logic here; create a new implementing class in the feature issue.
 */
export class NoOpCalculationEngine implements CalculationEngine {
  async calculateBase(_input: CalculationInput): Promise<BaseResult> {
    return { creditedBase: 0 };
  }

  async applyTiers(_base: BaseResult, _input: CalculationInput): Promise<TieredResult> {
    return { tieredGross: 0, appliedRate: null };
  }

  async recoverDraw(_tiered: TieredResult, _input: CalculationInput): Promise<DrawRecoveryResult> {
    return { netAfterDraw: 0, drawDeducted: 0 };
  }

  async gateOnCollection(
    _recovery: DrawRecoveryResult,
    _input: CalculationInput,
  ): Promise<PayableResult> {
    return { netPayable: 0, heldForCollection: false, heldForGuarantee: false };
  }

  async applyGuaranteeHold(
    _payable: PayableResult,
    _input: CalculationInput,
  ): Promise<PayableResult> {
    return { netPayable: 0, heldForCollection: false, heldForGuarantee: false };
  }
}

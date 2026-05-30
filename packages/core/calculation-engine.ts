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

import { generateExplanation } from './explanation-engine.js';

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

// ---------------------------------------------------------------------------
// PlanRules — typed rules snapshot shape (issue #9 defines this schema)
// ---------------------------------------------------------------------------

export interface TierRule {
  /** Threshold amount (cumulative YTD gross) above which this rate applies. */
  threshold: number;
  /** Commission rate as a decimal fraction, e.g. 0.25 = 25%. */
  rate: number;
}

export interface PlanRulesSnapshot {
  /** Fee basis for calculating the commissionable base. */
  rate_type?: 'gross_fee' | 'net_fee_income';
  /** Base commission rate as a decimal fraction, e.g. 0.20 = 20%. */
  base_rate: number;
  /** Ordered tiers of progressive rates; thresholds must be strictly ascending. */
  tiers?: TierRule[];
  /** Desk cost recovery amount in dollars deducted before commission accrues. */
  desk_cost?: number;
  /** Draw recovery mode. */
  draw_recovery_mode?: 'none' | 'pro_rata' | 'first_dollar';
}

// ---------------------------------------------------------------------------
// CommissionCalculationEngine — real implementation
// ---------------------------------------------------------------------------

/**
 * Real implementation of the five-stage commission calculation pipeline.
 *
 * Pipeline order:
 *   1. calculateBase      — creditedBase = commissionableBase × splitPct
 *   2. applyTiers         — select tier rate based on ytdGross + creditedBase, then
 *                           subtract desk_cost from creditedBase before multiplying
 *   3. recoverDraw        — drawDeducted = min(tieredGross, drawBalance); netAfterDraw = tieredGross − drawDeducted
 *   4. gateOnCollection   — hold if invoiceCollected is false
 *   5. applyGuaranteeHold — hold if insideGuaranteeWindow is true
 *
 * Canonical docs: docs/prd.md §5.3, docs/architecture/phase-commission-engine.md
 * Issue: feat: commission calculation engine (#10)
 */
export class CommissionCalculationEngine implements CalculationEngine {
  /**
   * Stage 1 — creditedBase = commissionableBase × splitPct.
   * Validates that splitPct is in the range (0, 1].
   */
  async calculateBase(input: CalculationInput): Promise<BaseResult> {
    const { commissionableBase, splitPct } = input;

    if (splitPct <= 0 || splitPct > 1) {
      throw new Error(`calculateBase: splitPct must be in range (0, 1], got ${splitPct}`);
    }

    // Zero credited base is valid (e.g. zero commissionable base placement)
    const creditedBase = commissionableBase * splitPct;
    return { creditedBase };
  }

  /**
   * Stage 2 — Apply tier rate and desk cost deduction.
   *
   * Tier selection: find the highest-threshold tier whose threshold ≤ (ytdGross + creditedBase).
   * Falls back to base_rate when no tier matches or tiers are undefined.
   *
   * Desk cost: deducted from creditedBase before multiplying by rate.
   * If desk_cost ≥ creditedBase the result is 0.
   */
  async applyTiers(base: BaseResult, input: CalculationInput): Promise<TieredResult> {
    const rules = input.planRules as PlanRulesSnapshot | null | undefined;
    const { ytdGross } = input;
    const { creditedBase } = base;

    // Determine applicable rate
    let appliedRate: number | null = null;
    const baseRate = rules?.base_rate ?? 0;

    if (rules?.tiers && rules.tiers.length > 0) {
      // Select the tier with the highest threshold ≤ (ytdGross + creditedBase)
      const cumulativeProduction = ytdGross + creditedBase;
      let selectedTier: TierRule | null = null;

      for (const tier of rules.tiers) {
        if (cumulativeProduction >= tier.threshold) {
          if (selectedTier === null || tier.threshold > selectedTier.threshold) {
            selectedTier = tier;
          }
        }
      }

      appliedRate = selectedTier !== null ? selectedTier.rate : baseRate;
    } else {
      appliedRate = baseRate;
    }

    // Apply desk cost deduction before computing commission
    const deskCost = rules?.desk_cost ?? 0;
    const baseAfterDesk = Math.max(0, creditedBase - deskCost);
    const tieredGross = baseAfterDesk * (appliedRate ?? 0);

    return { tieredGross, appliedRate };
  }

  /**
   * Stage 3 — Draw balance offset.
   *
   * drawDeducted = min(tieredGross, drawBalance)
   * netAfterDraw = tieredGross − drawDeducted
   *
   * Note: In production the read-modify-write on draw_balances.balance must use
   * SELECT FOR UPDATE to prevent concurrent double-recovery (see phase-commission-engine.md §Seam 3).
   */
  async recoverDraw(tiered: TieredResult, input: CalculationInput): Promise<DrawRecoveryResult> {
    const { tieredGross } = tiered;
    const { drawBalance } = input;

    const drawDeducted = Math.min(tieredGross, Math.max(0, drawBalance));
    const netAfterDraw = tieredGross - drawDeducted;

    return { netAfterDraw, drawDeducted };
  }

  /**
   * Stage 4 — Collection gate.
   *
   * If the plan requires cash collection and the invoice is not yet collected,
   * the amount is held (status = Held, netPayable = 0).
   */
  async gateOnCollection(
    recovery: DrawRecoveryResult,
    input: CalculationInput,
  ): Promise<PayableResult> {
    const { netAfterDraw } = recovery;
    const { invoiceCollected } = input;

    if (!invoiceCollected) {
      return { netPayable: 0, heldForCollection: true, heldForGuarantee: false };
    }

    return { netPayable: netAfterDraw, heldForCollection: false, heldForGuarantee: false };
  }

  /**
   * Stage 5 — Guarantee-period hold.
   *
   * If the placement is inside an active guarantee window, the amount is held
   * (status = Held, netPayable = 0). Overrides any collection gate status already set.
   */
  async applyGuaranteeHold(
    payable: PayableResult,
    input: CalculationInput,
  ): Promise<PayableResult> {
    if (input.insideGuaranteeWindow) {
      return {
        netPayable: 0,
        heldForCollection: payable.heldForCollection,
        heldForGuarantee: true,
      };
    }

    return payable;
  }
}

// ---------------------------------------------------------------------------
// CommissionRecord — the output of a full pipeline run
// ---------------------------------------------------------------------------

export type CommissionRecordStatus = 'Accrued' | 'Held' | 'Payable';

export interface CommissionRecord {
  /** Gross commission amount before draw offset (tieredGross). */
  grossCommission: number;
  /** Net payable amount after draw offset (may be 0 when held). */
  netPayable: number;
  /** Draw amount deducted in this calculation. */
  drawDeducted: number;
  /** The tier rate applied (null when base_rate used without a tier match). */
  tierRate: number | null;
  /** Record status: Accrued when collected + no guarantee hold; Held otherwise; Payable post-approval. */
  status: CommissionRecordStatus;
  /** True when held due to unpaid invoice. */
  heldForCollection: boolean;
  /** True when held due to active guarantee window. */
  heldForGuarantee: boolean;
  /**
   * Plain-language explanation of this commission calculation.
   * Machine-generated from CommissionRecord fields per PRD §9 Explainability constraint.
   * Issue: feat: plain-language commission calculation explainability (#11)
   */
  explanation: string;
}

/**
 * Run the full five-stage pipeline for a single contributor and return a CommissionRecord.
 *
 * This is the primary entry point for the API handler.
 *
 * @param engine           - CalculationEngine implementation to use.
 * @param input            - All inputs for the calculation pipeline.
 * @param planVersionId    - Plan version ID for traceability in the explanation.
 * @param guaranteeExpiry  - ISO date string of the guarantee expiry (when inside window).
 * @returns                - A CommissionRecord with all computed fields including explanation.
 */
export async function runCalculationPipeline(
  engine: CalculationEngine,
  input: CalculationInput,
  planVersionId?: string,
  guaranteeExpiry?: string,
): Promise<CommissionRecord> {
  const base = await engine.calculateBase(input);
  const tiered = await engine.applyTiers(base, input);
  const recovery = await engine.recoverDraw(tiered, input);
  const gated = await engine.gateOnCollection(recovery, input);
  const final = await engine.applyGuaranteeHold(gated, input);

  let status: CommissionRecordStatus;
  if (final.heldForCollection || final.heldForGuarantee) {
    status = 'Held';
  } else {
    status = 'Accrued';
  }

  const deskCost = (input.planRules as { desk_cost?: number } | null)?.desk_cost ?? 0;
  const appliedRate = tiered.appliedRate ?? 0;
  const isTieredRate =
    tiered.appliedRate !== null &&
    tiered.appliedRate !== ((input.planRules as { base_rate?: number } | null)?.base_rate ?? 0);

  const explanation = generateExplanation({
    commissionableBase: input.commissionableBase,
    splitPct: input.splitPct,
    creditedBase: base.creditedBase,
    appliedRate,
    isTieredRate,
    grossCommission: tiered.tieredGross,
    deskCost,
    drawDeducted: recovery.drawDeducted,
    netPayable: final.netPayable,
    heldForCollection: final.heldForCollection,
    heldForGuarantee: final.heldForGuarantee,
    guaranteeExpiry,
    planVersionId: planVersionId ?? input.placementId,
    placementId: input.placementId,
  });

  return {
    grossCommission: tiered.tieredGross,
    netPayable: final.netPayable,
    drawDeducted: recovery.drawDeducted,
    tierRate: tiered.appliedRate,
    status,
    heldForCollection: final.heldForCollection,
    heldForGuarantee: final.heldForGuarantee,
    explanation,
  };
}

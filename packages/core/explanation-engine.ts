/**
 * Plain-language commission explanation engine.
 *
 * Generates a deterministic, human-readable explanation string from a
 * CommissionRecord's computed fields. The output is machine-generated from
 * the record's fields — not hand-authored — so producers understand their
 * payout without asking finance.
 *
 * ## Canonical docs
 * - docs/prd.md §9 — Explainability constraint
 *
 * ## Explanation structure (all scenarios):
 *   1. Credit sentence: split credit on the placement and the credited base amount.
 *   2. Rate sentence: tier rate or base rate applied, producing the gross commission.
 *   3. Desk cost sentence (when desk cost > 0): desk cost deducted from credited base.
 *   4. Draw sentence (when draw deducted > 0): draw recovery reducing net payable.
 *   5. Status sentence: payable amount or hold reason (collection gate / guarantee hold).
 *   6. Guarantee window sentence (when held for guarantee): expiry date.
 *   7. Traceability sentence: plan version ID and placement ID.
 *
 * ## Determinism guarantee
 * Given the same ExplanationInput, this function always returns the same string.
 * Currency formatting uses fixed 2-decimal representation (no locale rounding).
 *
 * Issue: feat: plain-language commission calculation explainability (#11)
 */

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/**
 * All fields required to produce a commission explanation.
 *
 * These are derived from CommissionRecord + CalculationInput at call time.
 */
export interface ExplanationInput {
  /** The fee amount on the placement (gross fee). */
  commissionableBase: number;
  /** The contributor's credit split as a decimal (e.g. 0.5 = 50%). */
  splitPct: number;
  /** Gross commissionable amount credited to this contributor (base × splitPct). */
  creditedBase: number;
  /** The tier or base rate applied (e.g. 0.20 = 20%). */
  appliedRate: number;
  /** Whether the rate came from a tier match (true) or the base rate (false). */
  isTieredRate: boolean;
  /** Gross commission amount before draw offset. */
  grossCommission: number;
  /** Desk cost deducted from credited base before rate was applied (0 when none). */
  deskCost: number;
  /** Draw amount deducted in this calculation (0 when no draw). */
  drawDeducted: number;
  /** Net payable amount after draw offset (may be 0 when held). */
  netPayable: number;
  /** True when held due to unpaid invoice. */
  heldForCollection: boolean;
  /** True when held due to active guarantee window. */
  heldForGuarantee: boolean;
  /**
   * ISO date string (YYYY-MM-DD) of the guarantee expiry date.
   * Required when heldForGuarantee is true.
   */
  guaranteeExpiry?: string;
  /** Plan version ID for traceability. */
  planVersionId: string;
  /** Placement ID for traceability. */
  placementId: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a dollar amount with 2 decimal places.
 * e.g. 15000 → "$15,000.00"
 */
function formatDollars(amount: number): string {
  const fixed = amount.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  // Add comma separators
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${intFormatted}.${decPart}`;
}

/**
 * Format a rate as a percentage string.
 * e.g. 0.20 → "20%", 0.125 → "12.5%"
 */
function formatRate(rate: number): string {
  const pct = rate * 100;
  // Avoid trailing zeros: 20.00% → "20%", 12.50% → "12.5%"
  const formatted = parseFloat(pct.toFixed(4)).toString();
  return `${formatted}%`;
}

/**
 * Format a split percentage for display.
 * e.g. 0.5 → "50%", 1.0 → "100%"
 */
function formatSplit(splitPct: number): string {
  const pct = splitPct * 100;
  const formatted = parseFloat(pct.toFixed(4)).toString();
  return `${formatted}%`;
}

// ---------------------------------------------------------------------------
// Main explanation generator
// ---------------------------------------------------------------------------

/**
 * Generate a plain-language explanation for a commission record.
 *
 * The returned string is deterministic: given the same input, it always
 * produces the same output. This makes it suitable for golden-file snapshot
 * testing.
 *
 * @param input - All fields needed to produce the explanation.
 * @returns A human-readable explanation string.
 */
export function generateExplanation(input: ExplanationInput): string {
  const sentences: string[] = [];

  // 1. Credit sentence
  sentences.push(
    `You received ${formatSplit(input.splitPct)} credit on a ${formatDollars(input.commissionableBase)} placement. ` +
      `Your credited base was ${formatDollars(input.creditedBase)}.`,
  );

  // 2. Desk cost sentence (when desk cost > 0)
  if (input.deskCost > 0) {
    const baseAfterDesk = Math.max(0, input.creditedBase - input.deskCost);
    sentences.push(
      `A desk cost of ${formatDollars(input.deskCost)} was deducted, leaving a commissionable base of ${formatDollars(baseAfterDesk)}.`,
    );
  }

  // 3. Rate sentence
  const rateLabel = input.isTieredRate ? 'tier rate' : 'base rate';
  sentences.push(
    `Your ${rateLabel} is ${formatRate(input.appliedRate)}, producing ${formatDollars(input.grossCommission)} gross commission.`,
  );

  // 4. Draw sentence (when draw deducted > 0)
  if (input.drawDeducted > 0) {
    sentences.push(
      `A draw recovery of ${formatDollars(input.drawDeducted)} was applied, reducing your net payable to ${formatDollars(input.netPayable)}.`,
    );
  }

  // 5. Status sentence
  if (input.heldForCollection && input.heldForGuarantee) {
    sentences.push(
      `Payment is pending client collection and is also held inside a guarantee window.`,
    );
  } else if (input.heldForCollection) {
    sentences.push(`Payment is pending client collection.`);
  } else if (input.heldForGuarantee) {
    sentences.push(`Payment is held inside a guarantee window.`);
  } else {
    sentences.push(`Your net payable is ${formatDollars(input.netPayable)}.`);
  }

  // 6. Guarantee window sentence (when held for guarantee)
  if (input.heldForGuarantee && input.guaranteeExpiry) {
    sentences.push(
      `The placement is inside a 90-day guarantee window until ${input.guaranteeExpiry}.`,
    );
  }

  // Note: planVersionId and placementId are retained as ExplanationInput fields for
  // audit traceability (accessible via API response metadata) but are intentionally
  // absent from the producer-facing explanation prose (issue #222).

  return sentences.join(' ');
}

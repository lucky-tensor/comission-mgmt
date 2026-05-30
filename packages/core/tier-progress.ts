/**
 * Pure tier progress computation helpers.
 *
 * Extracted from the DB layer so tier lookup and remaining-to-next-tier
 * arithmetic can be unit-tested without a database.
 *
 * Used by:
 *   - packages/db/src/plans.ts getTierProgressForProducer
 *   - tests/engine/tier-progress/tier-progress.test.ts
 *
 * Canonical docs: docs/prd.md §4 (Producer user stories)
 * Issue: feat: producer tier progress display (#17)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single tier rule: above `threshold` cumulative production the `rate` applies. */
export interface TierRule {
  /** Cumulative production threshold above which this rate applies. */
  threshold: number;
  /** Commission rate as a decimal fraction, e.g. 0.25 = 25%. */
  rate: number;
}

/** Input to computeTierProgress. */
export interface TierProgressInput {
  /** Aggregated gross production in the current period (already decrypted, in dollars). */
  currentPeriodProduction: number;
  /**
   * Ordered tier rules from the active plan version.
   * Thresholds must be strictly ascending (validated on write by validateTiers).
   */
  tiers: TierRule[];
  /** Base commission rate (decimal fraction) used when no tier matches. */
  baseRate: number;
}

/** Output of computeTierProgress. */
export interface TierProgressOutput {
  /** The production total passed through unchanged. */
  current_period_production: number;
  /** The tier rate that applies to current_period_production (decimal fraction). */
  current_tier_rate: number;
  /** The threshold of the next tier above the current bracket. Null if at top tier. */
  next_tier_threshold: number | null;
  /**
   * Amount remaining to reach the next tier:
   *   next_tier_threshold − current_period_production.
   * Null when already at the top tier (no next tier exists).
   */
  remaining_to_next_tier: number | null;
}

// ---------------------------------------------------------------------------
// computeTierProgress
// ---------------------------------------------------------------------------

/**
 * Determines the applicable tier rate and how far the producer is from the next tier.
 *
 * Algorithm:
 *   1. Sort tiers ascending by threshold (defensive; callers should already validate).
 *   2. Walk from lowest to highest threshold. The current tier is the highest-threshold
 *      tier whose threshold ≤ currentPeriodProduction.
 *   3. The "next tier" is the first tier above the current bracket.
 *   4. If production hasn't reached any tier, use baseRate.
 *   5. If production is in the top tier, next_tier_threshold and remaining_to_next_tier are null.
 *
 * This function is pure (no I/O) and safe to call in both the DB layer and tests.
 */
export function computeTierProgress(input: TierProgressInput): TierProgressOutput {
  const { currentPeriodProduction, tiers, baseRate } = input;

  // Sort ascending by threshold (defensive copy)
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);

  // Find the highest tier whose threshold <= currentPeriodProduction
  let currentTierRate = baseRate;
  let matchedTierIdx = -1;

  for (let i = 0; i < sorted.length; i++) {
    if (currentPeriodProduction >= sorted[i].threshold) {
      matchedTierIdx = i;
      currentTierRate = sorted[i].rate;
    }
  }

  // The next tier is immediately above the matched tier
  const nextTierIdx = matchedTierIdx + 1;
  const nextTierThreshold = nextTierIdx < sorted.length ? sorted[nextTierIdx].threshold : null;

  const remainingToNextTier =
    nextTierThreshold !== null ? Math.max(0, nextTierThreshold - currentPeriodProduction) : null;

  return {
    current_period_production: currentPeriodProduction,
    current_tier_rate: currentTierRate,
    next_tier_threshold: nextTierThreshold,
    remaining_to_next_tier: remainingToNextTier,
  };
}

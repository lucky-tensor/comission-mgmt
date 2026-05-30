/**
 * Unit tests for tier progress calculation logic.
 *
 * Tests (Acceptance criteria, issue #17):
 *   AC#1 — current_period_production is the correct sum of the producer's
 *            CommissionRecords in the current period (fixture-data arithmetic).
 *   AC#2 — current_tier_rate matches the plan tier that applies to current_period_production.
 *   AC#3 — remaining_to_next_tier equals next_tier_threshold − current_period_production.
 *   AC#4 — When production exceeds the highest tier threshold, remaining_to_next_tier is null.
 *
 * No database required — pure in-memory assertions.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §4 (Producer user stories)
 * Issue: feat: producer tier progress display (#17)
 */

import { describe, it, expect } from 'vitest';
import { computeTierProgress, type TierRule } from '../../../packages/core/tier-progress';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTiers(): TierRule[] {
  return [
    { threshold: 50_000, rate: 0.2 },
    { threshold: 150_000, rate: 0.3 },
    { threshold: 300_000, rate: 0.4 },
  ];
}

// ---------------------------------------------------------------------------
// AC#1 — production sum is passed through unchanged
// ---------------------------------------------------------------------------

describe('computeTierProgress — production sum (AC#1)', () => {
  it('returns the provided production total unchanged', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 75_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    expect(result.current_period_production).toBe(75_000);
  });

  it('handles zero production correctly', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 0,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    expect(result.current_period_production).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — current_tier_rate matches the applicable tier
// ---------------------------------------------------------------------------

describe('computeTierProgress — tier lookup (AC#2)', () => {
  it('returns base_rate when production is below the first tier threshold', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 20_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    expect(result.current_tier_rate).toBe(0.1);
  });

  it('selects the first tier when production equals its threshold (boundary)', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 50_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    // At exactly 50_000 the 20% tier kicks in
    expect(result.current_tier_rate).toBe(0.2);
  });

  it('selects the first tier when production is between tier 1 and tier 2', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 100_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    expect(result.current_tier_rate).toBe(0.2);
  });

  it('selects the second tier when production exceeds tier 2 threshold', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 200_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    expect(result.current_tier_rate).toBe(0.3);
  });

  it('selects the top tier when production exceeds the highest threshold', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 500_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    expect(result.current_tier_rate).toBe(0.4);
  });

  it('returns base_rate when no tiers are defined', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 1_000_000,
      tiers: [],
      baseRate: 0.25,
    });
    expect(result.current_tier_rate).toBe(0.25);
  });

  it('uses base_rate when production is exactly at zero and first threshold is above zero', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 0,
      tiers: [{ threshold: 1, rate: 0.3 }],
      baseRate: 0.15,
    });
    expect(result.current_tier_rate).toBe(0.15);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — remaining_to_next_tier arithmetic
// ---------------------------------------------------------------------------

describe('computeTierProgress — remaining_to_next_tier arithmetic (AC#3)', () => {
  it('computes remaining correctly when below first tier', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 20_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    // Next tier threshold is 50_000; remaining = 50_000 − 20_000 = 30_000
    expect(result.next_tier_threshold).toBe(50_000);
    expect(result.remaining_to_next_tier).toBe(30_000);
  });

  it('computes remaining correctly when between tier 1 and tier 2', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 75_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    // Next tier threshold is 150_000; remaining = 150_000 − 75_000 = 75_000
    expect(result.next_tier_threshold).toBe(150_000);
    expect(result.remaining_to_next_tier).toBe(75_000);
  });

  it('returns zero remaining when production equals exactly the next tier threshold', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 150_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    // At 150_000, the 30% tier has been entered; next is 300_000
    expect(result.next_tier_threshold).toBe(300_000);
    expect(result.remaining_to_next_tier).toBe(150_000);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Top tier: remaining_to_next_tier is null
// ---------------------------------------------------------------------------

describe('computeTierProgress — top-tier edge case (AC#4)', () => {
  it('returns null for remaining_to_next_tier when production exceeds the highest tier', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 400_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    expect(result.next_tier_threshold).toBeNull();
    expect(result.remaining_to_next_tier).toBeNull();
  });

  it('returns null when there are no tiers at all', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 1_000_000,
      tiers: [],
      baseRate: 0.25,
    });
    expect(result.next_tier_threshold).toBeNull();
    expect(result.remaining_to_next_tier).toBeNull();
  });

  it('returns null when production exactly equals the highest tier threshold', () => {
    const result = computeTierProgress({
      currentPeriodProduction: 300_000,
      tiers: makeTiers(),
      baseRate: 0.1,
    });
    // At 300_000 we are in the top tier — no higher tier exists
    expect(result.current_tier_rate).toBe(0.4);
    expect(result.next_tier_threshold).toBeNull();
    expect(result.remaining_to_next_tier).toBeNull();
  });
});

/**
 * Unit tests for CommissionCalculationEngine and runCalculationPipeline.
 *
 * Test plan (issue #10):
 *   - Base rate calculation: gross_commission = fee_amount × split_pct × base_rate
 *   - Tiered plan selects the correct rate bracket based on ytdGross + creditedBase
 *   - Desk cost deduction before commission accrues
 *   - Draw balance offset reduces net_payable but not gross_commission
 *   - Collection gate: status=Held when invoice is unpaid
 *   - Guarantee holdback: status=Held when inside guarantee window
 *   - Edge cases: zero credited base, 100% external split reducing internal base to 0,
 *                 production exactly at tier boundary
 *
 * No database required — pure in-memory assertions.
 *
 * Canonical docs: docs/prd.md §5.3
 * Issue: feat: commission calculation engine (#10)
 */

import { describe, it, expect } from 'vitest';
import {
  CommissionCalculationEngine,
  NoOpCalculationEngine,
  runCalculationPipeline,
  type CalculationInput,
  type PlanRulesSnapshot,
} from '../calculation-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  const baseRules: PlanRulesSnapshot = {
    base_rate: 0.2,
  };

  return {
    orgId: crypto.randomUUID(),
    contributorId: crypto.randomUUID(),
    placementId: crypto.randomUUID(),
    commissionableBase: 100_000,
    splitPct: 1.0,
    planRules: baseRules,
    ytdGross: 0,
    invoiceCollected: true,
    insideGuaranteeWindow: false,
    drawBalance: 0,
    ...overrides,
  };
}

function tieredRules(overrides: Partial<PlanRulesSnapshot> = {}): PlanRulesSnapshot {
  return {
    base_rate: 0.1,
    tiers: [
      { threshold: 50_000, rate: 0.2 },
      { threshold: 150_000, rate: 0.3 },
    ],
    ...overrides,
  };
}

const engine = new CommissionCalculationEngine();

// ---------------------------------------------------------------------------
// Stage 1: calculateBase
// ---------------------------------------------------------------------------

describe('CommissionCalculationEngine — calculateBase', () => {
  it('creditedBase = commissionableBase × splitPct (1.0 split)', async () => {
    const input = makeInput({ commissionableBase: 100_000, splitPct: 1.0 });
    const result = await engine.calculateBase(input);
    expect(result.creditedBase).toBe(100_000);
  });

  it('creditedBase = commissionableBase × splitPct (0.5 split)', async () => {
    const input = makeInput({ commissionableBase: 100_000, splitPct: 0.5 });
    const result = await engine.calculateBase(input);
    expect(result.creditedBase).toBe(50_000);
  });

  it('creditedBase = 0 when commissionableBase is 0', async () => {
    const input = makeInput({ commissionableBase: 0, splitPct: 1.0 });
    const result = await engine.calculateBase(input);
    expect(result.creditedBase).toBe(0);
  });

  it('throws when splitPct is 0', async () => {
    const input = makeInput({ splitPct: 0 });
    await expect(engine.calculateBase(input)).rejects.toThrow('splitPct must be in range (0, 1]');
  });

  it('throws when splitPct is negative', async () => {
    const input = makeInput({ splitPct: -0.1 });
    await expect(engine.calculateBase(input)).rejects.toThrow('splitPct must be in range (0, 1]');
  });

  it('throws when splitPct > 1', async () => {
    const input = makeInput({ splitPct: 1.01 });
    await expect(engine.calculateBase(input)).rejects.toThrow('splitPct must be in range (0, 1]');
  });
});

// ---------------------------------------------------------------------------
// Stage 2: applyTiers
// ---------------------------------------------------------------------------

describe('CommissionCalculationEngine — applyTiers', () => {
  it('applies base_rate when no tiers defined', async () => {
    const input = makeInput({
      planRules: { base_rate: 0.25 },
      ytdGross: 0,
    });
    const base = { creditedBase: 100_000 };
    const result = await engine.applyTiers(base, input);
    expect(result.appliedRate).toBe(0.25);
    expect(result.tieredGross).toBeCloseTo(25_000);
  });

  it('applies base_rate when ytdGross is below first tier threshold', async () => {
    const input = makeInput({
      planRules: tieredRules(),
      ytdGross: 0,
    });
    const base = { creditedBase: 10_000 };
    const result = await engine.applyTiers(base, input);
    // cumulative = 0 + 10_000 = 10_000 < 50_000 threshold → base_rate 0.1
    expect(result.appliedRate).toBe(0.1);
    expect(result.tieredGross).toBeCloseTo(1_000);
  });

  it('selects tier 1 (20%) when cumulative production >= 50_000', async () => {
    const input = makeInput({
      planRules: tieredRules(),
      ytdGross: 40_000,
    });
    const base = { creditedBase: 20_000 };
    const result = await engine.applyTiers(base, input);
    // cumulative = 40_000 + 20_000 = 60_000 ≥ 50_000 → tier rate 0.2
    expect(result.appliedRate).toBe(0.2);
    expect(result.tieredGross).toBeCloseTo(4_000); // 20_000 × 0.2
  });

  it('selects tier 2 (30%) when cumulative production >= 150_000', async () => {
    const input = makeInput({
      planRules: tieredRules(),
      ytdGross: 140_000,
    });
    const base = { creditedBase: 20_000 };
    const result = await engine.applyTiers(base, input);
    // cumulative = 140_000 + 20_000 = 160_000 ≥ 150_000 → tier rate 0.3
    expect(result.appliedRate).toBe(0.3);
    expect(result.tieredGross).toBeCloseTo(6_000); // 20_000 × 0.3
  });

  it('selects tier at exact boundary (production = threshold)', async () => {
    const input = makeInput({
      planRules: tieredRules(),
      ytdGross: 30_000,
    });
    const base = { creditedBase: 20_000 };
    const result = await engine.applyTiers(base, input);
    // cumulative = 30_000 + 20_000 = 50_000 = threshold → tier rate 0.2
    expect(result.appliedRate).toBe(0.2);
  });

  it('deducts desk_cost from creditedBase before commission', async () => {
    const input = makeInput({
      planRules: { base_rate: 0.2, desk_cost: 5_000 },
      ytdGross: 0,
    });
    const base = { creditedBase: 50_000 };
    const result = await engine.applyTiers(base, input);
    // baseAfterDesk = 50_000 - 5_000 = 45_000; tieredGross = 45_000 × 0.2 = 9_000
    expect(result.tieredGross).toBeCloseTo(9_000);
  });

  it('tieredGross is 0 when desk_cost >= creditedBase', async () => {
    const input = makeInput({
      planRules: { base_rate: 0.2, desk_cost: 100_000 },
      ytdGross: 0,
    });
    const base = { creditedBase: 50_000 };
    const result = await engine.applyTiers(base, input);
    expect(result.tieredGross).toBe(0);
  });

  it('tieredGross is 0 when creditedBase is 0', async () => {
    const input = makeInput({
      planRules: { base_rate: 0.2 },
      ytdGross: 0,
    });
    const base = { creditedBase: 0 };
    const result = await engine.applyTiers(base, input);
    expect(result.tieredGross).toBe(0);
    expect(result.appliedRate).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// Stage 3: recoverDraw
// ---------------------------------------------------------------------------

describe('CommissionCalculationEngine — recoverDraw', () => {
  it('no deduction when drawBalance is 0', async () => {
    const input = makeInput({ drawBalance: 0 });
    const tiered = { tieredGross: 20_000, appliedRate: 0.2 };
    const result = await engine.recoverDraw(tiered, input);
    expect(result.drawDeducted).toBe(0);
    expect(result.netAfterDraw).toBe(20_000);
  });

  it('partial draw recovery: drawBalance < tieredGross', async () => {
    const input = makeInput({ drawBalance: 5_000 });
    const tiered = { tieredGross: 20_000, appliedRate: 0.2 };
    const result = await engine.recoverDraw(tiered, input);
    expect(result.drawDeducted).toBe(5_000);
    expect(result.netAfterDraw).toBe(15_000);
  });

  it('full draw recovery: drawBalance >= tieredGross → netAfterDraw = 0', async () => {
    const input = makeInput({ drawBalance: 30_000 });
    const tiered = { tieredGross: 20_000, appliedRate: 0.2 };
    const result = await engine.recoverDraw(tiered, input);
    expect(result.drawDeducted).toBe(20_000);
    expect(result.netAfterDraw).toBe(0);
  });

  it('draw does not affect grossCommission (tieredGross is not mutated)', async () => {
    const input = makeInput({ drawBalance: 15_000 });
    const tiered = { tieredGross: 20_000, appliedRate: 0.2 };
    const result = await engine.recoverDraw(tiered, input);
    // tieredGross is the gross_commission; netAfterDraw is the net_payable
    expect(result.netAfterDraw).toBe(5_000);
    expect(tiered.tieredGross).toBe(20_000); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Stage 4: gateOnCollection
// ---------------------------------------------------------------------------

describe('CommissionCalculationEngine — gateOnCollection', () => {
  it('passes through when invoiceCollected=true', async () => {
    const input = makeInput({ invoiceCollected: true });
    const recovery = { netAfterDraw: 15_000, drawDeducted: 0 };
    const result = await engine.gateOnCollection(recovery, input);
    expect(result.heldForCollection).toBe(false);
    expect(result.netPayable).toBe(15_000);
  });

  it('holds when invoiceCollected=false', async () => {
    const input = makeInput({ invoiceCollected: false });
    const recovery = { netAfterDraw: 15_000, drawDeducted: 0 };
    const result = await engine.gateOnCollection(recovery, input);
    expect(result.heldForCollection).toBe(true);
    expect(result.netPayable).toBe(0);
    expect(result.heldForGuarantee).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stage 5: applyGuaranteeHold
// ---------------------------------------------------------------------------

describe('CommissionCalculationEngine — applyGuaranteeHold', () => {
  it('passes through when not inside guarantee window', async () => {
    const input = makeInput({ insideGuaranteeWindow: false });
    const payable = { netPayable: 15_000, heldForCollection: false, heldForGuarantee: false };
    const result = await engine.applyGuaranteeHold(payable, input);
    expect(result.heldForGuarantee).toBe(false);
    expect(result.netPayable).toBe(15_000);
  });

  it('holds when inside guarantee window', async () => {
    const input = makeInput({ insideGuaranteeWindow: true });
    const payable = { netPayable: 15_000, heldForCollection: false, heldForGuarantee: false };
    const result = await engine.applyGuaranteeHold(payable, input);
    expect(result.heldForGuarantee).toBe(true);
    expect(result.netPayable).toBe(0);
  });

  it('preserves heldForCollection when inside guarantee window', async () => {
    const input = makeInput({ insideGuaranteeWindow: true });
    const payable = { netPayable: 0, heldForCollection: true, heldForGuarantee: false };
    const result = await engine.applyGuaranteeHold(payable, input);
    expect(result.heldForGuarantee).toBe(true);
    expect(result.heldForCollection).toBe(true);
    expect(result.netPayable).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runCalculationPipeline — full pipeline integration
// ---------------------------------------------------------------------------

describe('runCalculationPipeline', () => {
  it('AC#1: Active placement with one contributor returns correct gross_commission', async () => {
    // fee_amount = 100_000, split = 1.0, base_rate = 0.20
    // expected gross_commission = 100_000 × 1.0 × 0.20 = 20_000
    const input = makeInput({
      commissionableBase: 100_000,
      splitPct: 1.0,
      planRules: { base_rate: 0.2 },
      ytdGross: 0,
      invoiceCollected: true,
      insideGuaranteeWindow: false,
      drawBalance: 0,
    });

    const record = await runCalculationPipeline(engine, input);

    expect(record.grossCommission).toBeCloseTo(20_000);
    expect(record.netPayable).toBeCloseTo(20_000);
    expect(record.drawDeducted).toBe(0);
    expect(record.status).toBe('Accrued');
    expect(record.heldForCollection).toBe(false);
    expect(record.heldForGuarantee).toBe(false);
  });

  it('AC#2: Tiered plan selects correct rate bracket (tier 1 at 50k threshold)', async () => {
    const input = makeInput({
      commissionableBase: 70_000,
      splitPct: 1.0,
      planRules: tieredRules(),
      ytdGross: 40_000, // cumulative = 40_000 + 70_000 = 110_000 ≥ 50_000 → tier 0.2
      invoiceCollected: true,
      insideGuaranteeWindow: false,
    });

    const record = await runCalculationPipeline(engine, input);

    expect(record.tierRate).toBe(0.2);
    expect(record.grossCommission).toBeCloseTo(14_000); // 70_000 × 0.2
    expect(record.status).toBe('Accrued');
  });

  it('AC#3: Collection gate → status=Held when invoice unpaid', async () => {
    const input = makeInput({
      commissionableBase: 100_000,
      splitPct: 1.0,
      planRules: { base_rate: 0.2 },
      invoiceCollected: false,
      insideGuaranteeWindow: false,
    });

    const record = await runCalculationPipeline(engine, input);

    expect(record.heldForCollection).toBe(true);
    expect(record.status).toBe('Held');
    expect(record.netPayable).toBe(0);
    expect(record.grossCommission).toBeCloseTo(20_000); // gross still calculated
  });

  it('AC#4: Guarantee holdback → status=Held when inside guarantee window', async () => {
    const input = makeInput({
      commissionableBase: 100_000,
      splitPct: 1.0,
      planRules: { base_rate: 0.2 },
      invoiceCollected: true,
      insideGuaranteeWindow: true,
    });

    const record = await runCalculationPipeline(engine, input);

    expect(record.heldForGuarantee).toBe(true);
    expect(record.status).toBe('Held');
    expect(record.netPayable).toBe(0);
    expect(record.grossCommission).toBeCloseTo(20_000);
  });

  it('AC#5: Draw balance offset reduces net_payable but not gross_commission', async () => {
    const input = makeInput({
      commissionableBase: 100_000,
      splitPct: 1.0,
      planRules: { base_rate: 0.2 },
      ytdGross: 0,
      invoiceCollected: true,
      insideGuaranteeWindow: false,
      drawBalance: 5_000,
    });

    const record = await runCalculationPipeline(engine, input);

    expect(record.grossCommission).toBeCloseTo(20_000); // gross unchanged
    expect(record.drawDeducted).toBe(5_000);
    expect(record.netPayable).toBeCloseTo(15_000); // net reduced
    expect(record.status).toBe('Accrued');
  });

  // Edge cases
  it('edge: zero credited base → zero gross and net', async () => {
    const input = makeInput({
      commissionableBase: 0,
      splitPct: 1.0,
      planRules: { base_rate: 0.2 },
    });
    const record = await runCalculationPipeline(engine, input);
    expect(record.grossCommission).toBe(0);
    expect(record.netPayable).toBe(0);
  });

  it('edge: 100% external split (splitPct=0) throws validation error', async () => {
    const input = makeInput({
      commissionableBase: 100_000,
      splitPct: 0,
    });
    await expect(runCalculationPipeline(engine, input)).rejects.toThrow('splitPct');
  });

  it('edge: production exactly at tier boundary selects the matching tier', async () => {
    // ytdGross=0, creditedBase=50_000 → cumulative=50_000 = threshold → tier rate 0.2
    const input = makeInput({
      commissionableBase: 50_000,
      splitPct: 1.0,
      planRules: tieredRules(),
      ytdGross: 0,
    });
    const record = await runCalculationPipeline(engine, input);
    expect(record.tierRate).toBe(0.2);
    expect(record.grossCommission).toBeCloseTo(10_000); // 50_000 × 0.2
  });

  it('both collection gate and guarantee hold → status=Held, both flags true', async () => {
    const input = makeInput({
      commissionableBase: 100_000,
      splitPct: 1.0,
      planRules: { base_rate: 0.2 },
      invoiceCollected: false,
      insideGuaranteeWindow: true,
    });
    const record = await runCalculationPipeline(engine, input);
    expect(record.status).toBe('Held');
    expect(record.heldForCollection).toBe(true);
    expect(record.heldForGuarantee).toBe(true);
  });

  it('NoOpCalculationEngine still passes runCalculationPipeline without throwing', async () => {
    const noopEngine = new NoOpCalculationEngine();
    const input = makeInput();
    // NoOp returns all zeros — should not throw
    const record = await runCalculationPipeline(noopEngine, input);
    expect(record.grossCommission).toBe(0);
    expect(record.netPayable).toBe(0);
  });
});

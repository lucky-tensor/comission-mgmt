/**
 * Unit tests for packages/core/calculation-engine.ts
 *
 * Verifies that:
 * 1. NoOpCalculationEngine compiles and can be instantiated.
 * 2. Each stub method returns the expected typed zero value (not undefined/null/error).
 * 3. No method throws for valid input.
 *
 * No database required — pure in-memory stub assertions.
 *
 * Test plan (issue #24):
 *   Stub test: each CalculationEngine method returns typed zero value when called with valid input
 */

import { describe, it, expect } from 'vitest';
import {
  NoOpCalculationEngine,
  type CalculationInput,
  type BaseResult,
  type TieredResult,
  type DrawRecoveryResult,
} from '../calculation-engine';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const STUB_INPUT: CalculationInput = {
  orgId: '00000000-0000-0000-0000-000000000001',
  contributorId: '20000000-0000-0000-0000-000000000001',
  placementId: '10000000-0000-0000-0000-000000000001',
  commissionableBase: 150_000,
  splitPct: 0.5,
  planRules: { tiers: [] },
  ytdGross: 20_000,
  invoiceCollected: true,
  insideGuaranteeWindow: false,
  drawBalance: 0,
};

const STUB_BASE: BaseResult = { creditedBase: 0 };
const STUB_TIERED: TieredResult = { tieredGross: 0, appliedRate: null };
const STUB_RECOVERY: DrawRecoveryResult = { netAfterDraw: 0, drawDeducted: 0 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NoOpCalculationEngine', () => {
  const engine = new NoOpCalculationEngine();

  it('can be instantiated without throwing', () => {
    expect(engine).toBeInstanceOf(NoOpCalculationEngine);
  });

  describe('calculateBase', () => {
    it('returns creditedBase of 0 (no-op)', async () => {
      const result = await engine.calculateBase(STUB_INPUT);
      expect(result.creditedBase).toBe(0);
    });

    it('does not throw for valid input', async () => {
      await expect(engine.calculateBase(STUB_INPUT)).resolves.not.toThrow();
    });
  });

  describe('applyTiers', () => {
    it('returns tieredGross of 0 (no-op)', async () => {
      const result = await engine.applyTiers(STUB_BASE, STUB_INPUT);
      expect(result.tieredGross).toBe(0);
    });

    it('returns appliedRate of null (no tier resolved by stub)', async () => {
      const result = await engine.applyTiers(STUB_BASE, STUB_INPUT);
      expect(result.appliedRate).toBeNull();
    });

    it('does not throw for valid input', async () => {
      await expect(engine.applyTiers(STUB_BASE, STUB_INPUT)).resolves.not.toThrow();
    });
  });

  describe('recoverDraw', () => {
    it('returns netAfterDraw of 0 (no-op)', async () => {
      const result = await engine.recoverDraw(STUB_TIERED, STUB_INPUT);
      expect(result.netAfterDraw).toBe(0);
    });

    it('returns drawDeducted of 0 (no-op)', async () => {
      const result = await engine.recoverDraw(STUB_TIERED, STUB_INPUT);
      expect(result.drawDeducted).toBe(0);
    });

    it('does not throw for valid input', async () => {
      await expect(engine.recoverDraw(STUB_TIERED, STUB_INPUT)).resolves.not.toThrow();
    });
  });

  describe('gateOnCollection', () => {
    it('returns netPayable of 0 (no-op)', async () => {
      const result = await engine.gateOnCollection(STUB_RECOVERY, STUB_INPUT);
      expect(result.netPayable).toBe(0);
    });

    it('returns heldForCollection: false (no-op)', async () => {
      const result = await engine.gateOnCollection(STUB_RECOVERY, STUB_INPUT);
      expect(result.heldForCollection).toBe(false);
    });

    it('returns heldForGuarantee: false (no-op)', async () => {
      const result = await engine.gateOnCollection(STUB_RECOVERY, STUB_INPUT);
      expect(result.heldForGuarantee).toBe(false);
    });

    it('does not throw for valid input', async () => {
      await expect(engine.gateOnCollection(STUB_RECOVERY, STUB_INPUT)).resolves.not.toThrow();
    });
  });

  describe('applyGuaranteeHold', () => {
    const STUB_PAYABLE = { netPayable: 0, heldForCollection: false, heldForGuarantee: false };

    it('returns netPayable of 0 (no-op)', async () => {
      const result = await engine.applyGuaranteeHold(STUB_PAYABLE, STUB_INPUT);
      expect(result.netPayable).toBe(0);
    });

    it('returns heldForGuarantee: false (no-op)', async () => {
      const result = await engine.applyGuaranteeHold(STUB_PAYABLE, STUB_INPUT);
      expect(result.heldForGuarantee).toBe(false);
    });

    it('returns heldForCollection: false (no-op)', async () => {
      const result = await engine.applyGuaranteeHold(STUB_PAYABLE, STUB_INPUT);
      expect(result.heldForCollection).toBe(false);
    });

    it('does not throw for valid input', async () => {
      await expect(engine.applyGuaranteeHold(STUB_PAYABLE, STUB_INPUT)).resolves.not.toThrow();
    });
  });
});

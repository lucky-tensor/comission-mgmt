/**
 * Unit tests for the commission explanation engine — issue #11 acceptance criteria.
 *
 * Test plan (issue #11):
 *   - Golden-file snapshot tests: for each of five fixture CommissionRecords
 *     (base_rate, tiered, desk_cost, collection_held, guarantee_held), assert
 *     explanation output matches tests/fixtures/explanation_{scenario}.txt
 *   - Explanation for a held record includes 'pending client collection' when
 *     status=Held and hold_reason=collection_gate
 *   - Explanation for a guarantee-held record includes the guarantee expiry date
 *   - Template produces deterministic output for the same input
 *   - Edge case: zero-payout record (draw fully offsets commission) mentions draw recovery
 *
 * No database required — pure in-memory assertions.
 *
 * Canonical docs: docs/prd.md §9 — Explainability constraint
 * Issue: feat: plain-language commission calculation explainability (#11)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateExplanation, type ExplanationInput } from '../explanation-engine';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(__dirname, '../../../tests/fixtures');

/**
 * Read a golden-file fixture. Returns null if the file does not exist yet
 * (first-run mode: the test will write the fixture and pass).
 */
function readFixture(scenario: string): string | null {
  const filePath = resolve(FIXTURES_DIR, `explanation_${scenario}.txt`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

/**
 * Write a golden-file fixture (used on first run to seed the files).
 */
function writeFixture(scenario: string, content: string): void {
  const filePath = resolve(FIXTURES_DIR, `explanation_${scenario}.txt`);
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Assert that the generated explanation matches the golden file.
 * On first run (file missing), writes the fixture and passes.
 * On subsequent runs, compares against the stored fixture.
 */
function assertGoldenFile(scenario: string, actual: string): void {
  const existing = readFixture(scenario);
  if (existing === null) {
    // First run: seed the fixture
    writeFixture(scenario, actual);
    return;
  }
  expect(actual).toBe(existing);
}

// ---------------------------------------------------------------------------
// Fixture inputs — five canonical scenarios
// ---------------------------------------------------------------------------

/** Scenario 1: base rate — simple case, no tiers, no draw, no holds */
const baseRateInput: ExplanationInput = {
  commissionableBase: 30_000,
  splitPct: 1.0,
  creditedBase: 30_000,
  appliedRate: 0.2,
  isTieredRate: false,
  grossCommission: 6_000,
  deskCost: 0,
  drawDeducted: 0,
  netPayable: 6_000,
  heldForCollection: false,
  heldForGuarantee: false,
  planVersionId: 'plan-v1-fixture',
  placementId: 'placement-1-fixture',
};

/** Scenario 2: tiered rate — tier matched above 50k threshold */
const tieredInput: ExplanationInput = {
  commissionableBase: 80_000,
  splitPct: 1.0,
  creditedBase: 80_000,
  appliedRate: 0.2,
  isTieredRate: true,
  grossCommission: 16_000,
  deskCost: 0,
  drawDeducted: 0,
  netPayable: 16_000,
  heldForCollection: false,
  heldForGuarantee: false,
  planVersionId: 'plan-v2-fixture',
  placementId: 'placement-2-fixture',
};

/** Scenario 3: desk cost — $5,000 desk cost deducted before commission */
const deskCostInput: ExplanationInput = {
  commissionableBase: 50_000,
  splitPct: 1.0,
  creditedBase: 50_000,
  appliedRate: 0.2,
  isTieredRate: false,
  grossCommission: 9_000, // (50000 - 5000) × 0.20 = 9000
  deskCost: 5_000,
  drawDeducted: 0,
  netPayable: 9_000,
  heldForCollection: false,
  heldForGuarantee: false,
  planVersionId: 'plan-v3-fixture',
  placementId: 'placement-3-fixture',
};

/** Scenario 4: collection_held — invoice not yet paid */
const collectionHeldInput: ExplanationInput = {
  commissionableBase: 30_000,
  splitPct: 1.0,
  creditedBase: 30_000,
  appliedRate: 0.2,
  isTieredRate: false,
  grossCommission: 6_000,
  deskCost: 0,
  drawDeducted: 0,
  netPayable: 0,
  heldForCollection: true,
  heldForGuarantee: false,
  planVersionId: 'plan-v4-fixture',
  placementId: 'placement-4-fixture',
};

/** Scenario 5: guarantee_held — inside guarantee window */
const guaranteeHeldInput: ExplanationInput = {
  commissionableBase: 30_000,
  splitPct: 1.0,
  creditedBase: 30_000,
  appliedRate: 0.2,
  isTieredRate: false,
  grossCommission: 6_000,
  deskCost: 0,
  drawDeducted: 0,
  netPayable: 0,
  heldForCollection: false,
  heldForGuarantee: true,
  guaranteeExpiry: '2025-08-15',
  planVersionId: 'plan-v5-fixture',
  placementId: 'placement-5-fixture',
};

// ---------------------------------------------------------------------------
// Golden-file snapshot tests
// ---------------------------------------------------------------------------

describe('generateExplanation — golden-file snapshot tests', () => {
  it('scenario: base_rate — matches golden fixture', () => {
    const result = generateExplanation(baseRateInput);
    assertGoldenFile('base_rate', result);
  });

  it('scenario: tiered — matches golden fixture', () => {
    const result = generateExplanation(tieredInput);
    assertGoldenFile('tiered', result);
  });

  it('scenario: desk_cost — matches golden fixture', () => {
    const result = generateExplanation(deskCostInput);
    assertGoldenFile('desk_cost', result);
  });

  it('scenario: collection_held — matches golden fixture', () => {
    const result = generateExplanation(collectionHeldInput);
    assertGoldenFile('collection_held', result);
  });

  it('scenario: guarantee_held — matches golden fixture', () => {
    const result = generateExplanation(guaranteeHeldInput);
    assertGoldenFile('guarantee_held', result);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criteria assertions (AC#2 — hold reason, AC#3 — guarantee expiry)
// ---------------------------------------------------------------------------

describe('generateExplanation — acceptance criteria', () => {
  it('AC#2: held record includes "pending client collection" when heldForCollection=true', () => {
    const result = generateExplanation(collectionHeldInput);
    expect(result).toContain('pending client collection');
  });

  it('AC#3: guarantee-held record includes the guarantee expiry date', () => {
    const result = generateExplanation(guaranteeHeldInput);
    expect(result).toContain('2025-08-15');
  });

  it('AC#4: deterministic — same input always produces same output', () => {
    const first = generateExplanation(baseRateInput);
    const second = generateExplanation(baseRateInput);
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Edge case: draw recovery producing zero payout
// ---------------------------------------------------------------------------

describe('generateExplanation — edge cases', () => {
  it('zero-payout record with draw recovery mentions draw recovery', () => {
    const input: ExplanationInput = {
      commissionableBase: 30_000,
      splitPct: 1.0,
      creditedBase: 30_000,
      appliedRate: 0.2,
      isTieredRate: false,
      grossCommission: 6_000,
      deskCost: 0,
      drawDeducted: 6_000, // Draw fully offsets commission
      netPayable: 0,
      heldForCollection: false,
      heldForGuarantee: false,
      planVersionId: 'plan-draw-fixture',
      placementId: 'placement-draw-fixture',
    };

    const result = generateExplanation(input);
    // Explanation must mention draw recovery
    expect(result).toContain('draw recovery');
    // Net payable is 0 after full draw offset
    expect(result).toContain('$0.00');
  });

  it('50% split produces correct credited base sentence', () => {
    const input: ExplanationInput = {
      commissionableBase: 30_000,
      splitPct: 0.5,
      creditedBase: 15_000,
      appliedRate: 0.2,
      isTieredRate: false,
      grossCommission: 3_000,
      deskCost: 0,
      drawDeducted: 0,
      netPayable: 3_000,
      heldForCollection: false,
      heldForGuarantee: false,
      planVersionId: 'plan-split-fixture',
      placementId: 'placement-split-fixture',
    };

    const result = generateExplanation(input);
    expect(result).toContain('50%');
    expect(result).toContain('$15,000.00');
  });

  it('both collection and guarantee holds mentioned together', () => {
    const input: ExplanationInput = {
      ...collectionHeldInput,
      heldForGuarantee: true,
      guaranteeExpiry: '2025-09-01',
    };

    const result = generateExplanation(input);
    expect(result).toContain('pending client collection');
    expect(result).toContain('guarantee window');
  });

  it('explanation contains plan_version_id and placement_id for traceability', () => {
    const result = generateExplanation(baseRateInput);
    expect(result).toContain('plan-v1-fixture');
    expect(result).toContain('placement-1-fixture');
  });
});

// ---------------------------------------------------------------------------
// runCalculationPipeline integration: CommissionRecord.explanation is populated
// ---------------------------------------------------------------------------

describe('CommissionRecord.explanation — populated by runCalculationPipeline', () => {
  it('explanation field is non-empty for a standard calculation', async () => {
    // Import here to avoid circular dependency at module level
    const { CommissionCalculationEngine, runCalculationPipeline } =
      await import('../calculation-engine');

    const engine = new CommissionCalculationEngine();
    const input = {
      orgId: crypto.randomUUID(),
      contributorId: crypto.randomUUID(),
      placementId: 'placement-pipeline-fixture',
      commissionableBase: 30_000,
      splitPct: 1.0,
      planRules: { base_rate: 0.2 },
      ytdGross: 0,
      invoiceCollected: true,
      insideGuaranteeWindow: false,
      drawBalance: 0,
    };

    const record = await runCalculationPipeline(
      engine,
      input,
      'plan-version-pipeline-fixture',
      undefined,
    );

    expect(record.explanation).toBeTruthy();
    expect(record.explanation.length).toBeGreaterThan(0);
    expect(record.explanation).toContain('$30,000.00');
    expect(record.explanation).toContain('$6,000.00');
    expect(record.explanation).toContain('plan-version-pipeline-fixture');
  });

  it('explanation mentions "pending client collection" when heldForCollection=true', async () => {
    const { CommissionCalculationEngine, runCalculationPipeline } =
      await import('../calculation-engine');

    const engine = new CommissionCalculationEngine();
    const input = {
      orgId: crypto.randomUUID(),
      contributorId: crypto.randomUUID(),
      placementId: 'placement-collection-fixture',
      commissionableBase: 30_000,
      splitPct: 1.0,
      planRules: { base_rate: 0.2 },
      ytdGross: 0,
      invoiceCollected: false,
      insideGuaranteeWindow: false,
      drawBalance: 0,
    };

    const record = await runCalculationPipeline(engine, input, 'plan-v-collection');

    expect(record.heldForCollection).toBe(true);
    expect(record.explanation).toContain('pending client collection');
  });

  it('explanation mentions guarantee expiry date when heldForGuarantee=true', async () => {
    const { CommissionCalculationEngine, runCalculationPipeline } =
      await import('../calculation-engine');

    const engine = new CommissionCalculationEngine();
    const input = {
      orgId: crypto.randomUUID(),
      contributorId: crypto.randomUUID(),
      placementId: 'placement-guarantee-fixture',
      commissionableBase: 30_000,
      splitPct: 1.0,
      planRules: { base_rate: 0.2 },
      ytdGross: 0,
      invoiceCollected: true,
      insideGuaranteeWindow: true,
      drawBalance: 0,
    };

    const record = await runCalculationPipeline(engine, input, 'plan-v-guarantee', '2025-08-15');

    expect(record.heldForGuarantee).toBe(true);
    expect(record.explanation).toContain('2025-08-15');
  });
});

/**
 * Demo Polish placement-seam stub tests — issue #200.
 *
 * Verifies the seam contract only (no DB, no server):
 *   - the seam module exports compile and are importable
 *   - the seam is currently a NO-OP (empty placement list)
 *   - the declarative shape is usable by #196 without changing call sites
 *
 * Canonical docs: docs/prd.md §5.1/§5.5, docs/demo-polish.md
 * Issue: dev-scout: Demo Polish phase branch and seed data seam (#200)
 */

import { describe, expect, test } from 'vitest';
import {
  EXTRA_DEMO_PLACEMENTS,
  extraDemoPlacements,
  type DemoPlacementDef,
} from '../../../scripts/shared-seed/demo-placement-seam';

describe('demo placement seam (scout no-op)', () => {
  test('EXTRA_DEMO_PLACEMENTS is empty — wiring it is a no-op', () => {
    expect(EXTRA_DEMO_PLACEMENTS).toEqual([]);
  });

  test('extraDemoPlacements() returns the empty seam list', () => {
    expect(extraDemoPlacements()).toEqual([]);
    expect(extraDemoPlacements()).toBe(EXTRA_DEMO_PLACEMENTS);
  });

  test('DemoPlacementDef shape is usable by downstream #196', () => {
    // Compile-time contract check expressed as a runtime example. This object is
    // NOT seeded — it only proves the declarative shape #196 will populate.
    const example: DemoPlacementDef = {
      jobTitle: 'Example (not seeded)',
      compensationBase: '120000',
      feeAmount: '30000',
      startDate: '2025-04-01',
      guaranteeDays: null,
      status: 'Collected',
      contributors: [{ producerId: 'placeholder', role: 'CandidateOwner', splitPct: 1.0 }],
      calculate: true,
    };
    const splitTotal = example.contributors.reduce((sum, c) => sum + c.splitPct, 0);
    expect(splitTotal).toBeCloseTo(1.0);
  });
});

/**
 * Demo Polish placement-seam contract tests — issues #200, #259/#260.
 *
 * Verifies the seam contract only (no DB, no server):
 *   - the seam module exports compile and are importable
 *   - the seam is now POPULATED with the 6 demo placement scenarios that
 *     #259/#260 added (collected / held / tiered / split / guarantee / retained)
 *   - extraDemoPlacements() returns that same populated list by identity
 *   - the declarative shape is usable by downstream seeding without changing
 *     call sites
 *
 * Canonical docs: docs/prd.md §5.1/§5.5, docs/demo-polish.md
 * Issue: dev-scout: Demo Polish phase branch and seed data seam (#200)
 * Issue: feat: realistic non-zero demo commission data (#259/#260)
 */

import { describe, expect, test } from 'vitest';
import {
  EXTRA_DEMO_PLACEMENTS,
  extraDemoPlacements,
  type DemoPlacementDef,
} from '../../../scripts/shared-seed/demo-placement-seam';

describe('demo placement seam (populated)', () => {
  test('EXTRA_DEMO_PLACEMENTS holds the 6 demo placement scenarios', () => {
    expect(EXTRA_DEMO_PLACEMENTS).toHaveLength(6);
    expect(EXTRA_DEMO_PLACEMENTS.map((p) => p.jobTitle)).toEqual([
      'Chief Technology Officer (Demo Collected)',
      'Head of Product (Demo Held)',
      'VP Engineering (Demo Tiered)',
      'Sales Director (Demo Split)',
      'General Counsel (Demo Guarantee)',
      'Chief Financial Officer (Demo Retained Search)',
    ]);
  });

  test('every demo placement satisfies the seam contract', () => {
    for (const placement of EXTRA_DEMO_PLACEMENTS) {
      expect(placement.jobTitle.length).toBeGreaterThan(0);
      expect(placement.compensationBase).toMatch(/^\d+$/);
      expect(placement.feeAmount).toMatch(/^\d+$/);
      expect(placement.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(placement.contributors.length).toBeGreaterThan(0);
      // Every contributor references a stable SEEDED.* producer id and a known role.
      for (const contributor of placement.contributors) {
        expect(contributor.producerId.length).toBeGreaterThan(0);
        expect(['CandidateOwner', 'ManagerOverride', 'ExternalPartner']).toContain(
          contributor.role,
        );
        expect(contributor.splitPct).toBeGreaterThan(0);
        expect(contributor.splitPct).toBeLessThanOrEqual(1);
      }
    }
  });

  test('extraDemoPlacements() returns the populated seam list by identity', () => {
    expect(extraDemoPlacements()).toEqual(EXTRA_DEMO_PLACEMENTS);
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

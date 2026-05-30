/**
 * Demo seed step 7 — Guarantee Periods.
 *
 * Creates 3 GuaranteePeriods:
 *   - Active (30 days remaining)
 *   - ExpiredClean
 *   - Triggered (clawback applied)
 *
 * risk_amount is encrypted via FieldEncryptor.
 * All entities carry deterministic UUIDs (ON CONFLICT DO NOTHING).
 */

import type { Sql } from 'postgres';
import { DEMO_ORG_ID } from './demo-users.js';
import { DEMO_PLACEMENTS, getDemoEncryptor } from './demo-placements.js';

// ---------------------------------------------------------------------------
// Deterministic guarantee period IDs
// ---------------------------------------------------------------------------

export const DEMO_GUARANTEES = {
  active: { id: 'dd070000-0000-0000-0000-000000000001' },
  expiredClean: { id: 'dd070000-0000-0000-0000-000000000002' },
  triggered: { id: 'dd070000-0000-0000-0000-000000000003' },
} as const;

export async function seedDemoGuarantees(sql: Sql): Promise<void> {
  const enc = await getDemoEncryptor();

  // Active guarantee — 30 days remaining from today (2026-05-30 + 30 = 2026-06-29)
  const activeRiskBuf = await enc.encrypt('guarantee_periods', 'risk_amount', '19500');
  await sql.unsafe(
    `
    INSERT INTO guarantee_periods (id, org_id, placement_id, guarantee_ends, status, risk_amount)
    VALUES (
      '${DEMO_GUARANTEES.active.id}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLACEMENTS.guaranteeActive.id}',
      '2026-06-29',
      'Active',
      $1
    )
    ON CONFLICT (id) DO NOTHING
    `,
    [activeRiskBuf],
  );

  // Expired clean — guarantee period ended without clawback
  const expiredRiskBuf = await enc.encrypt('guarantee_periods', 'risk_amount', '24000');
  await sql.unsafe(
    `
    INSERT INTO guarantee_periods (
      id, org_id, placement_id, guarantee_ends, status, risk_amount, resolved_at, resolution
    ) VALUES (
      '${DEMO_GUARANTEES.expiredClean.id}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLACEMENTS.guaranteeExpired.id}',
      '2025-12-29',
      'ExpiredClean',
      $1,
      '2025-12-29T00:00:00Z',
      'Candidate remained employed through full guarantee period.'
    )
    ON CONFLICT (id) DO NOTHING
    `,
    [expiredRiskBuf],
  );

  // Triggered — clawback was applied after early departure
  const triggeredRiskBuf = await enc.encrypt('guarantee_periods', 'risk_amount', '16500');
  await sql.unsafe(
    `
    INSERT INTO guarantee_periods (
      id, org_id, placement_id, guarantee_ends, status, risk_amount, triggered_at, resolved_at, resolution
    ) VALUES (
      '${DEMO_GUARANTEES.triggered.id}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLACEMENTS.clawback.id}',
      '2026-01-29',
      'Triggered',
      $1,
      '2025-12-15T00:00:00Z',
      '2025-12-20T00:00:00Z',
      'Candidate resigned within guarantee window; clawback of full fee initiated.'
    )
    ON CONFLICT (id) DO NOTHING
    `,
    [triggeredRiskBuf],
  );

  console.log(
    '[demo-seed] Step 7: demo guarantee periods seeded (Active, ExpiredClean, Triggered).',
  );
}

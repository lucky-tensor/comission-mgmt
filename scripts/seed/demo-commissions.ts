/**
 * Demo seed step 5 — Commission Records.
 *
 * Creates 8 CommissionRecord rows in mixed statuses:
 *   Accrued (2), Held (2), Payable (2), Paid (2)
 *
 * All net_payable and gross_amount fields are encrypted via FieldEncryptor.
 * All entities carry deterministic UUIDs (ON CONFLICT DO NOTHING).
 */

import type { Sql } from 'postgres';
import { DEMO_ORG_ID } from './demo-users.js';
import { DEMO_PLACEMENTS, getDemoEncryptor } from './demo-placements.js';
import { DEMO_CONTRIBUTORS } from './demo-contributors.js';
import { DEMO_PLANS } from './demo-plans.js';

// ---------------------------------------------------------------------------
// Deterministic commission record IDs
// ---------------------------------------------------------------------------

export const DEMO_COMMISSION_RECORDS = {
  accrued1: { id: 'dd050000-0000-0000-0000-000000000001' },
  accrued2: { id: 'dd050000-0000-0000-0000-000000000002' },
  held1: { id: 'dd050000-0000-0000-0000-000000000003' },
  held2: { id: 'dd050000-0000-0000-0000-000000000004' },
  payable1: { id: 'dd050000-0000-0000-0000-000000000005' },
  payable2: { id: 'dd050000-0000-0000-0000-000000000006' },
  paid1: { id: 'dd050000-0000-0000-0000-000000000007' },
  paid2: { id: 'dd050000-0000-0000-0000-000000000008' },
} as const;

interface CommissionRecordDef {
  id: string;
  placementId: string;
  contributorId: string;
  planVersionId: string;
  grossAmount: string;
  netPayable: string;
  tierRate: string | null;
  status: string;
  explanation: string;
}

const RECORDS: CommissionRecordDef[] = [
  {
    id: DEMO_COMMISSION_RECORDS.accrued1.id,
    placementId: DEMO_PLACEMENTS.active.id,
    contributorId: DEMO_CONTRIBUTORS.activeProducer.id,
    planVersionId: DEMO_PLANS.flatRate.planVersionId,
    grossAmount: '22500',
    netPayable: '15750',
    tierRate: '0.1500',
    status: 'Accrued',
    explanation: 'Flat 15% of $150k gross fee; placement still in guarantee window',
  },
  {
    id: DEMO_COMMISSION_RECORDS.accrued2.id,
    placementId: DEMO_PLACEMENTS.active.id,
    contributorId: DEMO_CONTRIBUTORS.activeManager.id,
    planVersionId: DEMO_PLANS.flatRate.planVersionId,
    grossAmount: '22500',
    netPayable: '6750',
    tierRate: '0.1500',
    status: 'Accrued',
    explanation: 'Manager 30% split of accrued commission on active placement',
  },
  {
    id: DEMO_COMMISSION_RECORDS.held1.id,
    placementId: DEMO_PLACEMENTS.guaranteeActive.id,
    contributorId: DEMO_CONTRIBUTORS.guaranteeActiveProducer.id,
    planVersionId: DEMO_PLANS.flatRate.planVersionId,
    grossAmount: '19500',
    netPayable: '19500',
    tierRate: '0.1500',
    status: 'Held',
    explanation:
      'Held during active guarantee period (90 days); released when guarantee expires clean',
  },
  {
    id: DEMO_COMMISSION_RECORDS.held2.id,
    placementId: DEMO_PLACEMENTS.invoiced.id,
    contributorId: DEMO_CONTRIBUTORS.invoicedProducer.id,
    planVersionId: DEMO_PLANS.flatRate.planVersionId,
    grossAmount: '26250',
    netPayable: '15750',
    tierRate: '0.1500',
    status: 'Held',
    explanation: 'Held pending invoice collection; will move to Payable once collected',
  },
  {
    id: DEMO_COMMISSION_RECORDS.payable1.id,
    placementId: DEMO_PLACEMENTS.collected.id,
    contributorId: DEMO_CONTRIBUTORS.collectedProducer.id,
    planVersionId: DEMO_PLANS.flatRate.planVersionId,
    grossAmount: '30000',
    netPayable: '15000',
    tierRate: '0.1500',
    status: 'Payable',
    explanation: 'Invoice collected; guarantee expired clean; approved for payroll',
  },
  {
    id: DEMO_COMMISSION_RECORDS.payable2.id,
    placementId: DEMO_PLACEMENTS.collected.id,
    contributorId: DEMO_CONTRIBUTORS.collectedPartner.id,
    planVersionId: DEMO_PLANS.tiered.planVersionId,
    grossAmount: '30000',
    netPayable: '6000',
    tierRate: '0.1800',
    status: 'Payable',
    explanation: 'External partner 20% split on collected placement; tiered rate applied',
  },
  {
    id: DEMO_COMMISSION_RECORDS.paid1.id,
    placementId: DEMO_PLACEMENTS.closed.id,
    contributorId: DEMO_CONTRIBUTORS.closedProducer.id,
    planVersionId: DEMO_PLANS.flatRate.planVersionId,
    grossAmount: '42000',
    netPayable: '21000',
    tierRate: '0.1800',
    status: 'Paid',
    explanation: 'Paid in Dec 2025 payroll run; placement fully closed',
  },
  {
    id: DEMO_COMMISSION_RECORDS.paid2.id,
    placementId: DEMO_PLACEMENTS.closed.id,
    contributorId: DEMO_CONTRIBUTORS.closedPartner.id,
    planVersionId: DEMO_PLANS.tiered.planVersionId,
    grossAmount: '42000',
    netPayable: '10500',
    tierRate: '0.1800',
    status: 'Paid',
    explanation: 'External partner paid in same payroll run as producer',
  },
];

export async function seedDemoCommissions(sql: Sql): Promise<void> {
  const enc = await getDemoEncryptor();

  for (const r of RECORDS) {
    const grossBuf = await enc.encrypt('commission_records', 'gross_amount', r.grossAmount);
    const netBuf = await enc.encrypt('commission_records', 'net_payable', r.netPayable);
    const tierClause = r.tierRate !== null ? r.tierRate : 'NULL';

    await sql.unsafe(
      `
      INSERT INTO commission_records (
        id, org_id, placement_id, contributor_id, plan_version_id,
        gross_amount, net_payable, tier_rate, status
      ) VALUES (
        '${r.id}', '${DEMO_ORG_ID}', '${r.placementId}', '${r.contributorId}', '${r.planVersionId}',
        $1, $2, ${tierClause}, '${r.status}'
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [grossBuf, netBuf],
    );
  }

  console.log(
    '[demo-seed] Step 5: demo commission records seeded (8 records: Accrued×2, Held×2, Payable×2, Paid×2).',
  );
}

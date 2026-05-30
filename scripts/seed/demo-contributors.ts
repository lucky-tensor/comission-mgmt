/**
 * Demo seed step 4 — Contributors & Contribution Splits.
 *
 * Creates 12 ContributionSplit rows linking placements to users
 * with roles and split percentages summing to 100%.
 * Includes ExternalPartner split on 2 placements.
 *
 * All entities carry deterministic UUIDs (ON CONFLICT DO NOTHING).
 */

import type { Sql } from 'postgres';
import { DEMO_ORG_ID, DEMO_USERS } from './demo-users.js';
import { DEMO_PLACEMENTS } from './demo-placements.js';

// ---------------------------------------------------------------------------
// Deterministic contributor IDs
// ---------------------------------------------------------------------------

export const DEMO_CONTRIBUTORS = {
  // Placement: active — 2 contributors (Producer 70%, Manager 30%)
  activeProducer: { id: 'dd040000-0000-0000-0000-000000000001' },
  activeManager: { id: 'dd040000-0000-0000-0000-000000000002' },

  // Placement: invoiced — 2 contributors (Producer 60%, Manager 40%)
  invoicedProducer: { id: 'dd040000-0000-0000-0000-000000000003' },
  invoicedManager: { id: 'dd040000-0000-0000-0000-000000000004' },

  // Placement: collected — 3 contributors (Producer 50%, Manager 30%, ExternalPartner 20%)
  collectedProducer: { id: 'dd040000-0000-0000-0000-000000000005' },
  collectedManager: { id: 'dd040000-0000-0000-0000-000000000006' },
  collectedPartner: { id: 'dd040000-0000-0000-0000-000000000007' },

  // Placement: closed — 3 contributors (Producer 50%, Manager 25%, ExternalPartner 25%)
  closedProducer: { id: 'dd040000-0000-0000-0000-000000000008' },
  closedManager: { id: 'dd040000-0000-0000-0000-000000000009' },
  closedPartner: { id: 'dd040000-0000-0000-0000-000000000010' },

  // Placement: guaranteeActive — 1 contributor (Producer 100%)
  guaranteeActiveProducer: { id: 'dd040000-0000-0000-0000-000000000011' },

  // Placement: clawback — 1 contributor (Producer 100%)
  clawbackProducer: { id: 'dd040000-0000-0000-0000-000000000012' },
} as const;

interface ContributorRow {
  id: string;
  placementId: string;
  producerId: string;
  roleCode: string;
  splitPct: string;
}

const CONTRIBUTORS: ContributorRow[] = [
  // Active placement
  {
    id: DEMO_CONTRIBUTORS.activeProducer.id,
    placementId: DEMO_PLACEMENTS.active.id,
    producerId: DEMO_USERS.producer.id,
    roleCode: 'producer',
    splitPct: '0.7000',
  },
  {
    id: DEMO_CONTRIBUTORS.activeManager.id,
    placementId: DEMO_PLACEMENTS.active.id,
    producerId: DEMO_USERS.manager.id,
    roleCode: 'manager',
    splitPct: '0.3000',
  },
  // Invoiced placement
  {
    id: DEMO_CONTRIBUTORS.invoicedProducer.id,
    placementId: DEMO_PLACEMENTS.invoiced.id,
    producerId: DEMO_USERS.producer.id,
    roleCode: 'producer',
    splitPct: '0.6000',
  },
  {
    id: DEMO_CONTRIBUTORS.invoicedManager.id,
    placementId: DEMO_PLACEMENTS.invoiced.id,
    producerId: DEMO_USERS.manager.id,
    roleCode: 'manager',
    splitPct: '0.4000',
  },
  // Collected placement (includes external partner)
  {
    id: DEMO_CONTRIBUTORS.collectedProducer.id,
    placementId: DEMO_PLACEMENTS.collected.id,
    producerId: DEMO_USERS.producer.id,
    roleCode: 'producer',
    splitPct: '0.5000',
  },
  {
    id: DEMO_CONTRIBUTORS.collectedManager.id,
    placementId: DEMO_PLACEMENTS.collected.id,
    producerId: DEMO_USERS.manager.id,
    roleCode: 'manager',
    splitPct: '0.3000',
  },
  {
    id: DEMO_CONTRIBUTORS.collectedPartner.id,
    placementId: DEMO_PLACEMENTS.collected.id,
    producerId: DEMO_USERS.externalPartner.id,
    roleCode: 'external_partner',
    splitPct: '0.2000',
  },
  // Closed placement (includes external partner)
  {
    id: DEMO_CONTRIBUTORS.closedProducer.id,
    placementId: DEMO_PLACEMENTS.closed.id,
    producerId: DEMO_USERS.producer.id,
    roleCode: 'producer',
    splitPct: '0.5000',
  },
  {
    id: DEMO_CONTRIBUTORS.closedManager.id,
    placementId: DEMO_PLACEMENTS.closed.id,
    producerId: DEMO_USERS.manager.id,
    roleCode: 'manager',
    splitPct: '0.2500',
  },
  {
    id: DEMO_CONTRIBUTORS.closedPartner.id,
    placementId: DEMO_PLACEMENTS.closed.id,
    producerId: DEMO_USERS.externalPartner.id,
    roleCode: 'external_partner',
    splitPct: '0.2500',
  },
  // GuaranteeActive placement
  {
    id: DEMO_CONTRIBUTORS.guaranteeActiveProducer.id,
    placementId: DEMO_PLACEMENTS.guaranteeActive.id,
    producerId: DEMO_USERS.producer.id,
    roleCode: 'producer',
    splitPct: '1.0000',
  },
  // ClawbackTriggered placement
  {
    id: DEMO_CONTRIBUTORS.clawbackProducer.id,
    placementId: DEMO_PLACEMENTS.clawback.id,
    producerId: DEMO_USERS.producer.id,
    roleCode: 'producer',
    splitPct: '1.0000',
  },
];

export async function seedDemoContributors(sql: Sql): Promise<void> {
  for (const c of CONTRIBUTORS) {
    await sql.unsafe(`
      INSERT INTO contributors (id, org_id, placement_id, producer_id, role_code, split_pct)
      VALUES (
        '${c.id}',
        '${DEMO_ORG_ID}',
        '${c.placementId}',
        '${c.producerId}',
        '${c.roleCode}',
        ${c.splitPct}
      )
      ON CONFLICT (id) DO NOTHING
    `);

    // Each contributor also gets a contribution_split row (1:1 in demo)
    await sql.unsafe(`
      INSERT INTO contribution_splits (id, org_id, contributor_id, split_type, split_pct)
      VALUES (
        gen_random_uuid(),
        '${DEMO_ORG_ID}',
        '${c.id}',
        'primary',
        ${c.splitPct}
      )
      ON CONFLICT (id) DO NOTHING
    `);
  }

  console.log(
    '[demo-seed] Step 4: demo contributors seeded (12 contributors + contribution splits).',
  );
}

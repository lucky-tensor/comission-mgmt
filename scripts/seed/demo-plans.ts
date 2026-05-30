/**
 * Demo seed step 2 — Commission Plans.
 *
 * Creates 2 CommissionPlans + PlanVersions:
 *   - Gross-fee flat-rate plan (15% of gross fee)
 *   - Tiered plan (0–50k: 12%, 50k–100k: 15%, >100k: 18%)
 *
 * Assigns the flat-rate plan to the Producer user and the tiered plan to
 * the ExternalPartner user.
 */

import type { Sql } from 'postgres';
import { DEMO_ORG_ID, DEMO_USERS } from './demo-users.js';

// ---------------------------------------------------------------------------
// Deterministic demo IDs
// ---------------------------------------------------------------------------

export const DEMO_PLANS = {
  flatRate: {
    planId: 'dd020000-0000-0000-0000-000000000001',
    planVersionId: 'dd020000-0000-0000-0000-000000000011',
    planAssignmentProducerId: 'dd020000-0000-0000-0000-000000000021',
    configEntityId: 'dd020000-0000-0000-0000-000000000031',
    name: 'Standard Flat-Rate Plan (Demo)',
  },
  tiered: {
    planId: 'dd020000-0000-0000-0000-000000000002',
    planVersionId: 'dd020000-0000-0000-0000-000000000012',
    planAssignmentPartnerId: 'dd020000-0000-0000-0000-000000000022',
    configEntityId: 'dd020000-0000-0000-0000-000000000032',
    name: 'Tiered Commission Plan (Demo)',
  },
} as const;

export async function seedDemoPlans(sql: Sql): Promise<void> {
  const financeAdminId = DEMO_USERS.financeAdmin.id;
  const producerId = DEMO_USERS.producer.id;
  const partnerId = DEMO_USERS.externalPartner.id;

  // Plan 1: Gross-fee flat-rate plan
  await sql.unsafe(`
    INSERT INTO commission_plans (id, org_id, name, effective_from, config_entity_id, created_by)
    VALUES (
      '${DEMO_PLANS.flatRate.planId}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLANS.flatRate.name}',
      '2025-01-01',
      '${DEMO_PLANS.flatRate.configEntityId}',
      '${financeAdminId}'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  await sql.unsafe(`
    INSERT INTO plan_versions (id, org_id, plan_id, version_num, status, rules_snapshot, effective_at)
    VALUES (
      '${DEMO_PLANS.flatRate.planVersionId}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLANS.flatRate.planId}',
      1,
      'Active',
      '{"type":"flat_rate","rate":0.15,"basis":"gross_fee","description":"15% of gross placement fee"}',
      '2025-01-01T00:00:00Z'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  await sql.unsafe(`
    INSERT INTO plan_assignments (id, org_id, plan_version_id, producer_id)
    VALUES (
      '${DEMO_PLANS.flatRate.planAssignmentProducerId}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLANS.flatRate.planVersionId}',
      '${producerId}'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Plan 2: Tiered plan
  await sql.unsafe(`
    INSERT INTO commission_plans (id, org_id, name, effective_from, config_entity_id, created_by)
    VALUES (
      '${DEMO_PLANS.tiered.planId}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLANS.tiered.name}',
      '2025-01-01',
      '${DEMO_PLANS.tiered.configEntityId}',
      '${financeAdminId}'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  await sql.unsafe(`
    INSERT INTO plan_versions (id, org_id, plan_id, version_num, status, rules_snapshot, effective_at)
    VALUES (
      '${DEMO_PLANS.tiered.planVersionId}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLANS.tiered.planId}',
      1,
      'Active',
      '{"type":"tiered","tiers":[{"threshold":0,"rate":0.12},{"threshold":50000,"rate":0.15},{"threshold":100000,"rate":0.18}],"basis":"gross_fee","description":"Tiered: 12%/<50k, 15%/50-100k, 18%/>100k"}',
      '2025-01-01T00:00:00Z'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  await sql.unsafe(`
    INSERT INTO plan_assignments (id, org_id, plan_version_id, producer_id)
    VALUES (
      '${DEMO_PLANS.tiered.planAssignmentPartnerId}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLANS.tiered.planVersionId}',
      '${partnerId}'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  console.log(
    '[demo-seed] Step 2: demo plans seeded (2 plans, 2 plan versions, 2 plan assignments).',
  );
}

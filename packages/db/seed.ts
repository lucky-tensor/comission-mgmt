/**
 * Seed fixture data for test suites.
 *
 * Inserts deterministic test data into commission_app for integration tests.
 * Encrypted columns (BYTEA) are filled with placeholder bytes; real encryption
 * is exercised in the FieldEncryptor issue, not here.
 *
 * Usage: called from test beforeAll hooks, not from CLI.
 */
import postgres from 'postgres';

/** Deterministic UUIDs for fixture entities */
export const SEED = {
  orgId: '00000000-0000-0000-0000-000000000001',
  orgId2: '00000000-0000-0000-0000-000000000002',
  placementId: '10000000-0000-0000-0000-000000000001',
  contributorId: '20000000-0000-0000-0000-000000000001',
  planId: '30000000-0000-0000-0000-000000000001',
  planVersionId: '40000000-0000-0000-0000-000000000001',
  commissionRecordId: '50000000-0000-0000-0000-000000000001',
  invoiceId: '60000000-0000-0000-0000-000000000001',
  guaranteePeriodId: '70000000-0000-0000-0000-000000000001',
  drawBalanceId: '80000000-0000-0000-0000-000000000001',
  exceptionId: '90000000-0000-0000-0000-000000000001',
  producerId: 'a0000000-0000-0000-0000-000000000001',
  candidateId: 'b0000000-0000-0000-0000-000000000001',
  clientEntityId: 'c0000000-0000-0000-0000-000000000001',
  configEntityId: 'd0000000-0000-0000-0000-000000000001',
  createdBy: 'e0000000-0000-0000-0000-000000000001',
} as const;

/** Placeholder encrypted bytes (4 null bytes) for BYTEA columns */
const PLACEHOLDER_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x00]);

/**
 * Insert seed fixture data for the commission domain.
 * Idempotent: uses INSERT ... ON CONFLICT DO NOTHING.
 */
export async function seedCommissionFixtures(sql: postgres.Sql) {
  const s = SEED;

  // placement
  await sql.unsafe(
    `
    INSERT INTO placements (id, org_id, candidate_id, client_entity_id, job_title, status, fee_amount, compensation_base)
    VALUES ('${s.placementId}', '${s.orgId}', '${s.candidateId}', '${s.clientEntityId}', 'Senior Engineer', 'Created', $1, $2)
    ON CONFLICT (id) DO NOTHING
  `,
    [PLACEHOLDER_BYTES, PLACEHOLDER_BYTES],
  );

  // commission plan
  await sql.unsafe(`
    INSERT INTO commission_plans (id, org_id, name, effective_from, config_entity_id, created_by)
    VALUES ('${s.planId}', '${s.orgId}', 'Standard Plan', '2025-01-01', '${s.configEntityId}', '${s.createdBy}')
    ON CONFLICT (id) DO NOTHING
  `);

  // plan version
  await sql.unsafe(`
    INSERT INTO plan_versions (id, org_id, plan_id, version_num, status, rules_snapshot, effective_at)
    VALUES ('${s.planVersionId}', '${s.orgId}', '${s.planId}', 1, 'Active', '{"tiers":[]}', NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // contributor
  await sql.unsafe(`
    INSERT INTO contributors (id, org_id, placement_id, producer_id, role_code, split_pct)
    VALUES ('${s.contributorId}', '${s.orgId}', '${s.placementId}', '${s.producerId}', 'bd', 1.0000)
    ON CONFLICT (id) DO NOTHING
  `);

  // commission record
  await sql.unsafe(
    `
    INSERT INTO commission_records (id, org_id, placement_id, contributor_id, plan_version_id, gross_amount, net_payable, status)
    VALUES ('${s.commissionRecordId}', '${s.orgId}', '${s.placementId}', '${s.contributorId}', '${s.planVersionId}', $1, $2, 'Accrued')
    ON CONFLICT (id) DO NOTHING
  `,
    [PLACEHOLDER_BYTES, PLACEHOLDER_BYTES],
  );

  // invoice
  await sql.unsafe(
    `
    INSERT INTO invoices (id, org_id, placement_id, invoice_number, amount_billed, status, issued_at)
    VALUES ('${s.invoiceId}', '${s.orgId}', '${s.placementId}', 'INV-001', $1, 'Issued', NOW())
    ON CONFLICT (id) DO NOTHING
  `,
    [PLACEHOLDER_BYTES],
  );

  // guarantee period
  await sql.unsafe(
    `
    INSERT INTO guarantee_periods (id, org_id, placement_id, guarantee_ends, status, risk_amount)
    VALUES ('${s.guaranteePeriodId}', '${s.orgId}', '${s.placementId}', '2026-03-01', 'Active', $1)
    ON CONFLICT (id) DO NOTHING
  `,
    [PLACEHOLDER_BYTES],
  );

  // draw balance
  await sql.unsafe(
    `
    INSERT INTO draw_balances (id, org_id, producer_id, balance, draw_limit, status)
    VALUES ('${s.drawBalanceId}', '${s.orgId}', '${s.producerId}', $1, $2, 'Active')
    ON CONFLICT (id) DO NOTHING
  `,
    [PLACEHOLDER_BYTES, PLACEHOLDER_BYTES],
  );

  // exception
  await sql.unsafe(`
    INSERT INTO exceptions (id, org_id, placement_id, requested_by, exception_type, justification, status)
    VALUES ('${s.exceptionId}', '${s.orgId}', '${s.placementId}', '${s.createdBy}', 'split_override', 'Test justification', 'Requested')
    ON CONFLICT (id) DO NOTHING
  `);
}

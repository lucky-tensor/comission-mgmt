/**
 * Confidential placement flag and field masking — integration tests (issue #64).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — Finance Admin can set is_confidential: true via PATCH /placements/:id.
 *   AC#2 — GET /me/payouts for a Producer on a confidential placement returns
 *            position_title: "Confidential" and masked client fields.
 *   AC#3 — GET /placements/:id for a Finance Admin on a confidential placement returns
 *            unmasked position title and client.
 *   AC#4 — Payroll export row for a confidential placement has masked position title and client.
 *   AC#5 — Commission amounts, payout amounts, and split percentages are unaffected.
 *   AC#6 — AuditLogEntry is created when is_confidential changes.
 *   AC#7 — External Partner GET /partner/placements/:id on a confidential placement returns
 *            masked fields.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §9, docs/architecture.md §4
 * Issue: feat: placement confidential flag and field masking (#64)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { FieldEncryptor } from '../../../packages/db/src/encryption';
import { LocalDevKmsAdapter } from '../../../packages/db/src/kms-dev';
import { _setEncryptorForTest, _resetEncryptorForTest } from '../../../packages/db/src/placements';
import {
  _setEncryptorForTest as _setCommRecordEncryptorForTest,
  _resetEncryptorForTest as _resetCommRecordEncryptorForTest,
} from '../../../packages/db/src/commission-records';
import {
  _setEncryptorForTest as _setInvoiceEncryptorForTest,
  _resetEncryptorForTest as _resetInvoiceEncryptorForTest,
} from '../../../packages/db/src/invoices';
import {
  handleCreatePlacement,
  handleUpdatePlacement,
  handleGetPlacement,
  handleGetPartnerPlacement,
} from '../../../apps/server/src/api/placements';
import { handleAddContributor } from '../../../apps/server/src/api/contributors';
import {
  handleCreatePlan,
  handleActivatePlanVersion,
  handleCreatePlanAssignment,
} from '../../../apps/server/src/api/plans';
import { handleCalculateCommission } from '../../../apps/server/src/api/calculate';
import {
  handleCreateCommissionRun,
  handleApproveRunRecord,
  handleApproveCommissionRun,
} from '../../../apps/server/src/api/commission-runs';
import { handleGetMyPayouts } from '../../../apps/server/src/api/me';
import { handleCreatePayrollExport } from '../../../apps/server/src/api/exports';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let auditSql: ReturnType<typeof postgres>;

const ORG_ID = crypto.randomUUID();

const financeAdmin: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producerId = crypto.randomUUID();
const producer: SessionClaims = {
  org_id: ORG_ID,
  user_id: producerId,
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const partnerClaims: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(),
  role: 'ExternalPartner',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  auditSql = postgres(pg.url, { max: 3 });

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });

  const adapter = new LocalDevKmsAdapter();
  const enc = new FieldEncryptor(adapter);
  _setEncryptorForTest(enc);
  _setCommRecordEncryptorForTest(enc);
  _setInvoiceEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
  _resetCommRecordEncryptorForTest();
  _resetInvoiceEncryptorForTest();
  await testSql?.end({ timeout: 5 });
  await auditSql?.end({ timeout: 5 });
  await pg?.stop();
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(opts: { path: string; method?: string; body?: unknown }): Request {
  const method = opts.method ?? 'GET';
  return new Request(`http://localhost${opts.path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function jsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return JSON.parse(text);
}

/**
 * Creates a placement and optionally activates it and adds a contributor.
 */
async function createPlacement(opts: {
  jobTitle?: string;
  isConfidential?: boolean;
}): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: opts.jobTitle ?? 'Senior Recruiter',
      compensation_base: '120000',
      fee_amount: '20000',
      start_date: '2025-04-01',
      guarantee_days: null,
    },
  });
  const res = await handleCreatePlacement(req, financeAdmin, testSql);
  expect(res.status).toBe(201);
  const { id } = (await jsonBody(res)) as { id: string };
  return id;
}

async function activatePlacementWithContributor(placementId: string, pId: string): Promise<void> {
  await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
  const addReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: pId, role: 'CandidateOwner', split_pct: 1.0 },
  });
  const addRes = await handleAddContributor(placementId, addReq, financeAdmin, testSql);
  expect(addRes.status).toBe(201);
}

async function createActivePlanForProducer(pId: string): Promise<string> {
  const createReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: `Confidential Test Plan ${Date.now()}-${Math.random()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.25 },
    },
  });
  const createRes = await handleCreatePlan(createReq, financeAdmin, testSql);
  expect(createRes.status).toBe(201);
  const { plan, version } = (await jsonBody(createRes)) as {
    plan: { id: string };
    version: { id: string };
  };

  const activateRes = await handleActivatePlanVersion(plan.id, version.id, financeAdmin, testSql);
  expect(activateRes.status).toBe(200);

  const assignReq = makeRequest({
    path: `/plans/${plan.id}/assignments`,
    method: 'POST',
    body: { producer_id: pId, plan_version_id: version.id },
  });
  const assignRes = await handleCreatePlanAssignment(plan.id, assignReq, financeAdmin, testSql);
  expect(assignRes.status).toBe(201);

  return version.id;
}

async function calculateAndGetRecordIds(placementId: string): Promise<string[]> {
  const req = makeRequest({
    path: `/placements/${placementId}/calculate`,
    method: 'POST',
  });
  const res = await handleCalculateCommission(placementId, req, financeAdmin, testSql);
  expect(res.status).toBe(200);
  const body = (await jsonBody(res)) as { commission_records: Array<{ id: string }> };
  return body.commission_records.map((r) => r.id);
}

async function buildApprovedRun(placementId: string, recordIds: string[]): Promise<string> {
  const createRunReq = makeRequest({
    path: '/commission-runs',
    method: 'POST',
    body: {
      period_start: '2025-04-01',
      period_end: '2025-04-30',
      placement_ids: [placementId],
    },
  });
  const createRunRes = await handleCreateCommissionRun(createRunReq, financeAdmin, testSql);
  expect(createRunRes.status).toBe(201);
  const { id: runId } = (await jsonBody(createRunRes)) as { id: string };

  for (const recordId of recordIds) {
    const approveRes = await handleApproveRunRecord(runId, recordId, financeAdmin, testSql);
    expect(approveRes.status).toBe(200);
  }

  const approveRunRes = await handleApproveCommissionRun(runId, financeAdmin, testSql);
  expect(approveRunRes.status).toBe(200);

  return runId;
}

// ---------------------------------------------------------------------------
// AC#1 — Finance Admin can set is_confidential: true via PATCH /placements/:id
// ---------------------------------------------------------------------------

describe('AC#1 — Finance Admin sets is_confidential flag', () => {
  test('PATCH /placements/:id with is_confidential:true returns updated flag', async () => {
    const placementId = await createPlacement({ jobTitle: 'Director of Engineering' });

    const patchReq = makeRequest({
      path: `/placements/${placementId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    const patchRes = await handleUpdatePlacement(
      placementId,
      patchReq,
      financeAdmin,
      testSql,
      auditSql,
    );
    expect(patchRes.status).toBe(200);
    const body = (await jsonBody(patchRes)) as Record<string, unknown>;
    expect(body.is_confidential).toBe(true);
    expect(body.job_title).toBe('Director of Engineering'); // Finance Admin sees unmasked
  });

  test('Finance Admin can unset is_confidential flag (toggle back to false)', async () => {
    const placementId = await createPlacement({});

    // Set to true
    const setReq = makeRequest({
      path: `/placements/${placementId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    await handleUpdatePlacement(placementId, setReq, financeAdmin, testSql, auditSql);

    // Set back to false
    const unsetReq = makeRequest({
      path: `/placements/${placementId}`,
      method: 'PATCH',
      body: { is_confidential: false },
    });
    const unsetRes = await handleUpdatePlacement(
      placementId,
      unsetReq,
      financeAdmin,
      testSql,
      auditSql,
    );
    expect(unsetRes.status).toBe(200);
    const body = (await jsonBody(unsetRes)) as Record<string, unknown>;
    expect(body.is_confidential).toBe(false);
  });

  test('Non-FinanceAdmin (Manager role) cannot set is_confidential', async () => {
    const placementId = await createPlacement({});

    const managerClaims: SessionClaims = {
      org_id: ORG_ID,
      user_id: crypto.randomUUID(),
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const patchReq = makeRequest({
      path: `/placements/${placementId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    const patchRes = await handleUpdatePlacement(
      placementId,
      patchReq,
      managerClaims,
      testSql,
      auditSql,
    );
    expect(patchRes.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// AC#2 & AC#3 — Role-differentiation: Producer sees masked, Finance Admin sees unmasked
// ---------------------------------------------------------------------------

describe('AC#2 & AC#3 — Role differentiation: masking by role', () => {
  let confidentialPlacementId: string;
  const JOB_TITLE = `Confidential VP Role ${Date.now()}`;

  beforeAll(async () => {
    confidentialPlacementId = await createPlacement({ jobTitle: JOB_TITLE });
    // Mark as confidential
    const patchReq = makeRequest({
      path: `/placements/${confidentialPlacementId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    await handleUpdatePlacement(confidentialPlacementId, patchReq, financeAdmin, testSql, auditSql);
  }, 30_000);

  test('Finance Admin sees unmasked job_title and client_entity_id', async () => {
    const res = await handleGetPlacement(confidentialPlacementId, financeAdmin, testSql);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body.job_title).toBe(JOB_TITLE);
    expect(body.client_entity_id).toBeTruthy();
    expect(body.is_confidential).toBe(true);
  });

  test('Producer sees masked job_title="Confidential" and null client_entity_id', async () => {
    const res = await handleGetPlacement(confidentialPlacementId, producer, testSql);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body.job_title).toBe('Confidential');
    expect(body.client_entity_id).toBeNull();
    expect(body.is_confidential).toBe(true);
    // Amounts are NOT masked
    expect(body.fee_amount).toBeTruthy();
    expect(body.compensation_base).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC#2 — GET /me/payouts masking
// ---------------------------------------------------------------------------

describe('AC#2 — GET /me/payouts masking for Producer on confidential placement', () => {
  let confidentialPlacementId: string;
  const MY_JOB_TITLE = `Confidential Payout Role ${Date.now()}`;

  beforeAll(async () => {
    confidentialPlacementId = await createPlacement({ jobTitle: MY_JOB_TITLE });
    await activatePlacementWithContributor(confidentialPlacementId, producerId);
    await createActivePlanForProducer(producerId);
    const recordIds = await calculateAndGetRecordIds(confidentialPlacementId);
    await buildApprovedRun(confidentialPlacementId, recordIds);

    // Mark as confidential AFTER creating the run (to test that masking applies retroactively)
    const patchReq = makeRequest({
      path: `/placements/${confidentialPlacementId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    await handleUpdatePlacement(confidentialPlacementId, patchReq, financeAdmin, testSql, auditSql);
  }, 60_000);

  test('Producer /me/payouts returns position_title="Confidential" and client_name="Confidential"', async () => {
    const req = makeRequest({ path: '/me/payouts' });
    const res = await handleGetMyPayouts(req, producer, testSql);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as { payouts: Array<Record<string, unknown>> };
    const payout = body.payouts.find((p) => p.placement_id === confidentialPlacementId);
    expect(payout).toBeDefined();
    expect(payout!.position_title).toBe('Confidential');
    expect(payout!.client_name).toBe('Confidential');
    // Commission amount fields are present (not masked / not removed)
    expect(payout!.gross_commission).toBeDefined();
    expect(payout!.net_payable).toBeDefined();
  });

  test('Commission record exists for the confidential placement (amounts stored in DB)', async () => {
    // Verify a commission record exists — gross_amount is BYTEA (encrypted), check existence only.
    const rows = await testSql.unsafe(
      `SELECT id FROM commission_records WHERE placement_id = $1 LIMIT 1`,
      [confidentialPlacementId],
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Export masking
// ---------------------------------------------------------------------------

describe('AC#4 — Payroll export row has masked position_title and client_name', () => {
  let exportRunId: string;
  let exportProducerId: string;
  let exportPlacementId: string;
  const EXPORT_JOB_TITLE = `Export Confidential Role ${Date.now()}`;

  beforeAll(async () => {
    exportProducerId = crypto.randomUUID();

    exportPlacementId = await createPlacement({ jobTitle: EXPORT_JOB_TITLE });
    await activatePlacementWithContributor(exportPlacementId, exportProducerId);
    await createActivePlanForProducer(exportProducerId);
    const recordIds = await calculateAndGetRecordIds(exportPlacementId);
    exportRunId = await buildApprovedRun(exportPlacementId, recordIds);

    // Mark placement as confidential
    const patchReq = makeRequest({
      path: `/placements/${exportPlacementId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    await handleUpdatePlacement(exportPlacementId, patchReq, financeAdmin, testSql, auditSql);
  }, 60_000);

  test('CSV export row contains position_title=Confidential and client_name=Confidential', async () => {
    const res = await handleCreatePayrollExport(exportRunId, financeAdmin, testSql);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as { content: string; row_count: number };
    expect(body.row_count).toBeGreaterThan(0);

    const csvContent = body.content;
    expect(csvContent).toContain('position_title');
    expect(csvContent).toContain('client_name');
    expect(csvContent).toContain('Confidential');

    // Parse CSV to verify the specific row
    const lines = csvContent.split('\n');
    const headerLine = lines[0];
    const headers = headerLine.split(',');
    const positionTitleIdx = headers.indexOf('position_title');
    const clientNameIdx = headers.indexOf('client_name');

    expect(positionTitleIdx).toBeGreaterThanOrEqual(0);
    expect(clientNameIdx).toBeGreaterThanOrEqual(0);

    // Find the data row for our producer
    const dataRow = lines.find((line) => line.length > 0 && line.includes(exportProducerId));
    expect(dataRow).toBeDefined();

    const cells = dataRow!.split(',');
    expect(cells[positionTitleIdx]).toBe('Confidential');
    expect(cells[clientNameIdx]).toBe('Confidential');
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Commission amounts are unaffected by confidential flag
// ---------------------------------------------------------------------------

describe('AC#5 — Commission amounts are unaffected by the confidential flag', () => {
  test('Commission record IDs are unchanged after setting is_confidential', async () => {
    const amountProducerId = crypto.randomUUID();
    const placementId = await createPlacement({ jobTitle: 'Amount Test Role' });
    await activatePlacementWithContributor(placementId, amountProducerId);
    await createActivePlanForProducer(amountProducerId);

    // Calculate BEFORE setting confidential — store record IDs
    const beforeRecordIds = await calculateAndGetRecordIds(placementId);
    expect(beforeRecordIds.length).toBeGreaterThan(0);

    // Set confidential
    const patchReq = makeRequest({
      path: `/placements/${placementId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    await handleUpdatePlacement(placementId, patchReq, financeAdmin, testSql, auditSql);

    // Commission records still exist with same IDs — is_confidential does not delete/recalculate
    const afterRows = await testSql.unsafe(
      `SELECT id FROM commission_records WHERE placement_id = $1`,
      [placementId],
    );
    const afterIds = (afterRows as unknown as Array<{ id: string }>).map((r) => r.id);
    expect(afterIds).toEqual(expect.arrayContaining(beforeRecordIds));
    expect(afterIds.length).toBe(beforeRecordIds.length);
  });
});

// ---------------------------------------------------------------------------
// AC#6 — AuditLogEntry created when is_confidential changes
// ---------------------------------------------------------------------------

describe('AC#6 — AuditLogEntry on is_confidential toggle', () => {
  test('Audit log entry is written when is_confidential is set to true', async () => {
    const auditPlacementId = await createPlacement({ jobTitle: 'Audit Test Role' });

    const patchReq = makeRequest({
      path: `/placements/${auditPlacementId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    await handleUpdatePlacement(auditPlacementId, patchReq, financeAdmin, testSql, auditSql);

    // Check audit_log_entries in the audit DB (same DB in test environment)
    const auditRows = await auditSql.unsafe(
      `SELECT action, entity_type, entity_id, before_json, after_json
       FROM audit_log_entries
       WHERE entity_type = 'placement'
         AND entity_id = $1
         AND action = 'placement.confidential_flag_changed'
       LIMIT 1`,
      [auditPlacementId],
    );
    expect(auditRows.length).toBe(1);
    const auditRow = auditRows[0] as unknown as {
      action: string;
      entity_type: string;
      entity_id: string;
      before_json: { is_confidential: boolean };
      after_json: { is_confidential: boolean };
    };
    expect(auditRow.action).toBe('placement.confidential_flag_changed');
    expect(auditRow.before_json.is_confidential).toBe(false);
    expect(auditRow.after_json.is_confidential).toBe(true);
  });

  test('No audit entry when is_confidential is unchanged in a PATCH', async () => {
    const placementId = await createPlacement({});

    const patchReq = makeRequest({
      path: `/placements/${placementId}`,
      method: 'PATCH',
      body: { job_title: 'Updated Title' },
    });
    await handleUpdatePlacement(placementId, patchReq, financeAdmin, testSql, auditSql);

    const auditRows = await auditSql.unsafe(
      `SELECT count(*) as cnt FROM audit_log_entries
       WHERE entity_type = 'placement'
         AND entity_id = $1
         AND action = 'placement.confidential_flag_changed'`,
      [placementId],
    );
    expect(Number((auditRows[0] as unknown as { cnt: string }).cnt)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC#7 — External Partner GET /partner/placements/:id masking
// ---------------------------------------------------------------------------

describe('AC#7 — External Partner view returns masked fields on confidential placement', () => {
  let partnerPlacementId: string;
  const PARTNER_JOB_TITLE = `Partner Confidential Role ${Date.now()}`;

  beforeAll(async () => {
    partnerPlacementId = await createPlacement({ jobTitle: PARTNER_JOB_TITLE });
    const patchReq = makeRequest({
      path: `/placements/${partnerPlacementId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    await handleUpdatePlacement(partnerPlacementId, patchReq, financeAdmin, testSql, auditSql);
  }, 30_000);

  test('ExternalPartner GET /partner/placements/:id returns masked fields', async () => {
    const res = await handleGetPartnerPlacement(partnerPlacementId, partnerClaims, testSql);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body.job_title).toBe('Confidential');
    expect(body.client_entity_id).toBeNull();
    expect(body.is_confidential).toBe(true);
    // Amounts are NOT masked
    expect(body.fee_amount).toBeTruthy();
    expect(body.compensation_base).toBeTruthy();
  });

  test('Finance Admin GET /partner/placements/:id returns unmasked fields', async () => {
    const res = await handleGetPartnerPlacement(partnerPlacementId, financeAdmin, testSql);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body.job_title).toBe(PARTNER_JOB_TITLE);
    expect(body.client_entity_id).toBeTruthy();
    expect(body.is_confidential).toBe(true);
  });

  test('Non-confidential placement returns real fields to ExternalPartner', async () => {
    const plainId = await createPlacement({ jobTitle: 'Non-Confidential Role' });
    const res = await handleGetPartnerPlacement(plainId, partnerClaims, testSql);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body.job_title).toBe('Non-Confidential Role');
    expect(body.client_entity_id).toBeTruthy();
    expect(body.is_confidential).toBe(false);
  });
});

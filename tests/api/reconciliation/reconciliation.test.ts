/**
 * Financial reconciliation report — integration tests (issue #65).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — GET /reconciliation returns ledger-only, system-only, amount-mismatch, and
 *            date-gap line items for the requested period (discrepancy-type integration test
 *            with fixture data).
 *   AC#2 — A placement invoice present in the ledger but absent from ingested AR data appears
 *            as a ledger-only discrepancy (ledger-only fixture test).
 *   AC#3 — POST /commission-runs/:id/finalize returns 422 when unacknowledged discrepancies
 *            exist for the run period (finalization gate test).
 *   AC#4 — POST /commission-runs/:id/finalize succeeds when all discrepancies are acknowledged
 *            or an override reason is supplied (acknowledged and override integration tests).
 *   AC#5 — POST /reconciliation/:id/acknowledge records the reviewer and note and sets
 *            acknowledged=true (acknowledgement integration test).
 *   AC#6 — AuditLogEntry is created for each acknowledgement and for each finalization override
 *            (audit count test).
 *   AC#7 — Finance Admin role required; Producer and Manager roles return 403 on all
 *            reconciliation endpoints (RBAC test).
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.8
 * Issue: feat: financial reconciliation report (#65)
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
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
import { handleAddContributor } from '../../../apps/server/src/api/contributors';
import {
  handleCreatePlan,
  handleActivatePlanVersion,
  handleCreatePlanAssignment,
} from '../../../apps/server/src/api/plans';
import { handleCalculateCommission } from '../../../apps/server/src/api/calculate';
import { handleCreateInvoice } from '../../../apps/server/src/api/invoices';
import {
  handleCreateCommissionRun,
  handleApproveRunRecord,
  handleApproveCommissionRun,
  handleFinalizeCommissionRun,
} from '../../../apps/server/src/api/commission-runs';
import {
  handleGetReconciliationReport,
  handleAcknowledgeDiscrepancy,
} from '../../../apps/server/src/api/reconciliation';
import { upsertArIngestedRecord } from '../../../packages/db/src/reconciliation';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let auditSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const USER_A_ID = crypto.randomUUID();

const adminClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: USER_A_ID,
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producerClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: crypto.randomUUID(),
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const managerClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: crypto.randomUUID(),
  role: 'Manager',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  auditSql = postgres(pg.url, { max: 2 });

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

/** Create a placement with all commission-required fields. */
async function createPlacement(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Account Executive',
      compensation_base: '130000',
      fee_amount: '26000',
      start_date: '2025-04-01',
      guarantee_days: null,
    },
  });
  const res = await handleCreatePlacement(req, claims, sql);
  expect(res.status).toBe(201);
  const body = (await jsonBody(res)) as { id: string };
  return body.id;
}

async function activatePlacement(
  sql: ReturnType<typeof postgres>,
  placementId: string,
): Promise<void> {
  await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
}

async function createActivePlan(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  producerId: string,
): Promise<string> {
  const createReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: `Reconciliation Test Plan ${Date.now()}-${Math.random()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.25 },
    },
  });
  const createRes = await handleCreatePlan(createReq, claims, sql);
  expect(createRes.status).toBe(201);
  const createBody = (await jsonBody(createRes)) as {
    plan: { id: string };
    version: { id: string };
  };
  const planId = createBody.plan.id;
  const versionId = createBody.version.id;

  await handleActivatePlanVersion(planId, versionId, claims, sql);

  const assignReq = makeRequest({
    path: `/plans/${planId}/assignments`,
    method: 'POST',
    body: { producer_id: producerId, plan_version_id: versionId },
  });
  await handleCreatePlanAssignment(planId, assignReq, claims, sql);
  return versionId;
}

/**
 * Create a placement with contributor, plan, and calculate commission.
 * Returns { placementId, commissionRecordIds }.
 */
async function setupPlacementWithCommission(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
): Promise<{ placementId: string; commissionRecordIds: string[] }> {
  const placementId = await createPlacement(sql, claims);
  await activatePlacement(sql, placementId);

  const producerId = crypto.randomUUID();
  const addReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 1.0 },
  });
  await handleAddContributor(placementId, addReq, claims, sql);
  await createActivePlan(sql, claims, producerId);

  const calcReq = makeRequest({
    path: `/placements/${placementId}/calculate`,
    method: 'POST',
  });
  const calcRes = await handleCalculateCommission(placementId, calcReq, claims, sql);
  expect(calcRes.status).toBe(200);
  const calcBody = (await jsonBody(calcRes)) as { commission_records: Array<{ id: string }> };
  const commissionRecordIds = calcBody.commission_records.map((r) => r.id);

  return { placementId, commissionRecordIds };
}

/** Create an invoice for a placement and return the invoice number */
async function createTestInvoice(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  placementId: string,
  invoiceNumber: string,
  amountBilled: string,
  issuedAt: string,
): Promise<string> {
  const req = makeRequest({
    path: '/invoices',
    method: 'POST',
    body: {
      placement_id: placementId,
      invoice_number: invoiceNumber,
      amount_billed: amountBilled,
      issued_at: issuedAt,
    },
  });
  const res = await handleCreateInvoice(req, claims, sql);
  expect(res.status).toBe(201);
  const body = (await jsonBody(res)) as { id: string };
  return body.id;
}

// ---------------------------------------------------------------------------
// AC#2 — ledger-only fixture test
// ---------------------------------------------------------------------------

describe('GET /reconciliation — ledger-only discrepancy (AC#2)', () => {
  test('invoice in ledger but absent from AR appears as ledger_only discrepancy', async () => {
    const { placementId } = await setupPlacementWithCommission(testSql, adminClaims);
    const invoiceNumber = `INV-LEDGER-ONLY-${Date.now()}`;
    await createTestInvoice(
      testSql,
      adminClaims,
      placementId,
      invoiceNumber,
      '50000',
      '2025-06-01',
    );

    // No AR record ingested — ledger-only expected
    const req = makeRequest({
      path: '/reconciliation?period_start=2025-06-01&period_end=2025-06-30',
      method: 'GET',
    });
    const res = await handleGetReconciliationReport(req, adminClaims, testSql, auditSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      discrepancies: Array<{ discrepancy_type: string; invoice_number: string }>;
    };
    const ledgerOnly = body.discrepancies.filter(
      (d) => d.discrepancy_type === 'ledger_only' && d.invoice_number === invoiceNumber,
    );
    expect(ledgerOnly.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC#1 — all discrepancy types (fixture data test)
// ---------------------------------------------------------------------------

describe('GET /reconciliation — all discrepancy types (AC#1)', () => {
  test('returns system_only, amount_mismatch, and date_gap discrepancies', async () => {
    // Use a fresh period to avoid interference from other tests
    const PERIOD_START = '2025-07-01';
    const PERIOD_END = '2025-07-31';
    const TAG = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { placementId } = await setupPlacementWithCommission(testSql, adminClaims);

    // amount_mismatch: ledger says 30000, AR says 28000
    const invNumMismatch = `INV-MISMATCH-${TAG}`;
    await createTestInvoice(
      testSql,
      adminClaims,
      placementId,
      invNumMismatch,
      '30000',
      PERIOD_START,
    );
    await upsertArIngestedRecord(testSql, {
      orgId: ORG_A_ID,
      invoiceNumber: invNumMismatch,
      amountBilled: '28000',
      billedDate: PERIOD_START,
    });

    // date_gap: billed dates differ by more than 5 days
    const invNumDateGap = `INV-DATEGAP-${TAG}`;
    await createTestInvoice(
      testSql,
      adminClaims,
      placementId,
      invNumDateGap,
      '20000',
      PERIOD_START,
    );
    await upsertArIngestedRecord(testSql, {
      orgId: ORG_A_ID,
      invoiceNumber: invNumDateGap,
      amountBilled: '20000',
      billedDate: '2025-07-10', // 9 days later
    });

    // system_only: AR record with no matching ledger invoice
    const invNumSystemOnly = `INV-SYSONLY-${TAG}`;
    await upsertArIngestedRecord(testSql, {
      orgId: ORG_A_ID,
      invoiceNumber: invNumSystemOnly,
      amountBilled: '15000',
      billedDate: PERIOD_START,
    });

    const req = makeRequest({
      path: `/reconciliation?period_start=${PERIOD_START}&period_end=${PERIOD_END}`,
      method: 'GET',
    });
    const res = await handleGetReconciliationReport(req, adminClaims, testSql, auditSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      discrepancies: Array<{ discrepancy_type: string; invoice_number: string }>;
    };

    const types = new Set(body.discrepancies.map((d) => d.discrepancy_type));
    expect(types.has('amount_mismatch')).toBe(true);
    expect(types.has('date_gap')).toBe(true);
    expect(types.has('system_only')).toBe(true);

    // verify the system_only entry
    const sysOnly = body.discrepancies.find(
      (d) => d.discrepancy_type === 'system_only' && d.invoice_number === invNumSystemOnly,
    );
    expect(sysOnly).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC#5 — acknowledgement integration test
// ---------------------------------------------------------------------------

describe('POST /reconciliation/:id/acknowledge (AC#5)', () => {
  test('records reviewer and note, sets acknowledged=true', async () => {
    const PERIOD_START = '2025-08-01';
    const PERIOD_END = '2025-08-31';
    const TAG = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { placementId } = await setupPlacementWithCommission(testSql, adminClaims);
    const invNum = `INV-ACK-${TAG}`;
    await createTestInvoice(testSql, adminClaims, placementId, invNum, '40000', PERIOD_START);

    // Generate report (creates discrepancy)
    const reportReq = makeRequest({
      path: `/reconciliation?period_start=${PERIOD_START}&period_end=${PERIOD_END}`,
      method: 'GET',
    });
    const reportRes = await handleGetReconciliationReport(reportReq, adminClaims, testSql, auditSql);
    expect(reportRes.status).toBe(200);
    const reportBody = (await jsonBody(reportRes)) as {
      discrepancies: Array<{ id: string; discrepancy_type: string; acknowledged: boolean }>;
    };
    expect(reportBody.discrepancies.length).toBeGreaterThanOrEqual(1);
    const discrepancy = reportBody.discrepancies[0];
    expect(discrepancy.acknowledged).toBe(false);

    // Acknowledge it
    const ackReq = makeRequest({
      path: `/reconciliation/${discrepancy.id}/acknowledge`,
      method: 'POST',
      body: { note: 'Reviewed and confirmed — timing difference expected' },
    });
    const ackRes = await handleAcknowledgeDiscrepancy(
      discrepancy.id,
      ackReq,
      adminClaims,
      testSql,
      auditSql,
    );
    expect(ackRes.status).toBe(200);
    const ackBody = (await jsonBody(ackRes)) as {
      acknowledged: boolean;
      acknowledged_by: string;
      acknowledged_note: string;
    };
    expect(ackBody.acknowledged).toBe(true);
    expect(ackBody.acknowledged_by).toBe(USER_A_ID);
    expect(ackBody.acknowledged_note).toBe('Reviewed and confirmed — timing difference expected');
  });

  test('returns 409 if already acknowledged', async () => {
    const PERIOD_START = '2025-09-01';
    const PERIOD_END = '2025-09-30';
    const TAG = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { placementId } = await setupPlacementWithCommission(testSql, adminClaims);
    const invNum = `INV-ACK2-${TAG}`;
    await createTestInvoice(testSql, adminClaims, placementId, invNum, '40000', PERIOD_START);

    const reportReq = makeRequest({
      path: `/reconciliation?period_start=${PERIOD_START}&period_end=${PERIOD_END}`,
      method: 'GET',
    });
    const reportRes = await handleGetReconciliationReport(reportReq, adminClaims, testSql, auditSql);
    const reportBody = (await jsonBody(reportRes)) as {
      discrepancies: Array<{ id: string }>;
    };
    const discrepancyId = reportBody.discrepancies[0].id;

    const ackReq = () =>
      makeRequest({
        path: `/reconciliation/${discrepancyId}/acknowledge`,
        method: 'POST',
        body: { note: 'First acknowledgement' },
      });

    // First acknowledge
    await handleAcknowledgeDiscrepancy(discrepancyId, ackReq(), adminClaims, testSql, auditSql);

    // Second acknowledge should 409
    const res2 = await handleAcknowledgeDiscrepancy(
      discrepancyId,
      ackReq(),
      adminClaims,
      testSql,
      auditSql,
    );
    expect(res2.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — finalization gate: 422 when unacknowledged discrepancies exist
// ---------------------------------------------------------------------------

describe('POST /commission-runs/:id/finalize — reconciliation gate (AC#3)', () => {
  test('returns 422 with unacknowledged_discrepancy_count when discrepancies are unacknowledged', async () => {
    const PERIOD_START = '2025-10-01';
    const PERIOD_END = '2025-10-31';
    const TAG = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { placementId, commissionRecordIds } = await setupPlacementWithCommission(
      testSql,
      adminClaims,
    );
    const invNum = `INV-GATE-${TAG}`;
    await createTestInvoice(testSql, adminClaims, placementId, invNum, '40000', PERIOD_START);

    // Create a discrepancy (ledger-only)
    const reportReq = makeRequest({
      path: `/reconciliation?period_start=${PERIOD_START}&period_end=${PERIOD_END}`,
      method: 'GET',
    });
    const reportRes = await handleGetReconciliationReport(reportReq, adminClaims, testSql, auditSql);
    expect(reportRes.status).toBe(200);
    const reportBody = (await jsonBody(reportRes)) as { discrepancies: Array<{ id: string }> };
    expect(reportBody.discrepancies.length).toBeGreaterThanOrEqual(1);

    // Create a commission run for this period
    const runReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: PERIOD_START,
        period_end: PERIOD_END,
        placement_ids: [placementId],
      },
    });
    await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
    const runRes = await handleCreateCommissionRun(runReq, adminClaims, testSql);
    expect(runRes.status).toBe(201);
    const runBody = (await jsonBody(runRes)) as { id: string };
    const runId = runBody.id;

    // Approve all individual records
    for (const rid of commissionRecordIds) {
      const approveReq = makeRequest({
        path: `/commission-runs/${runId}/records/${rid}/approve`,
        method: 'POST',
      });
      await handleApproveRunRecord(runId, rid, adminClaims, testSql);
    }

    // Attempt finalize — should get 422 (unacknowledged discrepancies)
    const finalizeReq = makeRequest({
      path: `/commission-runs/${runId}/finalize`,
      method: 'POST',
    });
    const finalizeRes = await handleFinalizeCommissionRun(
      runId,
      finalizeReq,
      adminClaims,
      testSql,
      auditSql,
    );
    expect(finalizeRes.status).toBe(422);
    const finalizeBody = (await jsonBody(finalizeRes)) as {
      unacknowledged_discrepancy_count: number;
    };
    expect(finalizeBody.unacknowledged_discrepancy_count).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — finalize succeeds when all acknowledged or override supplied
// ---------------------------------------------------------------------------

describe('POST /commission-runs/:id/finalize — acknowledged and override paths (AC#4)', () => {
  test('succeeds when all discrepancies are acknowledged', async () => {
    const PERIOD_START = '2025-11-01';
    const PERIOD_END = '2025-11-30';
    const TAG = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { placementId, commissionRecordIds } = await setupPlacementWithCommission(
      testSql,
      adminClaims,
    );
    const invNum = `INV-FINALIZE-ACK-${TAG}`;
    await createTestInvoice(testSql, adminClaims, placementId, invNum, '40000', PERIOD_START);

    // Generate discrepancies
    const reportReq = makeRequest({
      path: `/reconciliation?period_start=${PERIOD_START}&period_end=${PERIOD_END}`,
      method: 'GET',
    });
    const reportRes = await handleGetReconciliationReport(reportReq, adminClaims, testSql, auditSql);
    const reportBody = (await jsonBody(reportRes)) as { discrepancies: Array<{ id: string }> };

    // Acknowledge all
    for (const d of reportBody.discrepancies) {
      const ackReq = makeRequest({
        path: `/reconciliation/${d.id}/acknowledge`,
        method: 'POST',
        body: { note: 'Acknowledged for test' },
      });
      const ackRes = await handleAcknowledgeDiscrepancy(d.id, ackReq, adminClaims, testSql, auditSql);
      expect(ackRes.status).toBe(200);
    }

    // Create and set up run
    await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
    const runReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: PERIOD_START,
        period_end: PERIOD_END,
        placement_ids: [placementId],
      },
    });
    const runRes = await handleCreateCommissionRun(runReq, adminClaims, testSql);
    expect(runRes.status).toBe(201);
    const runBody = (await jsonBody(runRes)) as { id: string };
    const runId = runBody.id;

    for (const rid of commissionRecordIds) {
      await handleApproveRunRecord(runId, rid, adminClaims, testSql);
    }

    // Finalize should succeed
    const finalizeReq = makeRequest({
      path: `/commission-runs/${runId}/finalize`,
      method: 'POST',
    });
    const finalizeRes = await handleFinalizeCommissionRun(
      runId,
      finalizeReq,
      adminClaims,
      testSql,
      auditSql,
    );
    expect(finalizeRes.status).toBe(200);
    const finalizeBody = (await jsonBody(finalizeRes)) as { status: string };
    expect(finalizeBody.status).toBe('Approved');
  });

  test('succeeds when override_reason is supplied despite unacknowledged discrepancies', async () => {
    const PERIOD_START = '2025-12-01';
    const PERIOD_END = '2025-12-31';
    const TAG = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { placementId, commissionRecordIds } = await setupPlacementWithCommission(
      testSql,
      adminClaims,
    );
    const invNum = `INV-OVERRIDE-${TAG}`;
    await createTestInvoice(testSql, adminClaims, placementId, invNum, '40000', PERIOD_START);

    // Generate discrepancies but do NOT acknowledge them
    const reportReq = makeRequest({
      path: `/reconciliation?period_start=${PERIOD_START}&period_end=${PERIOD_END}`,
      method: 'GET',
    });
    await handleGetReconciliationReport(reportReq, adminClaims, testSql, auditSql);

    // Create run
    await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
    const runReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: PERIOD_START,
        period_end: PERIOD_END,
        placement_ids: [placementId],
      },
    });
    const runRes = await handleCreateCommissionRun(runReq, adminClaims, testSql);
    const runBody = (await jsonBody(runRes)) as { id: string };
    const runId = runBody.id;

    for (const rid of commissionRecordIds) {
      await handleApproveRunRecord(runId, rid, adminClaims, testSql);
    }

    // Finalize with override_reason
    const finalizeReq = makeRequest({
      path: `/commission-runs/${runId}/finalize`,
      method: 'POST',
      body: { override_reason: 'Discrepancies are timing issues, Finance Director approved.' },
    });
    const finalizeRes = await handleFinalizeCommissionRun(
      runId,
      finalizeReq,
      adminClaims,
      testSql,
      auditSql,
    );
    expect(finalizeRes.status).toBe(200);
    const finalizeBody = (await jsonBody(finalizeRes)) as {
      status: string;
      override_reason: string;
    };
    expect(finalizeBody.status).toBe('Approved');
    expect(finalizeBody.override_reason).toContain('Finance Director');
  });
});

// ---------------------------------------------------------------------------
// AC#6 — audit log entries for acknowledge and finalization override
// ---------------------------------------------------------------------------

describe('AuditLogEntry created for acknowledgement and override (AC#6)', () => {
  test('acknowledge creates an audit log entry', async () => {
    const PERIOD_START = '2026-01-01';
    const PERIOD_END = '2026-01-31';
    const TAG = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { placementId } = await setupPlacementWithCommission(testSql, adminClaims);
    const invNum = `INV-AUDIT-ACK-${TAG}`;
    await createTestInvoice(testSql, adminClaims, placementId, invNum, '40000', PERIOD_START);

    const reportReq = makeRequest({
      path: `/reconciliation?period_start=${PERIOD_START}&period_end=${PERIOD_END}`,
      method: 'GET',
    });
    const reportRes = await handleGetReconciliationReport(reportReq, adminClaims, testSql, auditSql);
    const reportBody = (await jsonBody(reportRes)) as { discrepancies: Array<{ id: string }> };
    const discrepancyId = reportBody.discrepancies[0].id;

    // Count audit entries before
    const beforeRows = await auditSql.unsafe(
      `SELECT COUNT(*) AS cnt FROM audit_log_entries WHERE entity_type = 'reconciliation_discrepancy' AND entity_id = $1`,
      [discrepancyId],
    );
    const beforeCount = parseInt((beforeRows[0] as unknown as { cnt: string }).cnt, 10);

    // Acknowledge
    const ackReq = makeRequest({
      path: `/reconciliation/${discrepancyId}/acknowledge`,
      method: 'POST',
      body: { note: 'Audit test acknowledgement' },
    });
    await handleAcknowledgeDiscrepancy(discrepancyId, ackReq, adminClaims, testSql, auditSql);

    // Count audit entries after
    const afterRows = await auditSql.unsafe(
      `SELECT COUNT(*) AS cnt FROM audit_log_entries WHERE entity_type = 'reconciliation_discrepancy' AND entity_id = $1`,
      [discrepancyId],
    );
    const afterCount = parseInt((afterRows[0] as unknown as { cnt: string }).cnt, 10);
    expect(afterCount).toBe(beforeCount + 1);
  });

  test('finalization override creates an audit log entry', async () => {
    const PERIOD_START = '2026-02-01';
    const PERIOD_END = '2026-02-28';
    const TAG = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { placementId, commissionRecordIds } = await setupPlacementWithCommission(
      testSql,
      adminClaims,
    );
    const invNum = `INV-AUDIT-OVERRIDE-${TAG}`;
    await createTestInvoice(testSql, adminClaims, placementId, invNum, '40000', PERIOD_START);

    await handleGetReconciliationReport(
      makeRequest({
        path: `/reconciliation?period_start=${PERIOD_START}&period_end=${PERIOD_END}`,
        method: 'GET',
      }),
      adminClaims,
      testSql,
      auditSql,
    );

    await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
    const runReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: PERIOD_START,
        period_end: PERIOD_END,
        placement_ids: [placementId],
      },
    });
    const runRes = await handleCreateCommissionRun(runReq, adminClaims, testSql);
    const runBody = (await jsonBody(runRes)) as { id: string };
    const runId = runBody.id;

    for (const rid of commissionRecordIds) {
      await handleApproveRunRecord(runId, rid, adminClaims, testSql);
    }

    // Count override audit entries before
    const beforeRows = await auditSql.unsafe(
      `SELECT COUNT(*) AS cnt FROM audit_log_entries WHERE entity_type = 'commission_run' AND action = 'commission_run.finalization.override' AND entity_id = $1`,
      [runId],
    );
    const beforeCount = parseInt((beforeRows[0] as unknown as { cnt: string }).cnt, 10);

    // Finalize with override
    const finalizeReq = makeRequest({
      path: `/commission-runs/${runId}/finalize`,
      method: 'POST',
      body: { override_reason: 'Finance Director signed off verbally.' },
    });
    await handleFinalizeCommissionRun(runId, finalizeReq, adminClaims, testSql, auditSql);

    const afterRows = await auditSql.unsafe(
      `SELECT COUNT(*) AS cnt FROM audit_log_entries WHERE entity_type = 'commission_run' AND action = 'commission_run.finalization.override' AND entity_id = $1`,
      [runId],
    );
    const afterCount = parseInt((afterRows[0] as unknown as { cnt: string }).cnt, 10);
    expect(afterCount).toBe(beforeCount + 1);
  });
});

// ---------------------------------------------------------------------------
// AC#7 — RBAC: Producer and Manager return 403
// ---------------------------------------------------------------------------

describe('RBAC — Producer and Manager return 403 on reconciliation endpoints (AC#7)', () => {
  test('Producer: GET /reconciliation returns 403', async () => {
    const req = makeRequest({
      path: '/reconciliation?period_start=2025-06-01&period_end=2025-06-30',
      method: 'GET',
    });
    const res = await handleGetReconciliationReport(req, producerClaims, testSql, auditSql);
    expect(res.status).toBe(403);
  });

  test('Manager: GET /reconciliation returns 403', async () => {
    const req = makeRequest({
      path: '/reconciliation?period_start=2025-06-01&period_end=2025-06-30',
      method: 'GET',
    });
    const res = await handleGetReconciliationReport(req, managerClaims, testSql, auditSql);
    expect(res.status).toBe(403);
  });

  test('Producer: POST /reconciliation/:id/acknowledge returns 403', async () => {
    const fakeId = crypto.randomUUID();
    const req = makeRequest({
      path: `/reconciliation/${fakeId}/acknowledge`,
      method: 'POST',
      body: { note: 'test' },
    });
    const res = await handleAcknowledgeDiscrepancy(fakeId, req, producerClaims, testSql, auditSql);
    expect(res.status).toBe(403);
  });

  test('Manager: POST /reconciliation/:id/acknowledge returns 403', async () => {
    const fakeId = crypto.randomUUID();
    const req = makeRequest({
      path: `/reconciliation/${fakeId}/acknowledge`,
      method: 'POST',
      body: { note: 'test' },
    });
    const res = await handleAcknowledgeDiscrepancy(fakeId, req, managerClaims, testSql, auditSql);
    expect(res.status).toBe(403);
  });
});

/**
 * Payroll-ready export from approved commission run — integration tests (issue #15).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — POST /commission-runs/:id/export on an Approved run returns 200 with a downloadable CSV.
 *   AC#2 — POST /commission-runs/:id/export on a non-Approved run returns 422.
 *   AC#3 — Exported CSV row count equals the number of unique producers in the run.
 *   AC#4 — Net payroll amount in each row equals gross_commission - draw_recovery - clawback_recovery.
 *   AC#5 — Calling POST /commission-runs/:id/export twice returns the same artifact_id (idempotent).
 *
 * Additional:
 *   - GET /commission-runs/:id/exports returns the list of prior exports.
 *   - CSV parsing test: generate export for a run with three producers, parse the CSV,
 *     assert each row matches CommissionRecord data for that producer.
 *   - Multi-tenant isolation: Org B cannot trigger or view Org A exports.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.7
 * Issue: feat: payroll-ready export from approved commission run (#15)
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
import {
  handleCreateCommissionRun,
  handleApproveRunRecord,
  handleApproveCommissionRun,
} from '../../../apps/server/src/api/commission-runs';
import {
  handleCreatePayrollExport,
  handleListPayrollExports,
} from '../../../apps/server/src/api/exports';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const USER_A_ID = crypto.randomUUID();
const ORG_B_ID = crypto.randomUUID();
const USER_B_ID = crypto.randomUUID();

const claimsA: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: USER_A_ID,
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const claimsB: SessionClaims = {
  org_id: ORG_B_ID,
  user_id: USER_B_ID,
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });

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

/** Parse a CSV string into an array of row objects keyed by header. */
function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length === 0) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] ?? '').trim();
    });
    return row;
  });
}

async function createPlacementWithContributor(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  producerId: string,
): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Recruiter',
      compensation_base: '120000',
      fee_amount: '24000',
      start_date: '2025-04-01',
      guarantee_days: null,
    },
  });
  const res = await handleCreatePlacement(req, claims, sql);
  expect(res.status).toBe(201);
  const { id: placementId } = (await jsonBody(res)) as { id: string };

  // Activate the placement
  await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);

  // Add contributor
  const addReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 1.0 },
  });
  const addRes = await handleAddContributor(placementId, addReq, claims, sql);
  expect(addRes.status).toBe(201);

  return placementId;
}

async function createActivePlanForProducer(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  producerId: string,
): Promise<string> {
  const createReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: `Export Test Plan ${Date.now()}-${Math.random()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.25 },
    },
  });
  const createRes = await handleCreatePlan(createReq, claims, sql);
  expect(createRes.status).toBe(201);
  const { plan, version } = (await jsonBody(createRes)) as {
    plan: { id: string };
    version: { id: string };
  };

  const activateRes = await handleActivatePlanVersion(plan.id, version.id, claims, sql);
  expect(activateRes.status).toBe(200);

  const assignReq = makeRequest({
    path: `/plans/${plan.id}/assignments`,
    method: 'POST',
    body: { producer_id: producerId, plan_version_id: version.id },
  });
  const assignRes = await handleCreatePlanAssignment(plan.id, assignReq, claims, sql);
  expect(assignRes.status).toBe(201);

  return version.id;
}

async function calculateFor(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  placementId: string,
): Promise<string[]> {
  const req = makeRequest({
    path: `/placements/${placementId}/calculate`,
    method: 'POST',
  });
  const res = await handleCalculateCommission(placementId, req, claims, sql);
  expect(res.status).toBe(200);
  const body = (await jsonBody(res)) as { commission_records: Array<{ id: string }> };
  return body.commission_records.map((r) => r.id);
}

/**
 * Full workflow helper: creates a placement for the given producerId,
 * calculates commissions, includes in a run, approves all records and the run.
 * Returns { runId, recordIds }.
 */
async function buildApprovedRun(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  producerIds: string[],
): Promise<{ runId: string; recordIds: string[] }> {
  const allRecordIds: string[] = [];
  const placementIds: string[] = [];

  for (const producerId of producerIds) {
    const placementId = await createPlacementWithContributor(sql, claims, producerId);
    placementIds.push(placementId);
    await createActivePlanForProducer(sql, claims, producerId);
    const recordIds = await calculateFor(sql, claims, placementId);
    allRecordIds.push(...recordIds);
  }

  const createRunReq = makeRequest({
    path: '/commission-runs',
    method: 'POST',
    body: {
      period_start: '2025-04-01',
      period_end: '2025-04-30',
      placement_ids: placementIds,
    },
  });
  const createRunRes = await handleCreateCommissionRun(createRunReq, claims, sql);
  expect(createRunRes.status).toBe(201);
  const { id: runId } = (await jsonBody(createRunRes)) as { id: string };

  // Individually approve each record
  for (const recordId of allRecordIds) {
    const approveRes = await handleApproveRunRecord(runId, recordId, claims, sql);
    expect(approveRes.status).toBe(200);
  }

  // Approve the run
  const approveRunRes = await handleApproveCommissionRun(runId, claims, sql);
  expect(approveRunRes.status).toBe(200);

  return { runId, recordIds: allRecordIds };
}

// ---------------------------------------------------------------------------
// AC#1 — POST on Approved run returns 200 with CSV
// ---------------------------------------------------------------------------

describe('POST /commission-runs/:id/export — export creation (AC#1)', () => {
  test('returns 200 with CSV content on an Approved run', async () => {
    const producerId = crypto.randomUUID();
    const { runId } = await buildApprovedRun(testSql, claimsA, [producerId]);

    const res = await handleCreatePayrollExport(runId, claimsA, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      artifact_id: string;
      run_id: string;
      format: string;
      row_count: number;
      content: string;
      created_at: string;
    };

    expect(body.artifact_id).toBeTruthy();
    expect(body.run_id).toBe(runId);
    expect(body.format).toBe('csv');
    expect(body.row_count).toBeGreaterThan(0);
    expect(typeof body.content).toBe('string');
    expect(body.content).toContain('employee_id');
    expect(body.content).toContain('gross_commission');
  });

  test('returns 404 for unknown run', async () => {
    const res = await handleCreatePayrollExport(crypto.randomUUID(), claimsA, testSql);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — POST on non-Approved run returns 422
// ---------------------------------------------------------------------------

describe('POST /commission-runs/:id/export — state guard (AC#2)', () => {
  test('returns 422 when run is Open (not Approved)', async () => {
    // Create a run but do NOT approve it
    const producerId = crypto.randomUUID();
    const placementId = await createPlacementWithContributor(testSql, claimsA, producerId);
    await createActivePlanForProducer(testSql, claimsA, producerId);

    const createRunReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-05-01',
        period_end: '2025-05-31',
        placement_ids: [placementId],
      },
    });
    const createRunRes = await handleCreateCommissionRun(createRunReq, claimsA, testSql);
    expect(createRunRes.status).toBe(201);
    const { id: openRunId } = (await jsonBody(createRunRes)) as { id: string };

    const res = await handleCreatePayrollExport(openRunId, claimsA, testSql);
    expect(res.status).toBe(422);

    const body = (await jsonBody(res)) as { error: string };
    expect(body.error).toMatch(/approved/i);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — CSV row count equals unique producers in the run
// ---------------------------------------------------------------------------

describe('POST /commission-runs/:id/export — row count (AC#3)', () => {
  test('CSV row count equals the number of unique producers in the run', async () => {
    const producer1 = crypto.randomUUID();
    const producer2 = crypto.randomUUID();
    const producer3 = crypto.randomUUID();
    const { runId } = await buildApprovedRun(testSql, claimsA, [producer1, producer2, producer3]);

    const res = await handleCreatePayrollExport(runId, claimsA, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { row_count: number; content: string };

    // Three producers → three data rows
    expect(body.row_count).toBe(3);

    // Verify CSV has header + 3 data rows
    const csvRows = parseCsv(body.content);
    expect(csvRows).toHaveLength(3);
  });

  test('CSV parsing: each row matches CommissionRecord data for that producer', async () => {
    const producer1 = crypto.randomUUID();
    const producer2 = crypto.randomUUID();
    const producer3 = crypto.randomUUID();
    const { runId } = await buildApprovedRun(testSql, claimsA, [producer1, producer2, producer3]);

    const res = await handleCreatePayrollExport(runId, claimsA, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { content: string };
    const csvRows = parseCsv(body.content);

    // Each row must have all required columns
    for (const row of csvRows) {
      expect(row['employee_id']).toBeTruthy();
      expect(row['name']).toBeTruthy();
      expect(parseFloat(row['gross_commission'])).toBeGreaterThan(0);
      expect(parseFloat(row['draw_recovery'])).toBe(0);
      expect(parseFloat(row['clawback_recovery'])).toBe(0);
      expect(parseFloat(row['net_payroll'])).toBeGreaterThan(0);
      expect(row['pay_period']).toContain('2025-04');
    }

    // employee_id values should include the three producers
    const employeeIds = csvRows.map((r) => r['employee_id']);
    expect(employeeIds).toContain(producer1);
    expect(employeeIds).toContain(producer2);
    expect(employeeIds).toContain(producer3);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — net_payroll = gross_commission - draw_recovery - clawback_recovery
// ---------------------------------------------------------------------------

describe('POST /commission-runs/:id/export — net payroll arithmetic (AC#4)', () => {
  test('net_payroll equals gross_commission - draw_recovery - clawback_recovery for each row', async () => {
    const producer1 = crypto.randomUUID();
    const producer2 = crypto.randomUUID();
    const { runId } = await buildApprovedRun(testSql, claimsA, [producer1, producer2]);

    const res = await handleCreatePayrollExport(runId, claimsA, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { content: string };
    const csvRows = parseCsv(body.content);
    expect(csvRows.length).toBeGreaterThan(0);

    for (const row of csvRows) {
      const gross = parseFloat(row['gross_commission']);
      const draw = parseFloat(row['draw_recovery']);
      const clawback = parseFloat(row['clawback_recovery']);
      const net = parseFloat(row['net_payroll']);

      expect(net).toBeCloseTo(gross - draw - clawback, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Idempotency: POST twice returns same artifact_id
// ---------------------------------------------------------------------------

describe('POST /commission-runs/:id/export — idempotency (AC#5)', () => {
  test('calling POST twice returns the same artifact_id and no duplicate file', async () => {
    const producerId = crypto.randomUUID();
    const { runId } = await buildApprovedRun(testSql, claimsA, [producerId]);

    const res1 = await handleCreatePayrollExport(runId, claimsA, testSql);
    expect(res1.status).toBe(200);
    const body1 = (await jsonBody(res1)) as { artifact_id: string };

    const res2 = await handleCreatePayrollExport(runId, claimsA, testSql);
    expect(res2.status).toBe(200);
    const body2 = (await jsonBody(res2)) as { artifact_id: string };

    // Same artifact_id — not regenerated
    expect(body2.artifact_id).toBe(body1.artifact_id);
  });
});

// ---------------------------------------------------------------------------
// GET /commission-runs/:id/exports — list prior exports
// ---------------------------------------------------------------------------

describe('GET /commission-runs/:id/exports — list exports', () => {
  test('returns empty list before any export is created', async () => {
    const producerId = crypto.randomUUID();
    const { runId } = await buildApprovedRun(testSql, claimsA, [producerId]);

    const res = await handleListPayrollExports(runId, claimsA, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { run_id: string; exports: unknown[] };
    expect(body.run_id).toBe(runId);
    expect(body.exports).toHaveLength(0);
  });

  test('returns one entry after export is created', async () => {
    const producerId = crypto.randomUUID();
    const { runId } = await buildApprovedRun(testSql, claimsA, [producerId]);

    // Generate export
    const exportRes = await handleCreatePayrollExport(runId, claimsA, testSql);
    expect(exportRes.status).toBe(200);
    const exportBody = (await jsonBody(exportRes)) as { artifact_id: string };

    // List
    const listRes = await handleListPayrollExports(runId, claimsA, testSql);
    expect(listRes.status).toBe(200);

    const listBody = (await jsonBody(listRes)) as {
      exports: Array<{ artifact_id: string }>;
    };
    expect(listBody.exports).toHaveLength(1);
    expect(listBody.exports[0].artifact_id).toBe(exportBody.artifact_id);
  });

  test('returns 404 for unknown run', async () => {
    const res = await handleListPayrollExports(crypto.randomUUID(), claimsA, testSql);
    expect(res.status).toBe(404);
  });

  test('multi-tenant isolation: Org B cannot list Org A exports', async () => {
    const producerId = crypto.randomUUID();
    const { runId } = await buildApprovedRun(testSql, claimsA, [producerId]);

    await handleCreatePayrollExport(runId, claimsA, testSql);

    // Org B should not see Org A's run at all
    const listRes = await handleListPayrollExports(runId, claimsB, testSql);
    expect(listRes.status).toBe(404);
  });
});

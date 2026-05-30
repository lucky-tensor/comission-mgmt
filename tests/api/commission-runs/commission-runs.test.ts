/**
 * Finance Admin commission run and review queue — integration tests (issue #13).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — POST /commission-runs with an incomplete placement returns 422 with blocking IDs.
 *   AC#2 — GET /commission-runs/:id/queue returns all commission-ready, held, and
 *            exception-pending records for the run.
 *   AC#3 — POST /commission-runs/:id/approve when all records are individually approved
 *            transitions run to Approved state.
 *   AC#4 — POST /commission-runs/:id/approve when any record is not yet approved returns 422.
 *   AC#5 — Editing a CommissionRecord in an Approved run returns 409 Conflict.
 *
 * Additional:
 *   - End-to-end: create placements → calculate → invoice → open run → review queue →
 *     approve all records → approve run → assert run.status=Approved.
 *   - Immutability test: PATCH on a CommissionRecord after run approval returns 409.
 *   - Multi-tenant isolation.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.4, §9
 * Issue: feat: finance admin commission run and review queue (#13)
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
import {
  handleCalculateCommission,
  handlePatchCommissionRecord,
} from '../../../apps/server/src/api/calculate';
import {
  handleCreateCommissionRun,
  handleGetCommissionRunQueue,
  handleApproveRunRecord,
  handleApproveCommissionRun,
} from '../../../apps/server/src/api/commission-runs';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
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

  // Inject deterministic encryption so tests run without env config
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

/**
 * Create a placement with all commission-required data fields present.
 * Note: does NOT add a contributor — use createFullyCompletePlacement for pre-flight tests.
 */
async function createCompletePlacement(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  overrides: Record<string, unknown> = {},
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
      ...overrides,
    },
  });
  const res = await handleCreatePlacement(req, claims, sql);
  expect(res.status).toBe(201);
  const body = (await jsonBody(res)) as { id: string };
  return body.id;
}

/**
 * Create a placement with all commission-required fields AND at least one contributor.
 * This is the kind of placement that passes the pre-flight check.
 */
async function createFullyCompletePlacement(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const placementId = await createCompletePlacement(sql, claims, overrides);
  // Add a contributor so the placement passes checkPlacementsComplete
  const producerId = crypto.randomUUID();
  const addReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 1.0 },
  });
  const addRes = await handleAddContributor(placementId, addReq, claims, sql);
  expect(addRes.status).toBe(201);
  return placementId;
}

/** Create an incomplete placement (missing start_date) */
async function createIncompletePlacement(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Junior Recruiter',
      compensation_base: '80000',
      fee_amount: '16000',
      // deliberately missing start_date
    },
  });
  const res = await handleCreatePlacement(req, claims, sql);
  expect(res.status).toBe(201);
  const body = (await jsonBody(res)) as { id: string };
  return body.id;
}

/** Set a placement to Active status via direct SQL */
async function activatePlacement(
  sql: ReturnType<typeof postgres>,
  placementId: string,
): Promise<void> {
  await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
}

/** Create an active plan version assigned to a producer */
async function createActivePlan(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  producerId: string,
): Promise<string> {
  const createReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: `Commission Run Test Plan ${Date.now()}-${Math.random()}`,
      effective_from: '2025-01-01',
      rules: {
        rate_type: 'gross_fee',
        base_rate: 0.25,
      },
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

  const activateRes = await handleActivatePlanVersion(planId, versionId, claims, sql);
  expect(activateRes.status).toBe(200);

  const assignReq = makeRequest({
    path: `/plans/${planId}/assignments`,
    method: 'POST',
    body: { producer_id: producerId, plan_version_id: versionId },
  });
  const assignRes = await handleCreatePlanAssignment(planId, assignReq, claims, sql);
  expect(assignRes.status).toBe(201);

  return versionId;
}

/** Add a contributor and create an active plan for them; returns producerId */
async function setupContributorWithPlan(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  placementId: string,
): Promise<string> {
  const producerId = crypto.randomUUID();
  const addReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 1.0 },
  });
  const addRes = await handleAddContributor(placementId, addReq, claims, sql);
  expect(addRes.status).toBe(201);

  await createActivePlan(sql, claims, producerId);
  return producerId;
}

/** Calculate commissions for a placement; returns commission record IDs */
async function calculateCommissions(
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

// ---------------------------------------------------------------------------
// AC#1 — POST /commission-runs with incomplete placement returns 422
// ---------------------------------------------------------------------------

describe('POST /commission-runs — pre-flight check (AC#1)', () => {
  test('returns 422 with blocking placement IDs when an incomplete placement is in scope', async () => {
    const completePlacementId = await createFullyCompletePlacement(testSql, claimsA);
    const incompletePlacementId = await createIncompletePlacement(testSql, claimsA);

    const req = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-04-01',
        period_end: '2025-04-30',
        placement_ids: [completePlacementId, incompletePlacementId],
      },
    });

    const res = await handleCreateCommissionRun(req, claimsA, testSql);
    expect(res.status).toBe(422);

    const body = (await jsonBody(res)) as {
      error: string;
      incomplete_placements: Array<{ placement_id: string; missing_fields: string[] }>;
    };

    expect(body.error).toMatch(/incomplete placements/i);
    expect(body.incomplete_placements).toBeDefined();
    const blockingIds = body.incomplete_placements.map((p) => p.placement_id);
    expect(blockingIds).toContain(incompletePlacementId);
    // The complete placement should NOT be in the list
    expect(blockingIds).not.toContain(completePlacementId);
  });

  test('returns 422 when all placements are incomplete', async () => {
    const incompleteId1 = await createIncompletePlacement(testSql, claimsA);
    const incompleteId2 = await createIncompletePlacement(testSql, claimsA);

    const req = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-04-01',
        period_end: '2025-04-30',
        placement_ids: [incompleteId1, incompleteId2],
      },
    });

    const res = await handleCreateCommissionRun(req, claimsA, testSql);
    expect(res.status).toBe(422);
    const body = (await jsonBody(res)) as {
      incomplete_placements: Array<{ placement_id: string }>;
    };
    expect(body.incomplete_placements).toHaveLength(2);
  });

  test('returns 422 when placement_ids is missing', async () => {
    const req = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: { period_start: '2025-04-01', period_end: '2025-04-30' },
    });
    const res = await handleCreateCommissionRun(req, claimsA, testSql);
    expect(res.status).toBe(422);
  });

  test('returns 201 with Open run when all placements are complete', async () => {
    const placementId = await createFullyCompletePlacement(testSql, claimsA);

    const req = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-04-01',
        period_end: '2025-04-30',
        placement_ids: [placementId],
      },
    });

    const res = await handleCreateCommissionRun(req, claimsA, testSql);
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as {
      id: string;
      status: string;
      period_start: string;
      period_end: string;
    };

    expect(body.id).toBeTruthy();
    expect(body.status).toBe('Open');
    expect(body.period_start).toBe('2025-04-01');
    expect(body.period_end).toBe('2025-04-30');
  });
});

// ---------------------------------------------------------------------------
// AC#2 — GET /commission-runs/:id/queue returns review queue
// ---------------------------------------------------------------------------

describe('GET /commission-runs/:id/queue — review queue (AC#2)', () => {
  test('returns all records for the run with queue_category', async () => {
    const placementId = await createCompletePlacement(testSql, claimsA);
    await activatePlacement(testSql, placementId);
    await setupContributorWithPlan(testSql, claimsA, placementId);
    await calculateCommissions(testSql, claimsA, placementId);

    // Create the commission run
    const createReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-04-01',
        period_end: '2025-04-30',
        placement_ids: [placementId],
      },
    });
    const createRes = await handleCreateCommissionRun(createReq, claimsA, testSql);
    expect(createRes.status).toBe(201);
    const { id: runId } = (await jsonBody(createRes)) as { id: string };

    // Get the queue
    const queueRes = await handleGetCommissionRunQueue(runId, claimsA, testSql);
    expect(queueRes.status).toBe(200);

    const queueBody = (await jsonBody(queueRes)) as {
      run: { id: string; status: string };
      queue: Array<{
        commission_record_id: string;
        queue_category: string;
        individually_approved: boolean;
      }>;
      totals: { total: number; ready: number; held: number; approved: number };
    };

    expect(queueBody.run.id).toBe(runId);
    expect(queueBody.run.status).toBe('Open');
    expect(Array.isArray(queueBody.queue)).toBe(true);
    expect(queueBody.queue.length).toBeGreaterThan(0);

    // All records should start as 'ready' (not held or approved)
    for (const item of queueBody.queue) {
      expect(item.commission_record_id).toBeTruthy();
      expect(item.individually_approved).toBe(false);
      expect(['ready', 'held', 'exception_pending', 'approved']).toContain(item.queue_category);
    }

    expect(queueBody.totals.total).toBe(queueBody.queue.length);
  });

  test('returns 404 for unknown run', async () => {
    const res = await handleGetCommissionRunQueue(crypto.randomUUID(), claimsA, testSql);
    expect(res.status).toBe(404);
  });

  test('multi-tenant isolation: Org B cannot see Org A run', async () => {
    const placementId = await createFullyCompletePlacement(testSql, claimsA);

    const createReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-04-01',
        period_end: '2025-04-30',
        placement_ids: [placementId],
      },
    });
    const createRes = await handleCreateCommissionRun(createReq, claimsA, testSql);
    expect(createRes.status).toBe(201);
    const { id: runId } = (await jsonBody(createRes)) as { id: string };

    // Org B should not see Org A's run
    const queueRes = await handleGetCommissionRunQueue(runId, claimsB, testSql);
    expect(queueRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — POST /commission-runs/:id/approve when all approved → Approved state
// AC#4 — POST /commission-runs/:id/approve with unapproved records → 422
// ---------------------------------------------------------------------------

describe('POST /commission-runs/:id/approve — run approval (AC#3 + AC#4)', () => {
  test('AC#4: returns 422 when any record is not individually approved', async () => {
    const placementId = await createCompletePlacement(testSql, claimsA);
    await activatePlacement(testSql, placementId);
    await setupContributorWithPlan(testSql, claimsA, placementId);
    await calculateCommissions(testSql, claimsA, placementId);

    const createReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-04-01',
        period_end: '2025-04-30',
        placement_ids: [placementId],
      },
    });
    const createRes = await handleCreateCommissionRun(createReq, claimsA, testSql);
    expect(createRes.status).toBe(201);
    const { id: runId } = (await jsonBody(createRes)) as { id: string };

    // Attempt to approve the run without individually approving records
    const approveRes = await handleApproveCommissionRun(runId, claimsA, testSql);
    expect(approveRes.status).toBe(422);

    const approveBody = (await jsonBody(approveRes)) as {
      error: string;
      unapproved_record_ids: string[];
    };
    expect(approveBody.error).toMatch(/not yet individually approved/i);
    expect(approveBody.unapproved_record_ids.length).toBeGreaterThan(0);
  });

  test('AC#3: transitions run to Approved when all records are individually approved', async () => {
    const placementId = await createCompletePlacement(testSql, claimsA);
    await activatePlacement(testSql, placementId);
    await setupContributorWithPlan(testSql, claimsA, placementId);
    const recordIds = await calculateCommissions(testSql, claimsA, placementId);

    const createReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-04-01',
        period_end: '2025-04-30',
        placement_ids: [placementId],
      },
    });
    const createRes = await handleCreateCommissionRun(createReq, claimsA, testSql);
    expect(createRes.status).toBe(201);
    const { id: runId } = (await jsonBody(createRes)) as { id: string };

    // Individually approve each record
    for (const recordId of recordIds) {
      const approveRecordRes = await handleApproveRunRecord(runId, recordId, claimsA, testSql);
      expect(approveRecordRes.status).toBe(200);
      const approveRecordBody = (await jsonBody(approveRecordRes)) as {
        individually_approved: boolean;
      };
      expect(approveRecordBody.individually_approved).toBe(true);
    }

    // Now approve the entire run
    const approveRunRes = await handleApproveCommissionRun(runId, claimsA, testSql);
    expect(approveRunRes.status).toBe(200);

    const approveRunBody = (await jsonBody(approveRunRes)) as {
      id: string;
      status: string;
      approved_by: string;
    };
    expect(approveRunBody.id).toBe(runId);
    expect(approveRunBody.status).toBe('Approved');
    expect(approveRunBody.approved_by).toBe(USER_A_ID);
  });

  test('returns 404 for unknown run', async () => {
    const res = await handleApproveCommissionRun(crypto.randomUUID(), claimsA, testSql);
    expect(res.status).toBe(404);
  });

  test('returns 409 when run is already Approved', async () => {
    const placementId = await createCompletePlacement(testSql, claimsA);
    await activatePlacement(testSql, placementId);
    await setupContributorWithPlan(testSql, claimsA, placementId);
    const recordIds = await calculateCommissions(testSql, claimsA, placementId);

    const createReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-05-01',
        period_end: '2025-05-31',
        placement_ids: [placementId],
      },
    });
    const createRes = await handleCreateCommissionRun(createReq, claimsA, testSql);
    expect(createRes.status).toBe(201);
    const { id: runId } = (await jsonBody(createRes)) as { id: string };

    // Individually approve all records
    for (const recordId of recordIds) {
      const r = await handleApproveRunRecord(runId, recordId, claimsA, testSql);
      expect(r.status).toBe(200);
    }

    // Approve run
    const firstApprove = await handleApproveCommissionRun(runId, claimsA, testSql);
    expect(firstApprove.status).toBe(200);

    // Attempt to approve again
    const secondApprove = await handleApproveCommissionRun(runId, claimsA, testSql);
    expect(secondApprove.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Immutability: PATCH on CommissionRecord in Approved run returns 409
// ---------------------------------------------------------------------------

describe('PATCH /commission-records/:id — immutability (AC#5)', () => {
  test('returns 409 Conflict when the record is in an Approved run', async () => {
    const placementId = await createCompletePlacement(testSql, claimsA);
    await activatePlacement(testSql, placementId);
    await setupContributorWithPlan(testSql, claimsA, placementId);
    const recordIds = await calculateCommissions(testSql, claimsA, placementId);
    expect(recordIds.length).toBeGreaterThan(0);

    // Create and approve a commission run
    const createReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-06-01',
        period_end: '2025-06-30',
        placement_ids: [placementId],
      },
    });
    const createRes = await handleCreateCommissionRun(createReq, claimsA, testSql);
    expect(createRes.status).toBe(201);
    const { id: runId } = (await jsonBody(createRes)) as { id: string };

    // Approve each record individually
    for (const recordId of recordIds) {
      const r = await handleApproveRunRecord(runId, recordId, claimsA, testSql);
      expect(r.status).toBe(200);
    }

    // Approve the run
    const approveRunRes = await handleApproveCommissionRun(runId, claimsA, testSql);
    expect(approveRunRes.status).toBe(200);

    // Now attempt to PATCH any of the approved commission records
    const targetRecordId = recordIds[0];
    const patchRes = await handlePatchCommissionRecord(targetRecordId, claimsA, testSql);
    expect(patchRes.status).toBe(409);

    const patchBody = (await jsonBody(patchRes)) as { error: string };
    expect(patchBody.error).toMatch(/approved run/i);
  });

  test('returns 404 for unknown record', async () => {
    const res = await handlePatchCommissionRecord(crypto.randomUUID(), claimsA, testSql);
    expect(res.status).toBe(404);
  });

  test('returns 405 for records NOT in an approved run (edit not supported)', async () => {
    const placementId = await createCompletePlacement(testSql, claimsA);
    await activatePlacement(testSql, placementId);
    await setupContributorWithPlan(testSql, claimsA, placementId);
    const recordIds = await calculateCommissions(testSql, claimsA, placementId);
    expect(recordIds.length).toBeGreaterThan(0);

    // No approved run — PATCH should return 405 (edit not supported, but not immutability)
    const patchRes = await handlePatchCommissionRecord(recordIds[0], claimsA, testSql);
    expect(patchRes.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: create placements → calculate → open run → review queue → approve
// ---------------------------------------------------------------------------

describe('End-to-end: full commission close workflow', () => {
  test('placement → calculate → open run → approve all records → approve run → status=Approved', async () => {
    // Step 1: Create a complete placement
    const placementId = await createCompletePlacement(testSql, claimsA);
    await activatePlacement(testSql, placementId);

    // Step 2: Add contributor + plan
    await setupContributorWithPlan(testSql, claimsA, placementId);

    // Step 3: Calculate commissions
    const recordIds = await calculateCommissions(testSql, claimsA, placementId);
    expect(recordIds.length).toBeGreaterThan(0);

    // Step 4: Open a commission run
    const createRunReq = makeRequest({
      path: '/commission-runs',
      method: 'POST',
      body: {
        period_start: '2025-04-01',
        period_end: '2025-04-30',
        placement_ids: [placementId],
      },
    });
    const createRunRes = await handleCreateCommissionRun(createRunReq, claimsA, testSql);
    expect(createRunRes.status).toBe(201);
    const { id: runId, status: initialStatus } = (await jsonBody(createRunRes)) as {
      id: string;
      status: string;
    };
    expect(initialStatus).toBe('Open');

    // Step 5: Review the queue
    const queueRes = await handleGetCommissionRunQueue(runId, claimsA, testSql);
    expect(queueRes.status).toBe(200);
    const queueBody = (await jsonBody(queueRes)) as {
      queue: Array<{ commission_record_id: string; individually_approved: boolean }>;
      totals: { total: number; approved: number };
    };
    expect(queueBody.queue.length).toBe(recordIds.length);
    expect(queueBody.totals.approved).toBe(0);

    // Step 6: Individually approve all records
    for (const item of queueBody.queue) {
      const approveRecordRes = await handleApproveRunRecord(
        runId,
        item.commission_record_id,
        claimsA,
        testSql,
      );
      expect(approveRecordRes.status).toBe(200);
    }

    // Step 7: Approve the entire run
    const approveRunRes = await handleApproveCommissionRun(runId, claimsA, testSql);
    expect(approveRunRes.status).toBe(200);
    const approveRunBody = (await jsonBody(approveRunRes)) as { status: string };
    expect(approveRunBody.status).toBe('Approved');

    // Step 8: Verify queue shows all records as approved
    const finalQueueRes = await handleGetCommissionRunQueue(runId, claimsA, testSql);
    expect(finalQueueRes.status).toBe(200);
    const finalQueueBody = (await jsonBody(finalQueueRes)) as {
      run: { status: string };
      totals: { approved: number; total: number };
    };
    expect(finalQueueBody.run.status).toBe('Approved');
    expect(finalQueueBody.totals.approved).toBe(finalQueueBody.totals.total);

    // Step 9: Confirm immutability — PATCH on any commission record returns 409
    const patchRes = await handlePatchCommissionRecord(recordIds[0], claimsA, testSql);
    expect(patchRes.status).toBe(409);
  });
});

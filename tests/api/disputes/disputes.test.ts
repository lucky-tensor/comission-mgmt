/**
 * Payout dispute and question submission — integration tests (issue #18).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — POST /disputes with valid commission_record_id returns 201 with state=Submitted.
 *   AC#2 — GET /disputes for a Producer returns only that producer's disputes.
 *   AC#3 — GET /disputes for a Finance Admin returns all tenant disputes.
 *   AC#4 — POST /disputes/:id/resolve by Finance Admin transitions to Resolved and
 *            records resolution_note; AuditLogEntry created.
 *   AC#5 — POST /disputes/:id/resolve by a Producer returns 403.
 *
 * Additional:
 *   - Scoping test: two producers submit disputes; each GET /disputes returns only their own.
 *   - Resolution test: resolve a dispute, assert state=Resolved and resolution_note persisted.
 *   - RBAC test: Producer attempt to resolve returns 403.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No Vitest mocking helpers are used — real Postgres only (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.8, §4
 * Issue: feat: payout dispute and question submission (#18)
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
  handleCreateDispute,
  handleListDisputes,
  handleResolveDispute,
} from '../../../apps/server/src/api/disputes';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let testAuditSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const ORG_B_ID = crypto.randomUUID();

const financeAdminA: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  testAuditSql = postgres(pg.url, { max: 3 });

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
  await testAuditSql?.end({ timeout: 5 });
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
 * Creates a placement for the given producerId, activates it, adds a contributor.
 * Returns the placement ID.
 */
async function createPlacementWithContributor(
  sql: ReturnType<typeof postgres>,
  adminClaims: SessionClaims,
  producerId: string,
): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Recruiter',
      compensation_base: '100000',
      fee_amount: '15000',
      start_date: '2025-05-01',
      guarantee_days: null,
    },
  });
  const res = await handleCreatePlacement(req, adminClaims, sql);
  expect(res.status).toBe(201);
  const { id: placementId } = (await jsonBody(res)) as { id: string };

  await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);

  const addReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 1.0 },
  });
  const addRes = await handleAddContributor(placementId, addReq, adminClaims, sql);
  expect(addRes.status).toBe(201);

  return placementId;
}

/**
 * Creates and activates a plan, assigns to the producer.
 */
async function createActivePlanForProducer(
  sql: ReturnType<typeof postgres>,
  adminClaims: SessionClaims,
  producerId: string,
): Promise<void> {
  const createReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: `Dispute Test Plan ${Date.now()}-${Math.random()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    },
  });
  const createRes = await handleCreatePlan(createReq, adminClaims, sql);
  expect(createRes.status).toBe(201);
  const { plan, version } = (await jsonBody(createRes)) as {
    plan: { id: string };
    version: { id: string };
  };

  const activateRes = await handleActivatePlanVersion(plan.id, version.id, adminClaims, sql);
  expect(activateRes.status).toBe(200);

  const assignReq = makeRequest({
    path: `/plans/${plan.id}/assignments`,
    method: 'POST',
    body: { producer_id: producerId, plan_version_id: version.id },
  });
  const assignRes = await handleCreatePlanAssignment(plan.id, assignReq, adminClaims, sql);
  expect(assignRes.status).toBe(201);
}

/**
 * Calculates commissions for a placement and returns the first commission record ID.
 */
async function getCommissionRecordId(
  sql: ReturnType<typeof postgres>,
  adminClaims: SessionClaims,
  placementId: string,
): Promise<string> {
  const req = makeRequest({
    path: `/placements/${placementId}/calculate`,
    method: 'POST',
  });
  const res = await handleCalculateCommission(placementId, req, adminClaims, sql);
  expect(res.status).toBe(200);
  const body = (await jsonBody(res)) as { commission_records: Array<{ id: string }> };
  expect(body.commission_records.length).toBeGreaterThan(0);
  return body.commission_records[0].id;
}

// ---------------------------------------------------------------------------
// AC#1 — POST /disputes returns 201 with state=Submitted
// ---------------------------------------------------------------------------

describe('POST /disputes — create dispute (AC#1)', () => {
  test('creates a dispute with state=Submitted for a valid commission_record_id', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementId = await createPlacementWithContributor(testSql, financeAdminA, producerId);
    await createActivePlanForProducer(testSql, financeAdminA, producerId);
    const commissionRecordId = await getCommissionRecordId(testSql, financeAdminA, placementId);

    const req = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: {
        commission_record_id: commissionRecordId,
        description: 'I believe my commission was calculated incorrectly.',
      },
    });
    const res = await handleCreateDispute(req, producerClaims, testSql, testAuditSql);
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as {
      id: string;
      org_id: string;
      commission_record_id: string;
      submitted_by: string;
      description: string;
      state: string;
      resolved_by: string | null;
      resolved_at: string | null;
      resolution_note: string | null;
    };

    expect(body.id).toBeTruthy();
    expect(body.org_id).toBe(ORG_A_ID);
    expect(body.commission_record_id).toBe(commissionRecordId);
    expect(body.submitted_by).toBe(producerId);
    expect(body.description).toBe('I believe my commission was calculated incorrectly.');
    expect(body.state).toBe('Submitted');
    expect(body.resolved_by).toBeNull();
    expect(body.resolved_at).toBeNull();
    expect(body.resolution_note).toBeNull();
  });

  test('returns 422 when commission_record_id is missing', async () => {
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: crypto.randomUUID(),
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { description: 'Missing record id' },
    });
    const res = await handleCreateDispute(req, producerClaims, testSql, testAuditSql);
    expect(res.status).toBe(422);
  });

  test('returns 422 when description is missing', async () => {
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: crypto.randomUUID(),
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { commission_record_id: crypto.randomUUID() },
    });
    const res = await handleCreateDispute(req, producerClaims, testSql, testAuditSql);
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — GET /disputes for Producer returns only their own disputes
// ---------------------------------------------------------------------------

describe('GET /disputes — producer scoping (AC#2)', () => {
  test("Producer sees only their own disputes, not other producers'", async () => {
    const producerAId = crypto.randomUUID();
    const producerBId = crypto.randomUUID();

    const claimsA: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerAId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const claimsB: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerBId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // Create a commission record for producer A
    const placementA = await createPlacementWithContributor(testSql, financeAdminA, producerAId);
    await createActivePlanForProducer(testSql, financeAdminA, producerAId);
    const recordA = await getCommissionRecordId(testSql, financeAdminA, placementA);

    // Create a commission record for producer B
    const placementB = await createPlacementWithContributor(testSql, financeAdminA, producerBId);
    await createActivePlanForProducer(testSql, financeAdminA, producerBId);
    const recordB = await getCommissionRecordId(testSql, financeAdminA, placementB);

    // Producer A submits a dispute
    const disputeReqA = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { commission_record_id: recordA, description: 'Producer A dispute' },
    });
    const disputeResA = await handleCreateDispute(disputeReqA, claimsA, testSql, testAuditSql);
    expect(disputeResA.status).toBe(201);
    const { id: disputeIdA } = (await jsonBody(disputeResA)) as { id: string };

    // Producer B submits a dispute
    const disputeReqB = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { commission_record_id: recordB, description: 'Producer B dispute' },
    });
    const disputeResB = await handleCreateDispute(disputeReqB, claimsB, testSql, testAuditSql);
    expect(disputeResB.status).toBe(201);
    const { id: disputeIdB } = (await jsonBody(disputeResB)) as { id: string };

    // GET /disputes as Producer A — should see only A's disputes
    const listReqA = makeRequest({ path: '/disputes' });
    const listResA = await handleListDisputes(listReqA, claimsA, testSql, testSql);
    expect(listResA.status).toBe(200);
    const listBodyA = (await jsonBody(listResA)) as { disputes: Array<{ id: string }> };
    const idListA = listBodyA.disputes.map((d) => d.id);
    expect(idListA).toContain(disputeIdA);
    expect(idListA).not.toContain(disputeIdB);

    // GET /disputes as Producer B — should see only B's disputes
    const listReqB = makeRequest({ path: '/disputes' });
    const listResB = await handleListDisputes(listReqB, claimsB, testSql, testSql);
    expect(listResB.status).toBe(200);
    const listBodyB = (await jsonBody(listResB)) as { disputes: Array<{ id: string }> };
    const idListB = listBodyB.disputes.map((d) => d.id);
    expect(idListB).toContain(disputeIdB);
    expect(idListB).not.toContain(disputeIdA);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — GET /disputes for Finance Admin returns all tenant disputes
// ---------------------------------------------------------------------------

describe('GET /disputes — Finance Admin sees all tenant disputes (AC#3)', () => {
  test('Finance Admin GET /disputes returns disputes from all producers', async () => {
    const producerCId = crypto.randomUUID();
    const producerDId = crypto.randomUUID();

    const claimsC: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerCId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const claimsD: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerDId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementC = await createPlacementWithContributor(testSql, financeAdminA, producerCId);
    await createActivePlanForProducer(testSql, financeAdminA, producerCId);
    const recordC = await getCommissionRecordId(testSql, financeAdminA, placementC);

    const placementD = await createPlacementWithContributor(testSql, financeAdminA, producerDId);
    await createActivePlanForProducer(testSql, financeAdminA, producerDId);
    const recordD = await getCommissionRecordId(testSql, financeAdminA, placementD);

    // Both producers submit disputes
    const reqC = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { commission_record_id: recordC, description: 'Producer C dispute' },
    });
    const resC = await handleCreateDispute(reqC, claimsC, testSql, testAuditSql);
    expect(resC.status).toBe(201);
    const { id: disputeIdC } = (await jsonBody(resC)) as { id: string };

    const reqD = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { commission_record_id: recordD, description: 'Producer D dispute' },
    });
    const resD = await handleCreateDispute(reqD, claimsD, testSql, testAuditSql);
    expect(resD.status).toBe(201);
    const { id: disputeIdD } = (await jsonBody(resD)) as { id: string };

    // Finance Admin sees both disputes
    const adminListReq = makeRequest({ path: '/disputes' });
    const adminListRes = await handleListDisputes(adminListReq, financeAdminA, testSql, testSql);
    expect(adminListRes.status).toBe(200);
    const adminListBody = (await jsonBody(adminListRes)) as { disputes: Array<{ id: string }> };
    const adminIds = adminListBody.disputes.map((d) => d.id);
    expect(adminIds).toContain(disputeIdC);
    expect(adminIds).toContain(disputeIdD);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — POST /disputes/:id/resolve by Finance Admin → Resolved + AuditLogEntry
// ---------------------------------------------------------------------------

describe('POST /disputes/:id/resolve — Finance Admin resolves (AC#4)', () => {
  test('Finance Admin transitions dispute to Resolved with resolution_note', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementId = await createPlacementWithContributor(testSql, financeAdminA, producerId);
    await createActivePlanForProducer(testSql, financeAdminA, producerId);
    const commissionRecordId = await getCommissionRecordId(testSql, financeAdminA, placementId);

    // Create dispute
    const createReq = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { commission_record_id: commissionRecordId, description: 'Rate seems wrong.' },
    });
    const createRes = await handleCreateDispute(createReq, producerClaims, testSql, testAuditSql);
    expect(createRes.status).toBe(201);
    const { id: disputeId } = (await jsonBody(createRes)) as { id: string };

    // Resolve as Finance Admin
    const resolveReq = makeRequest({
      path: `/disputes/${disputeId}/resolve`,
      method: 'POST',
      body: {
        resolution_note: 'Rate was applied correctly per your commission plan. See attached.',
      },
    });
    const resolveRes = await handleResolveDispute(
      disputeId,
      resolveReq,
      financeAdminA,
      testSql,
      testAuditSql,
    );
    expect(resolveRes.status).toBe(200);

    const body = (await jsonBody(resolveRes)) as {
      id: string;
      state: string;
      resolved_by: string;
      resolved_at: string;
      resolution_note: string;
    };

    expect(body.id).toBe(disputeId);
    expect(body.state).toBe('Resolved');
    expect(body.resolved_by).toBe(financeAdminA.user_id);
    expect(body.resolved_at).toBeTruthy();
    expect(body.resolution_note).toBe(
      'Rate was applied correctly per your commission plan. See attached.',
    );

    // Verify AuditLogEntry was created
    const auditRows = await testAuditSql.unsafe(
      `SELECT * FROM audit_log_entries WHERE entity_type = 'dispute' AND entity_id = $1 AND action = 'dispute.resolved' LIMIT 1`,
      [disputeId],
    );
    expect(auditRows.length).toBe(1);
    expect((auditRows[0] as unknown as { actor_id: string }).actor_id).toBe(financeAdminA.user_id);
  });

  test('returns 409 when dispute is already Resolved', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementId = await createPlacementWithContributor(testSql, financeAdminA, producerId);
    await createActivePlanForProducer(testSql, financeAdminA, producerId);
    const commissionRecordId = await getCommissionRecordId(testSql, financeAdminA, placementId);

    // Create and resolve a dispute
    const createReq = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { commission_record_id: commissionRecordId, description: 'Dispute to double-resolve.' },
    });
    const createRes = await handleCreateDispute(createReq, producerClaims, testSql, testAuditSql);
    expect(createRes.status).toBe(201);
    const { id: disputeId } = (await jsonBody(createRes)) as { id: string };

    const resolveReq1 = makeRequest({
      path: `/disputes/${disputeId}/resolve`,
      method: 'POST',
      body: { resolution_note: 'First resolution.' },
    });
    await handleResolveDispute(disputeId, resolveReq1, financeAdminA, testSql, testAuditSql);

    // Second resolve attempt should return 409
    const resolveReq2 = makeRequest({
      path: `/disputes/${disputeId}/resolve`,
      method: 'POST',
      body: { resolution_note: 'Second resolution attempt.' },
    });
    const resolveRes2 = await handleResolveDispute(
      disputeId,
      resolveReq2,
      financeAdminA,
      testSql,
      testAuditSql,
    );
    expect(resolveRes2.status).toBe(409);
  });

  test('returns 404 for non-existent dispute', async () => {
    const resolveReq = makeRequest({
      path: `/disputes/${crypto.randomUUID()}/resolve`,
      method: 'POST',
      body: { resolution_note: 'Does not exist.' },
    });
    const res = await handleResolveDispute(
      crypto.randomUUID(),
      resolveReq,
      financeAdminA,
      testSql,
      testAuditSql,
    );
    expect(res.status).toBe(404);
  });

  test('returns 422 when resolution_note is missing', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementId = await createPlacementWithContributor(testSql, financeAdminA, producerId);
    await createActivePlanForProducer(testSql, financeAdminA, producerId);
    const commissionRecordId = await getCommissionRecordId(testSql, financeAdminA, placementId);

    const createReq = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: {
        commission_record_id: commissionRecordId,
        description: 'Missing resolution note test.',
      },
    });
    const createRes = await handleCreateDispute(createReq, producerClaims, testSql, testAuditSql);
    expect(createRes.status).toBe(201);
    const { id: disputeId } = (await jsonBody(createRes)) as { id: string };

    const resolveReq = makeRequest({
      path: `/disputes/${disputeId}/resolve`,
      method: 'POST',
      body: {},
    });
    const res = await handleResolveDispute(
      disputeId,
      resolveReq,
      financeAdminA,
      testSql,
      testAuditSql,
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — POST /disputes/:id/resolve by Producer returns 403
// ---------------------------------------------------------------------------

describe('POST /disputes/:id/resolve — Producer RBAC (AC#5)', () => {
  test('Producer attempting to resolve returns 403', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementId = await createPlacementWithContributor(testSql, financeAdminA, producerId);
    await createActivePlanForProducer(testSql, financeAdminA, producerId);
    const commissionRecordId = await getCommissionRecordId(testSql, financeAdminA, placementId);

    // Create a dispute
    const createReq = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { commission_record_id: commissionRecordId, description: 'RBAC test dispute.' },
    });
    const createRes = await handleCreateDispute(createReq, producerClaims, testSql, testAuditSql);
    expect(createRes.status).toBe(201);
    const { id: disputeId } = (await jsonBody(createRes)) as { id: string };

    // Producer tries to resolve — should get 403
    const resolveReq = makeRequest({
      path: `/disputes/${disputeId}/resolve`,
      method: 'POST',
      body: { resolution_note: 'Producer trying to resolve.' },
    });
    const resolveRes = await handleResolveDispute(
      disputeId,
      resolveReq,
      producerClaims, // Producer claims
      testSql,
      testAuditSql,
    );
    expect(resolveRes.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Multi-tenant isolation: Org B producer cannot see Org A disputes
// ---------------------------------------------------------------------------

describe('Multi-tenant isolation', () => {
  test('Org B producer cannot see Org A disputes', async () => {
    const producerAId = crypto.randomUUID();
    const claimsOrgA: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerAId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementId = await createPlacementWithContributor(testSql, financeAdminA, producerAId);
    await createActivePlanForProducer(testSql, financeAdminA, producerAId);
    const commissionRecordId = await getCommissionRecordId(testSql, financeAdminA, placementId);

    // Create dispute in Org A
    const createReq = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: { commission_record_id: commissionRecordId, description: 'Org A dispute.' },
    });
    const createRes = await handleCreateDispute(createReq, claimsOrgA, testSql, testAuditSql);
    expect(createRes.status).toBe(201);
    const { id: disputeIdA } = (await jsonBody(createRes)) as { id: string };

    // Org B producer with same user_id
    const claimsOrgB: SessionClaims = {
      org_id: ORG_B_ID,
      user_id: producerAId, // same user_id, different org
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // Org B producer should not see Org A's dispute
    const listReq = makeRequest({ path: '/disputes' });
    const listRes = await handleListDisputes(listReq, claimsOrgB, testSql, testSql);
    expect(listRes.status).toBe(200);
    const listBody = (await jsonBody(listRes)) as { disputes: Array<{ id: string }> };
    const ids = listBody.disputes.map((d) => d.id);
    expect(ids).not.toContain(disputeIdA);
  });
});

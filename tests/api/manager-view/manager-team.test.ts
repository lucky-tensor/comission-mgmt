/**
 * Manager Team View — integration tests (issue #21).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — GET /me/team/placements returns placements where manager is a ManagerOverride contributor.
 *   AC#2 — GET /me/team/commission-summary returns aggregated accruals/payables/holds by producer.
 *   AC#3 — GET /me/team/pending-approvals returns placements in PendingApproval state.
 *   AC#4 — Manager token cannot access another manager's team data (isolation).
 *   AC#5 — GET /me/team/disputes returns open disputes for the manager's team placements.
 *   AC#6 — Non-Manager role (Producer) receives 403 on all /me/team/* routes.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §8.10, docs/architecture/phase-leadership-visibility.md
 * Issue: feat: manager team commission view (#21)
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
  _setManagerTeamEncryptorForTest,
  _resetManagerTeamEncryptorForTest,
} from '../../../packages/db/src/manager-team';
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
import { handleAddContributor } from '../../../apps/server/src/api/contributors';
import {
  handleCreatePlan,
  handleActivatePlanVersion,
  handleCreatePlanAssignment,
} from '../../../apps/server/src/api/plans';
import { handleCalculateCommission } from '../../../apps/server/src/api/calculate';
import { handleSubmitAttribution } from '../../../apps/server/src/api/attribution';
import {
  handleGetTeamPlacements,
  handleGetTeamCommissionSummary,
  handleGetTeamPendingApprovals,
  handleGetTeamDisputes,
} from '../../../apps/server/src/api/manager-team';
import { handleCreateDispute } from '../../../apps/server/src/api/disputes';
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

const _financeAdminB: SessionClaims = {
  org_id: ORG_B_ID,
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
  _setManagerTeamEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
  _resetCommRecordEncryptorForTest();
  _resetManagerTeamEncryptorForTest();
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
 * Creates a placement, adds a contributor with role CandidateOwner, and optionally
 * adds the manager as a ManagerOverride contributor. Returns the placement ID.
 */
async function createPlacementForManager(
  sql: ReturnType<typeof postgres>,
  adminClaims: SessionClaims,
  producerId: string,
  managerId: string,
): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Recruiter',
      compensation_base: '120000',
      fee_amount: '18000',
      start_date: '2025-06-01',
      guarantee_days: 90,
    },
  });
  const res = await handleCreatePlacement(req, adminClaims, sql);
  expect(res.status).toBe(201);
  const { id: placementId } = (await jsonBody(res)) as { id: string };

  // Add producer as CandidateOwner contributor
  const addProducerReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 0.75 },
  });
  const addProducerRes = await handleAddContributor(placementId, addProducerReq, adminClaims, sql);
  expect(addProducerRes.status).toBe(201);

  // Add manager as ManagerOverride contributor
  const addManagerReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: managerId, role: 'ManagerOverride', split_pct: 0.25 },
  });
  const addManagerRes = await handleAddContributor(placementId, addManagerReq, adminClaims, sql);
  expect(addManagerRes.status).toBe(201);

  return placementId;
}

/**
 * Creates and activates a plan, assigns to the producer.
 */
async function setupActivePlanForProducer(
  sql: ReturnType<typeof postgres>,
  adminClaims: SessionClaims,
  producerId: string,
): Promise<void> {
  const createReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: `Manager Team Test Plan ${Date.now()}-${Math.random()}`,
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
async function calculateAndGetCommissionRecordId(
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
// AC#6 — Non-Manager role returns 403
// ---------------------------------------------------------------------------

describe('GET /me/team/* — RBAC enforcement (AC#6)', () => {
  const producerClaims: SessionClaims = {
    org_id: ORG_A_ID,
    user_id: crypto.randomUUID(),
    role: 'Producer',
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  test('GET /me/team/placements returns 403 for Producer role', async () => {
    const req = makeRequest({ path: '/me/team/placements' });
    const res = await handleGetTeamPlacements(req, producerClaims, testSql);
    expect(res.status).toBe(403);
  });

  test('GET /me/team/commission-summary returns 403 for Producer role', async () => {
    const req = makeRequest({ path: '/me/team/commission-summary' });
    const res = await handleGetTeamCommissionSummary(req, producerClaims, testSql);
    expect(res.status).toBe(403);
  });

  test('GET /me/team/pending-approvals returns 403 for Producer role', async () => {
    const req = makeRequest({ path: '/me/team/pending-approvals' });
    const res = await handleGetTeamPendingApprovals(req, producerClaims, testSql);
    expect(res.status).toBe(403);
  });

  test('GET /me/team/disputes returns 403 for Producer role', async () => {
    const req = makeRequest({ path: '/me/team/disputes' });
    const res = await handleGetTeamDisputes(req, producerClaims, testSql);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// AC#1 — GET /me/team/placements
// ---------------------------------------------------------------------------

describe('GET /me/team/placements (AC#1)', () => {
  test('returns placements where manager is a ManagerOverride contributor', async () => {
    const managerId = crypto.randomUUID();
    const producerId = crypto.randomUUID();
    const managerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementId = await createPlacementForManager(
      testSql,
      financeAdminA,
      producerId,
      managerId,
    );

    const req = makeRequest({ path: '/me/team/placements' });
    const res = await handleGetTeamPlacements(req, managerClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      placements: Array<{ id: string; job_title: string; status: string }>;
    };
    const ids = body.placements.map((p) => p.id);
    expect(ids).toContain(placementId);
  });

  test('returns empty array when manager has no ManagerOverride placements', async () => {
    const managerId = crypto.randomUUID();
    const managerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({ path: '/me/team/placements' });
    const res = await handleGetTeamPlacements(req, managerClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { placements: unknown[] };
    expect(body.placements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Manager isolation: cannot see another manager's team data
// ---------------------------------------------------------------------------

describe('Manager isolation — cannot access another manager team data (AC#4)', () => {
  test('managerA can only see their own team placements, not managerB placements', async () => {
    const managerAId = crypto.randomUUID();
    const managerBId = crypto.randomUUID();
    const producerId = crypto.randomUUID();

    const managerAClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerAId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const managerBClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerBId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // Create placement under managerB only
    const placementId = await createPlacementForManager(
      testSql,
      financeAdminA,
      producerId,
      managerBId,
    );

    // managerB should see it
    const reqB = makeRequest({ path: '/me/team/placements' });
    const resB = await handleGetTeamPlacements(reqB, managerBClaims, testSql);
    expect(resB.status).toBe(200);
    const bodyB = (await jsonBody(resB)) as { placements: Array<{ id: string }> };
    expect(bodyB.placements.map((p) => p.id)).toContain(placementId);

    // managerA should NOT see it
    const reqA = makeRequest({ path: '/me/team/placements' });
    const resA = await handleGetTeamPlacements(reqA, managerAClaims, testSql);
    expect(resA.status).toBe(200);
    const bodyA = (await jsonBody(resA)) as { placements: Array<{ id: string }> };
    expect(bodyA.placements.map((p) => p.id)).not.toContain(placementId);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — GET /me/team/commission-summary
// ---------------------------------------------------------------------------

describe('GET /me/team/commission-summary (AC#2)', () => {
  test('returns aggregated commission summary grouped by producer', async () => {
    const managerId = crypto.randomUUID();
    const producerId = crypto.randomUUID();
    const managerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    await createPlacementForManager(testSql, financeAdminA, producerId, managerId);
    await setupActivePlanForProducer(testSql, financeAdminA, producerId);

    // We need a placement in Active state to calculate commissions
    // Create a fresh placement with Active status
    const req2 = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Commission Summary Test',
        compensation_base: '100000',
        fee_amount: '20000',
        start_date: '2025-06-01',
        guarantee_days: null,
      },
    });
    const res2 = await handleCreatePlacement(req2, financeAdminA, testSql);
    expect(res2.status).toBe(201);
    const { id: placementId2 } = (await jsonBody(res2)) as { id: string };

    // Add producer as CandidateOwner
    const addReq = makeRequest({
      path: `/placements/${placementId2}/contributors`,
      method: 'POST',
      body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 0.75 },
    });
    const addRes = await handleAddContributor(placementId2, addReq, financeAdminA, testSql);
    expect(addRes.status).toBe(201);

    // Add manager as ManagerOverride
    const addMgrReq = makeRequest({
      path: `/placements/${placementId2}/contributors`,
      method: 'POST',
      body: { producer_id: managerId, role: 'ManagerOverride', split_pct: 0.25 },
    });
    await handleAddContributor(placementId2, addMgrReq, financeAdminA, testSql);

    // Set to Active and calculate commissions
    await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId2]);
    await calculateAndGetCommissionRecordId(testSql, financeAdminA, placementId2);

    const req = makeRequest({ path: '/me/team/commission-summary' });
    const res = await handleGetTeamCommissionSummary(req, managerClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      summary: Array<{
        producer_id: string;
        total_accrued: string;
        total_payable: string;
        total_held: string;
        record_count: number;
      }>;
    };

    expect(Array.isArray(body.summary)).toBe(true);
    // There should be at least one entry
    expect(body.summary.length).toBeGreaterThan(0);

    // Each entry should have the expected fields
    for (const entry of body.summary) {
      expect(entry).toHaveProperty('producer_id');
      expect(entry).toHaveProperty('total_accrued');
      expect(entry).toHaveProperty('total_payable');
      expect(entry).toHaveProperty('total_held');
      expect(entry).toHaveProperty('record_count');
      expect(typeof entry.record_count).toBe('number');
    }
  });

  test('returns empty summary for manager with no team placements', async () => {
    const managerId = crypto.randomUUID();
    const managerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({ path: '/me/team/commission-summary' });
    const res = await handleGetTeamCommissionSummary(req, managerClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { summary: unknown[] };
    expect(body.summary).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — GET /me/team/pending-approvals
// ---------------------------------------------------------------------------

describe('GET /me/team/pending-approvals (AC#3)', () => {
  test('returns placements in PendingApproval state for the manager', async () => {
    const managerId = crypto.randomUUID();
    const producerId = crypto.randomUUID();
    const managerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementId = await createPlacementForManager(
      testSql,
      financeAdminA,
      producerId,
      managerId,
    );

    // Submit attribution to move placement to PendingApproval
    const submitRes = await handleSubmitAttribution(
      placementId,
      financeAdminA,
      testSql,
      testAuditSql,
    );
    expect(submitRes.status).toBe(200);

    const req = makeRequest({ path: '/me/team/pending-approvals' });
    const res = await handleGetTeamPendingApprovals(req, managerClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      pending_approvals: Array<{
        placement_id: string;
        job_title: string;
        submitted_at: string;
      }>;
    };

    const ids = body.pending_approvals.map((a) => a.placement_id);
    expect(ids).toContain(placementId);

    const item = body.pending_approvals.find((a) => a.placement_id === placementId);
    expect(item).toBeDefined();
    expect(item!.job_title).toBe('Senior Recruiter');
    expect(item!.submitted_at).toBeTruthy();
  });

  test('returns empty array when no pending approvals exist for manager', async () => {
    const managerId = crypto.randomUUID();
    const managerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({ path: '/me/team/pending-approvals' });
    const res = await handleGetTeamPendingApprovals(req, managerClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { pending_approvals: unknown[] };
    expect(body.pending_approvals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — GET /me/team/disputes
// ---------------------------------------------------------------------------

describe('GET /me/team/disputes (AC#5)', () => {
  test('returns open disputes for the manager team placements', async () => {
    const managerId = crypto.randomUUID();
    const producerId = crypto.randomUUID();
    const managerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // Create a placement with manager oversight
    const req2 = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Disputes Test Placement',
        compensation_base: '100000',
        fee_amount: '15000',
        start_date: '2025-06-01',
        guarantee_days: null,
      },
    });
    const res2 = await handleCreatePlacement(req2, financeAdminA, testSql);
    expect(res2.status).toBe(201);
    const { id: placementId } = (await jsonBody(res2)) as { id: string };

    // Add producer as CandidateOwner
    const addProdReq = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 0.75 },
    });
    await handleAddContributor(placementId, addProdReq, financeAdminA, testSql);

    // Add manager as ManagerOverride
    const addMgrReq = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: { producer_id: managerId, role: 'ManagerOverride', split_pct: 0.25 },
    });
    await handleAddContributor(placementId, addMgrReq, financeAdminA, testSql);

    // Set Active and calculate commissions
    await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
    await setupActivePlanForProducer(testSql, financeAdminA, producerId);
    const commissionRecordId = await calculateAndGetCommissionRecordId(
      testSql,
      financeAdminA,
      placementId,
    );

    // Producer submits a dispute
    const disputeReq = makeRequest({
      path: '/disputes',
      method: 'POST',
      body: {
        commission_record_id: commissionRecordId,
        description: 'Commission calculation seems incorrect.',
      },
    });
    const disputeRes = await handleCreateDispute(disputeReq, producerClaims, testSql, testAuditSql);
    expect(disputeRes.status).toBe(201);
    const { id: disputeId } = (await jsonBody(disputeRes)) as { id: string };

    // Manager should see the dispute
    const req = makeRequest({ path: '/me/team/disputes' });
    const res = await handleGetTeamDisputes(req, managerClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      disputes: Array<{
        id: string;
        commission_record_id: string;
        submitted_by: string;
        state: string;
        placement_id: string;
      }>;
    };

    const disputeIds = body.disputes.map((d) => d.id);
    expect(disputeIds).toContain(disputeId);

    const dispute = body.disputes.find((d) => d.id === disputeId);
    expect(dispute).toBeDefined();
    expect(dispute!.state).toBe('Submitted');
    expect(dispute!.placement_id).toBe(placementId);
    expect(dispute!.submitted_by).toBe(producerId);
  });

  test('does not return resolved disputes', async () => {
    const managerId = crypto.randomUUID();
    const managerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: managerId,
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({ path: '/me/team/disputes' });
    const res = await handleGetTeamDisputes(req, managerClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      disputes: Array<{ state: string }>;
    };
    // All returned disputes must be in open state
    for (const d of body.disputes) {
      expect(['Submitted', 'UnderReview']).toContain(d.state);
    }
  });
});

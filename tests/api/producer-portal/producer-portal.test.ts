/**
 * Producer payout statement and deal visibility — integration tests (issue #16).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — GET /me/commission-records returns only CommissionRecords where the
 *            authenticated producer is the contributor (producer isolation test).
 *   AC#2 — GET /me/commission-records includes the explanation field for each record.
 *   AC#3 — GET /me/commission-records?status=Held returns only held records for the producer.
 *   AC#4 — A Producer token accessing /me/commission-records for a different producer's
 *            user_id returns no records (isolation enforced by contributor_id = user_id scope).
 *   AC#5 — GET /me/payouts returns records only from Approved commission runs.
 *
 * Additional:
 *   - Isolation test: create two producers in same tenant, assert each sees only
 *     their own CommissionRecords via /me/commission-records.
 *   - End-to-end: create placement → calculate → GET /me/commission-records →
 *     assert all fields present and explanation is non-empty.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No Vitest mocking helpers are used — real Postgres only (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.8, §7.6
 * Issue: feat: producer payout statement and deal visibility (#16)
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
  handleGetMyCommissionRecords,
  handleGetMyPayouts,
  handleGetMyTierProgress,
} from '../../../apps/server/src/api/me';
import {
  _setTierEncryptorForTest,
  _resetTierEncryptorForTest,
} from '../../../packages/db/src/plans';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const ORG_B_ID = crypto.randomUUID();

// Finance Admin used for setup (creating placements, plans, commission runs)
const financeAdminA: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

// financeAdminB is intentionally not declared here — Org B isolation
// tests use producer claims with org_id=ORG_B_ID directly, scoped to
// the same resource that was created under Org A.

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });

  const adapter = new LocalDevKmsAdapter();
  const enc = new FieldEncryptor(adapter);
  _setEncryptorForTest(enc);
  _setCommRecordEncryptorForTest(enc);
  _setInvoiceEncryptorForTest(enc);
  _setTierEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
  _resetCommRecordEncryptorForTest();
  _resetInvoiceEncryptorForTest();
  _resetTierEncryptorForTest();
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
 * Creates a placement for the given producerId (using their user_id as producer_id),
 * activates it, and adds the producer as a contributor.
 * Returns the placement ID.
 */
async function createPlacementWithContributor(
  sql: ReturnType<typeof postgres>,
  adminClaims: SessionClaims,
  producerId: string,
  splitPct = 1.0,
): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Recruiter',
      compensation_base: '120000',
      fee_amount: '20000',
      start_date: '2025-04-01',
      guarantee_days: null,
    },
  });
  const res = await handleCreatePlacement(req, adminClaims, sql);
  expect(res.status).toBe(201);
  const { id: placementId } = (await jsonBody(res)) as { id: string };

  // Activate the placement
  await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);

  // Add contributor
  const addReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: splitPct },
  });
  const addRes = await handleAddContributor(placementId, addReq, adminClaims, sql);
  expect(addRes.status).toBe(201);

  return placementId;
}

/**
 * Creates and activates a plan, assigns it to the producer.
 * Returns the plan version ID.
 */
async function createActivePlanForProducer(
  sql: ReturnType<typeof postgres>,
  adminClaims: SessionClaims,
  producerId: string,
): Promise<string> {
  const createReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: `Portal Test Plan ${Date.now()}-${Math.random()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.25 },
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

  return version.id;
}

/**
 * Calculates commissions for a placement and returns the created record IDs.
 */
async function calculateFor(
  sql: ReturnType<typeof postgres>,
  adminClaims: SessionClaims,
  placementId: string,
): Promise<string[]> {
  const req = makeRequest({
    path: `/placements/${placementId}/calculate`,
    method: 'POST',
  });
  const res = await handleCalculateCommission(placementId, req, adminClaims, sql);
  expect(res.status).toBe(200);
  const body = (await jsonBody(res)) as { commission_records: Array<{ id: string }> };
  return body.commission_records.map((r) => r.id);
}

/**
 * Builds a fully approved commission run for the given producers.
 * Returns { runId, recordIds }.
 */
async function buildApprovedRun(
  sql: ReturnType<typeof postgres>,
  adminClaims: SessionClaims,
  producerIds: string[],
): Promise<{ runId: string; recordIds: string[] }> {
  const allRecordIds: string[] = [];
  const placementIds: string[] = [];

  for (const producerId of producerIds) {
    const placementId = await createPlacementWithContributor(sql, adminClaims, producerId);
    placementIds.push(placementId);
    await createActivePlanForProducer(sql, adminClaims, producerId);
    const recordIds = await calculateFor(sql, adminClaims, placementId);
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
  const createRunRes = await handleCreateCommissionRun(createRunReq, adminClaims, sql);
  expect(createRunRes.status).toBe(201);
  const { id: runId } = (await jsonBody(createRunRes)) as { id: string };

  // Individually approve each record
  for (const recordId of allRecordIds) {
    const approveRes = await handleApproveRunRecord(runId, recordId, adminClaims, sql);
    expect(approveRes.status).toBe(200);
  }

  // Approve the run
  const approveRunRes = await handleApproveCommissionRun(runId, adminClaims, sql);
  expect(approveRunRes.status).toBe(200);

  return { runId, recordIds: allRecordIds };
}

// ---------------------------------------------------------------------------
// AC#1 — GET /me/commission-records returns only the producer's own records
// ---------------------------------------------------------------------------

describe('GET /me/commission-records — own records only (AC#1)', () => {
  test('returns only commission records for the authenticated producer', async () => {
    const producerId = crypto.randomUUID();

    // Producer token: user_id = producerId
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const placementId = await createPlacementWithContributor(testSql, financeAdminA, producerId);
    await createActivePlanForProducer(testSql, financeAdminA, producerId);
    const recordIds = await calculateFor(testSql, financeAdminA, placementId);
    expect(recordIds.length).toBeGreaterThan(0);

    const req = makeRequest({ path: '/me/commission-records' });
    const res = await handleGetMyCommissionRecords(req, producerClaims, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      commission_records: Array<{ id: string }>;
    };
    expect(body.commission_records.length).toBeGreaterThan(0);

    // The known record IDs should all appear
    for (const id of recordIds) {
      expect(body.commission_records.some((r) => r.id === id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC#2 — explanation field present in every record
// ---------------------------------------------------------------------------

describe('GET /me/commission-records — explanation presence (AC#2)', () => {
  test('every returned commission record includes a non-empty explanation field', async () => {
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
    await calculateFor(testSql, financeAdminA, placementId);

    const req = makeRequest({ path: '/me/commission-records' });
    const res = await handleGetMyCommissionRecords(req, producerClaims, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      commission_records: Array<{ explanation: string | null }>;
    };
    expect(body.commission_records.length).toBeGreaterThan(0);

    for (const record of body.commission_records) {
      expect(typeof record.explanation).toBe('string');
      expect((record.explanation as string).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// AC#3 — GET /me/commission-records?status=Held returns only held records
// ---------------------------------------------------------------------------

describe('GET /me/commission-records?status=Held — held filter (AC#3)', () => {
  test('returns only Held records when status=Held filter is applied', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // Create a placement and calculate — this will produce an Accrued record
    const placementId = await createPlacementWithContributor(testSql, financeAdminA, producerId);
    await createActivePlanForProducer(testSql, financeAdminA, producerId);
    const recordIds = await calculateFor(testSql, financeAdminA, placementId);
    expect(recordIds.length).toBeGreaterThan(0);

    // Manually flip one record to Held so we can test the filter
    await testSql.unsafe(`UPDATE commission_records SET status = 'Held' WHERE id = $1`, [
      recordIds[0],
    ]);

    // GET /me/commission-records?status=Held
    const req = makeRequest({ path: '/me/commission-records?status=Held' });
    const res = await handleGetMyCommissionRecords(req, producerClaims, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      commission_records: Array<{ id: string; status: string }>;
    };
    expect(body.commission_records.length).toBeGreaterThan(0);

    // All returned records must have status=Held
    for (const record of body.commission_records) {
      expect(record.status).toBe('Held');
    }

    // The explicitly held record must appear
    expect(body.commission_records.some((r) => r.id === recordIds[0])).toBe(true);
  });

  test('returns empty array when no held records exist for producer', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // No placements or commission records created — producer has no records at all
    const req = makeRequest({ path: '/me/commission-records?status=Held' });
    const res = await handleGetMyCommissionRecords(req, producerClaims, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { commission_records: unknown[] };
    expect(body.commission_records).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Producer isolation: each producer sees only their own records
// ---------------------------------------------------------------------------

describe('GET /me/commission-records — producer isolation (AC#4)', () => {
  test('two producers in same tenant each see only their own records', async () => {
    const producerAId = crypto.randomUUID();
    const producerBId = crypto.randomUUID();

    const claimsProducerA: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerAId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const claimsProducerB: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerBId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // Create placements and calculate for both producers
    const placementA = await createPlacementWithContributor(testSql, financeAdminA, producerAId);
    await createActivePlanForProducer(testSql, financeAdminA, producerAId);
    const recordIdsA = await calculateFor(testSql, financeAdminA, placementA);

    const placementB = await createPlacementWithContributor(testSql, financeAdminA, producerBId);
    await createActivePlanForProducer(testSql, financeAdminA, producerBId);
    const recordIdsB = await calculateFor(testSql, financeAdminA, placementB);

    // Producer A sees only their records
    const reqA = makeRequest({ path: '/me/commission-records' });
    const resA = await handleGetMyCommissionRecords(reqA, claimsProducerA, testSql, testSql);
    expect(resA.status).toBe(200);
    const bodyA = (await jsonBody(resA)) as {
      commission_records: Array<{ id: string; contributor_id: string }>;
    };
    const idsA = bodyA.commission_records.map((r) => r.id);
    for (const id of recordIdsA) {
      expect(idsA).toContain(id);
    }
    // Producer A should NOT see producer B's records
    for (const id of recordIdsB) {
      expect(idsA).not.toContain(id);
    }

    // Producer B sees only their records
    const reqB = makeRequest({ path: '/me/commission-records' });
    const resB = await handleGetMyCommissionRecords(reqB, claimsProducerB, testSql, testSql);
    expect(resB.status).toBe(200);
    const bodyB = (await jsonBody(resB)) as {
      commission_records: Array<{ id: string; contributor_id: string }>;
    };
    const idsB = bodyB.commission_records.map((r) => r.id);
    for (const id of recordIdsB) {
      expect(idsB).toContain(id);
    }
    // Producer B should NOT see producer A's records
    for (const id of recordIdsA) {
      expect(idsB).not.toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// AC#5 — GET /me/payouts returns only records from Approved runs
// ---------------------------------------------------------------------------

describe('GET /me/payouts — approved payouts only (AC#5)', () => {
  test('returns records only from Approved commission runs, not Open/Accrued', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // Create a second placement that will stay in an Open (non-approved) run
    const placementIdOpen = await createPlacementWithContributor(
      testSql,
      financeAdminA,
      producerId,
    );
    await createActivePlanForProducer(testSql, financeAdminA, producerId);
    const openRecordIds = await calculateFor(testSql, financeAdminA, placementIdOpen);

    // Create an approved run with a different placement for this same producer
    const { recordIds: approvedRecordIds } = await buildApprovedRun(testSql, financeAdminA, [
      producerId,
    ]);

    const req = makeRequest({ path: '/me/payouts' });
    const res = await handleGetMyPayouts(req, producerClaims, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      payouts: Array<{ id: string; status: string }>;
    };

    const payoutIds = body.payouts.map((p) => p.id);

    // The approved run's records should appear in payouts
    for (const id of approvedRecordIds) {
      expect(payoutIds).toContain(id);
    }

    // The open (non-approved) run records should NOT appear
    for (const id of openRecordIds) {
      expect(payoutIds).not.toContain(id);
    }
  });

  test('returns empty array when producer has no approved payouts', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({ path: '/me/payouts' });
    const res = await handleGetMyPayouts(req, producerClaims, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { payouts: unknown[] };
    expect(body.payouts).toHaveLength(0);
  });

  test('multi-tenant isolation: Org B producer cannot see Org A payouts', async () => {
    const producerAId = crypto.randomUUID();
    // Build approved run in Org A
    await buildApprovedRun(testSql, financeAdminA, [producerAId]);

    // A producer in Org B with the SAME user_id (edge case — different org scope)
    const producerBWithSameId: SessionClaims = {
      org_id: ORG_B_ID,
      user_id: producerAId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({ path: '/me/payouts' });
    const res = await handleGetMyPayouts(req, producerBWithSameId, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { payouts: unknown[] };
    // Org B should see no payouts (org_id isolation)
    expect(body.payouts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /me/tier-progress — integration tests (issue #17)
// ---------------------------------------------------------------------------

describe('GET /me/tier-progress — returns production total and tier (issue #17)', () => {
  test('returns correct current_period_production and current_tier_rate after calculation', async () => {
    const producerId = crypto.randomUUID();
    const producerClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // Create a plan with tiers so we can validate tier lookup
    const createReq = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: `Tier Progress Plan ${Date.now()}-${Math.random()}`,
        effective_from: '2025-01-01',
        rules: {
          rate_type: 'gross_fee',
          base_rate: 0.1,
          tiers: [
            { threshold: 10000, rate: 0.2 },
            { threshold: 50000, rate: 0.3 },
          ],
        },
      },
    });
    const createRes = await handleCreatePlan(createReq, financeAdminA, testSql);
    expect(createRes.status).toBe(201);
    const { plan, version } = (await jsonBody(createRes)) as {
      plan: { id: string };
      version: { id: string };
    };

    const activateRes = await handleActivatePlanVersion(
      plan.id,
      version.id,
      financeAdminA,
      testSql,
    );
    expect(activateRes.status).toBe(200);

    const assignReq = makeRequest({
      path: `/plans/${plan.id}/assignments`,
      method: 'POST',
      body: { producer_id: producerId, plan_version_id: version.id },
    });
    const assignRes = await handleCreatePlanAssignment(plan.id, assignReq, financeAdminA, testSql);
    expect(assignRes.status).toBe(201);

    // Create a placement and calculate commissions
    const placementId = await createPlacementWithContributor(testSql, financeAdminA, producerId);
    await calculateFor(testSql, financeAdminA, placementId);

    const req = makeRequest({ path: '/me/tier-progress' });
    const res = await handleGetMyTierProgress(req, producerClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      plan_version_id: string;
      period_start: string;
      period_end: string | null;
      current_period_production: number;
      current_tier_rate: number;
      next_tier_threshold: number | null;
      remaining_to_next_tier: number | null;
    };

    // All fields must be present
    expect(body.plan_version_id).toBe(version.id);
    expect(body.period_start).toBe('2025-01-01');
    expect(typeof body.current_period_production).toBe('number');
    expect(body.current_period_production).toBeGreaterThan(0);
    expect(typeof body.current_tier_rate).toBe('number');
    // tier rate must be one of the valid rates or base rate
    expect([0.1, 0.2, 0.3]).toContain(body.current_tier_rate);
  });

  test('returns 404 when producer has no active plan assignment', async () => {
    const noPlanProducerId = crypto.randomUUID();
    const noPlanClaims: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: noPlanProducerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({ path: '/me/tier-progress' });
    const res = await handleGetMyTierProgress(req, noPlanClaims, testSql);
    expect(res.status).toBe(404);
  });
});

describe('GET /me/tier-progress — producer isolation', () => {
  test('a producer token cannot retrieve tier progress for a different producer', async () => {
    // Create two separate producers
    const producerAId = crypto.randomUUID();
    const producerBId = crypto.randomUUID();

    // Set up plan for Producer A only
    const createReq = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: `Isolation Plan ${Date.now()}-${Math.random()}`,
        effective_from: '2025-01-01',
        rules: { rate_type: 'gross_fee', base_rate: 0.2 },
      },
    });
    const createRes = await handleCreatePlan(createReq, financeAdminA, testSql);
    expect(createRes.status).toBe(201);
    const { plan, version } = (await jsonBody(createRes)) as {
      plan: { id: string };
      version: { id: string };
    };
    await handleActivatePlanVersion(plan.id, version.id, financeAdminA, testSql);
    const assignReq = makeRequest({
      path: `/plans/${plan.id}/assignments`,
      method: 'POST',
      body: { producer_id: producerAId, plan_version_id: version.id },
    });
    await handleCreatePlanAssignment(plan.id, assignReq, financeAdminA, testSql);

    // Producer A gets tier progress (has a plan)
    const claimsA: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerAId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const reqA = makeRequest({ path: '/me/tier-progress' });
    const resA = await handleGetMyTierProgress(reqA, claimsA, testSql);
    expect(resA.status).toBe(200);
    const bodyA = (await jsonBody(resA)) as { plan_version_id: string };
    expect(bodyA.plan_version_id).toBe(version.id);

    // Producer B does NOT have a plan — should get 404, not Producer A's data
    const claimsB: SessionClaims = {
      org_id: ORG_A_ID,
      user_id: producerBId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const reqB = makeRequest({ path: '/me/tier-progress' });
    const resB = await handleGetMyTierProgress(reqB, claimsB, testSql);
    // Producer B has no plan — 404 rather than accidentally returning A's data
    expect(resB.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: placement → calculate → GET /me/commission-records
// ---------------------------------------------------------------------------

describe('End-to-end: placement → calculate → /me/commission-records', () => {
  test('full pipeline: all fields present and explanation is non-empty', async () => {
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
    const recordIds = await calculateFor(testSql, financeAdminA, placementId);
    expect(recordIds.length).toBeGreaterThan(0);

    const req = makeRequest({ path: '/me/commission-records' });
    const res = await handleGetMyCommissionRecords(req, producerClaims, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      commission_records: Array<{
        id: string;
        org_id: string;
        placement_id: string;
        contributor_id: string;
        plan_version_id: string;
        gross_commission: string;
        net_payable: string;
        tier_rate: number | null;
        status: string;
        hold_reason: string | null;
        explanation: string | null;
        approval_actor: string | null;
        approval_at: string | null;
        created_at: string;
      }>;
    };

    expect(body.commission_records.length).toBeGreaterThan(0);

    const record = body.commission_records[0];

    // All required fields present
    expect(record.id).toBeTruthy();
    expect(record.org_id).toBe(ORG_A_ID);
    expect(record.placement_id).toBe(placementId);
    // contributor_id is contributors.id (row UUID), not producer's user_id
    expect(record.contributor_id).toBeTruthy();
    expect(record.plan_version_id).toBeTruthy();
    expect(record.gross_commission).toBeTruthy();
    expect(record.net_payable).toBeTruthy();
    expect(record.status).toBeTruthy();
    expect(record.created_at).toBeTruthy();

    // Explanation is present and non-empty (AC#2 / PRD §9)
    expect(typeof record.explanation).toBe('string');
    expect((record.explanation as string).length).toBeGreaterThan(0);
  });
});

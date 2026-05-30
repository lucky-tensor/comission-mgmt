/**
 * Commission Plan API integration tests — issue #9 acceptance criteria.
 *
 * Tests (Acceptance criteria):
 *   AC#1 — POST /plans with valid rule config returns 201 with a plan JSON in Draft state
 *   AC#2 — POST /plans/:id/versions/:vid/activate transitions version to Active and
 *            prior active version to Superseded
 *   AC#3 — GET /plans/:id/versions returns all versions with their states in
 *            descending activation order
 *   AC#4 — A plan with overlapping tier thresholds returns 422
 *   AC#5 — Plan assignment to a producer is recorded and retrievable via
 *            GET /plans/:id/assignments
 *
 * Additional tests (Test plan):
 *   - Tier validation test: POST plan with overlapping tiers returns 422
 *   - Versioning test: activate v2, assert v1 is Superseded,
 *                      GET /plans/:id/active returns v2
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.3, §8.3
 * Issue: feat: commission plan configuration and versioning (#9)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import {
  handleCreatePlan,
  handleListPlans,
  handleCreatePlanVersion,
  handleListPlanVersions,
  handleGetActivePlanVersion,
  handleActivatePlanVersion,
  handleCreatePlanAssignment,
  handleListPlanAssignments,
} from '../../../apps/server/src/api/plans';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres
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
}, 120_000);

afterAll(async () => {
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

const BASIC_RULES = {
  rate_type: 'gross_fee' as const,
  base_rate: 0.1,
};

const TIERED_RULES = {
  rate_type: 'gross_fee' as const,
  base_rate: 0.1,
  tiers: [
    { threshold: 0, rate: 0.1 },
    { threshold: 50000, rate: 0.15 },
    { threshold: 100000, rate: 0.2 },
  ],
};

const OVERLAPPING_TIER_RULES = {
  rate_type: 'gross_fee' as const,
  base_rate: 0.1,
  tiers: [
    { threshold: 0, rate: 0.1 },
    { threshold: 50000, rate: 0.15 },
    { threshold: 20000, rate: 0.2 }, // overlapping — not ascending
  ],
};

// ---------------------------------------------------------------------------
// AC#1 — POST /plans with valid rule config returns 201 with a plan in Draft state
// ---------------------------------------------------------------------------

describe('POST /plans — plan creation', () => {
  test('AC#1: returns 201 with plan and initial Draft version', async () => {
    const req = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Standard Plan 2024',
        effective_from: '2024-01-01',
        rules: BASIC_RULES,
      },
    });

    const res = await handleCreatePlan(req, claimsA, testSql);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.plan).toBeDefined();
    expect(body.version).toBeDefined();

    expect(body.plan.name).toBe('Standard Plan 2024');
    expect(body.plan.org_id).toBe(ORG_A_ID);
    expect(body.plan.effective_from).toBe('2024-01-01');
    expect(body.plan.id).toBeDefined();

    expect(body.version.status).toBe('Draft');
    expect(body.version.version_num).toBe(1);
    expect(body.version.rules.rate_type).toBe('gross_fee');
    expect(body.version.rules.base_rate).toBe(0.1);
  });

  test('returns 422 when required fields are missing', async () => {
    const req = makeRequest({
      path: '/plans',
      method: 'POST',
      body: { name: 'Missing rules' },
    });

    const res = await handleCreatePlan(req, claimsA, testSql);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  test('returns 422 when rate_type is invalid', async () => {
    const req = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Bad Plan',
        effective_from: '2024-01-01',
        rules: { rate_type: 'invalid_type', base_rate: 0.1 },
      },
    });

    const res = await handleCreatePlan(req, claimsA, testSql);
    expect(res.status).toBe(422);
  });

  test('returns 422 when base_rate is out of range', async () => {
    const req = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Bad Rate',
        effective_from: '2024-01-01',
        rules: { rate_type: 'gross_fee', base_rate: 1.5 },
      },
    });

    const res = await handleCreatePlan(req, claimsA, testSql);
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — A plan with overlapping tier thresholds returns 422
// ---------------------------------------------------------------------------

describe('Tier validation', () => {
  test('AC#4 (tier validation): POST plan with overlapping tiers returns 422', async () => {
    const req = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Bad Tiers Plan',
        effective_from: '2024-01-01',
        rules: OVERLAPPING_TIER_RULES,
      },
    });

    const res = await handleCreatePlan(req, claimsA, testSql);
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.fields?.tiers).toContain('strictly ascending');
  });

  test('POST /plans/:id/versions also returns 422 for overlapping tiers', async () => {
    // First create a valid plan
    const createReq = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Version Tier Test Plan',
        effective_from: '2024-01-01',
        rules: BASIC_RULES,
      },
    });
    const createRes = await handleCreatePlan(createReq, claimsA, testSql);
    const { plan } = await createRes.json();

    // Now try to add a version with overlapping tiers
    const versionReq = makeRequest({
      path: `/plans/${plan.id}/versions`,
      method: 'POST',
      body: { rules: OVERLAPPING_TIER_RULES },
    });

    const versionRes = await handleCreatePlanVersion(plan.id, versionReq, claimsA, testSql);
    expect(versionRes.status).toBe(422);
    const body = await versionRes.json();
    expect(body.fields?.tiers).toContain('strictly ascending');
  });

  test('POST /plans with valid ascending tiers succeeds', async () => {
    const req = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Valid Tiers Plan',
        effective_from: '2024-01-01',
        rules: TIERED_RULES,
      },
    });

    const res = await handleCreatePlan(req, claimsA, testSql);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.version.rules.tiers).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — activate transitions version to Active, prior active to Superseded
// AC#3 — GET /plans/:id/versions returns all versions descending
// ---------------------------------------------------------------------------

describe('Version lifecycle — activate and supersede', () => {
  let planId: string;
  let v1Id: string;
  let v2Id: string;

  beforeAll(async () => {
    // Create a plan (creates v1 in Draft)
    const createReq = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Versioned Plan',
        effective_from: '2024-01-01',
        rules: BASIC_RULES,
      },
    });
    const createRes = await handleCreatePlan(createReq, claimsA, testSql);
    const { plan, version } = await createRes.json();
    planId = plan.id;
    v1Id = version.id;

    // Create v2 (also Draft)
    const v2Req = makeRequest({
      path: `/plans/${planId}/versions`,
      method: 'POST',
      body: { rules: { ...BASIC_RULES, base_rate: 0.12 } },
    });
    const v2Res = await handleCreatePlanVersion(planId, v2Req, claimsA, testSql);
    const v2Body = await v2Res.json();
    v2Id = v2Body.id;
  });

  test('AC#2a: activate v1 transitions it to Active', async () => {
    const res = await handleActivatePlanVersion(planId, v1Id, claimsA, testSql);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('Active');
    expect(body.version_num).toBe(1);
  });

  test('AC#2b: activate v2 transitions it to Active and v1 to Superseded', async () => {
    const res = await handleActivatePlanVersion(planId, v2Id, claimsA, testSql);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('Active');
    expect(body.version_num).toBe(2);

    // Verify v1 is now Superseded by listing versions
    const listRes = await handleListPlanVersions(planId, claimsA, testSql);
    const versions = await listRes.json();

    const v1 = versions.find((v: { id: string }) => v.id === v1Id);
    expect(v1?.status).toBe('Superseded');

    const v2 = versions.find((v: { id: string }) => v.id === v2Id);
    expect(v2?.status).toBe('Active');
  });

  test('AC#3: GET /plans/:id/versions returns versions in descending order', async () => {
    const listRes = await handleListPlanVersions(planId, claimsA, testSql);
    const versions = await listRes.json();

    expect(versions).toHaveLength(2);
    // Descending by version_num
    expect(versions[0].version_num).toBe(2);
    expect(versions[1].version_num).toBe(1);

    // States
    expect(versions[0].status).toBe('Active');
    expect(versions[1].status).toBe('Superseded');
  });

  test('GET /plans/:id/active returns v2 after activation', async () => {
    const res = await handleGetActivePlanVersion(planId, claimsA, testSql);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(v2Id);
    expect(body.status).toBe('Active');
    expect(body.version_num).toBe(2);
  });

  test('activate a Draft-only plan — GET /plans/:id/active returns 404 before any activation', async () => {
    // Create fresh plan
    const createReq = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'No Active Plan',
        effective_from: '2024-06-01',
        rules: BASIC_RULES,
      },
    });
    const createRes = await handleCreatePlan(createReq, claimsA, testSql);
    const { plan } = await createRes.json();

    const res = await handleGetActivePlanVersion(plan.id, claimsA, testSql);
    expect(res.status).toBe(404);
  });

  test('activating an already-Active version returns 404 (not in Draft)', async () => {
    // v2 is Active, try to activate it again
    const res = await handleActivatePlanVersion(planId, v2Id, claimsA, testSql);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Plan assignment to a producer is recorded and retrievable
// ---------------------------------------------------------------------------

describe('Plan assignments', () => {
  let planId: string;
  let versionId: string;

  beforeAll(async () => {
    const createReq = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Assignment Test Plan',
        effective_from: '2024-01-01',
        rules: BASIC_RULES,
      },
    });
    const createRes = await handleCreatePlan(createReq, claimsA, testSql);
    const { plan, version } = await createRes.json();
    planId = plan.id;
    versionId = version.id;
  });

  test('AC#5: POST /plans/:id/assignments returns 201 with assignment', async () => {
    const producerId = crypto.randomUUID();

    const req = makeRequest({
      path: `/plans/${planId}/assignments`,
      method: 'POST',
      body: {
        producer_id: producerId,
        plan_version_id: versionId,
      },
    });

    const res = await handleCreatePlanAssignment(planId, req, claimsA, testSql);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.producer_id).toBe(producerId);
    expect(body.plan_version_id).toBe(versionId);
    expect(body.org_id).toBe(ORG_A_ID);
    expect(body.id).toBeDefined();
  });

  test('AC#5: GET /plans/:id/assignments returns assigned producers', async () => {
    const producerId = crypto.randomUUID();

    // Assign the producer
    const assignReq = makeRequest({
      path: `/plans/${planId}/assignments`,
      method: 'POST',
      body: {
        producer_id: producerId,
        plan_version_id: versionId,
      },
    });
    await handleCreatePlanAssignment(planId, assignReq, claimsA, testSql);

    // List assignments
    const res = await handleListPlanAssignments(planId, claimsA, testSql);
    expect(res.status).toBe(200);

    const assignments = await res.json();
    expect(Array.isArray(assignments)).toBe(true);
    const found = assignments.find((a: { producer_id: string }) => a.producer_id === producerId);
    expect(found).toBeDefined();
    expect(found.plan_version_id).toBe(versionId);
  });

  test('duplicate assignment is idempotent (upsert)', async () => {
    const producerId = crypto.randomUUID();

    const req1 = makeRequest({
      path: `/plans/${planId}/assignments`,
      method: 'POST',
      body: { producer_id: producerId, plan_version_id: versionId },
    });
    const req2 = makeRequest({
      path: `/plans/${planId}/assignments`,
      method: 'POST',
      body: { producer_id: producerId, plan_version_id: versionId },
    });

    const res1 = await handleCreatePlanAssignment(planId, req1, claimsA, testSql);
    const res2 = await handleCreatePlanAssignment(planId, req2, claimsA, testSql);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    // Both should return the same assignment ID
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.id).toBe(body2.id);
  });

  test('assignment with missing producer_id returns 422', async () => {
    const req = makeRequest({
      path: `/plans/${planId}/assignments`,
      method: 'POST',
      body: { plan_version_id: versionId },
    });

    const res = await handleCreatePlanAssignment(planId, req, claimsA, testSql);
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// GET /plans — list plans
// ---------------------------------------------------------------------------

describe('GET /plans', () => {
  test('returns plans scoped to tenant', async () => {
    // Create a plan for org A
    const req = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Org A Plan',
        effective_from: '2024-01-01',
        rules: BASIC_RULES,
      },
    });
    await handleCreatePlan(req, claimsA, testSql);

    // Create a plan for org B
    const reqB = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Org B Plan',
        effective_from: '2024-01-01',
        rules: BASIC_RULES,
      },
    });
    await handleCreatePlan(reqB, claimsB, testSql);

    // List org A plans — should not include org B
    const listReq = makeRequest({ path: '/plans', method: 'GET' });
    const res = await handleListPlans(listReq, claimsA, testSql);
    expect(res.status).toBe(200);
    const plans = await res.json();
    for (const p of plans) {
      expect(p.org_id).toBe(ORG_A_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// Plan not found — 404 isolation checks
// ---------------------------------------------------------------------------

describe('Plan isolation', () => {
  test('GET /plans/:id/versions returns 404 for plan from different org', async () => {
    // Create a plan under org A
    const createReq = makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Isolation Test Plan',
        effective_from: '2024-01-01',
        rules: BASIC_RULES,
      },
    });
    const createRes = await handleCreatePlan(createReq, claimsA, testSql);
    const { plan } = await createRes.json();

    // Try to list versions from org B — should get 404
    const res = await handleListPlanVersions(plan.id, claimsB, testSql);
    expect(res.status).toBe(404);
  });
});

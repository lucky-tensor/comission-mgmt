/**
 * Commission plan acknowledgment — integration tests (issue #123).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — A producer acknowledging their active assigned plan version creates an
 *            acceptance record with actor + version + timestamp.
 *   AC#2 — Re-acknowledging is idempotent: no duplicate record; timestamp stable.
 *   AC#3 — GET /plans/:id/assignments returns acknowledgedAt/acknowledgedBy reflecting
 *            acknowledged vs not-yet-acknowledged producers.
 *   AC#4 — A producer cannot acknowledge a plan not assigned to them (403).
 *           A non-HR/non-owner cannot read another producer's status (Producer role
 *           only sees their own row in GET /plans/:id/assignments).
 *
 * Tests (Test plan):
 *   - acknowledge.test.ts: acknowledge, idempotency, status read, cross-producer 403, role gating.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No Vitest mocking helpers are used (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §4 (HR / People Ops)
 * Issue: feat: commission plan acknowledgment — producer acceptance record and status read (#123)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import {
  handleCreatePlan,
  handleActivatePlanVersion,
  handleCreatePlanAssignment,
  handleListPlanAssignments,
  handleAcknowledgePlanVersion,
} from '../../../apps/server/src/api/plans';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let auditSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const HR_USER_ID = crypto.randomUUID();
const PRODUCER_A_ID = crypto.randomUUID();
const PRODUCER_B_ID = crypto.randomUUID();

const hrClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: HR_USER_ID,
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producerAClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: PRODUCER_A_ID,
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producerBClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: PRODUCER_B_ID,
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  auditSql = postgres(pg.url, { max: 2 });

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });
}, 120_000);

afterAll(async () => {
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
 * Creates a plan with one Draft version, activates it, and returns
 * { planId, versionId }.
 */
async function createActivePlan(
  claims: SessionClaims,
): Promise<{ planId: string; versionId: string }> {
  const createRes = await handleCreatePlan(
    makeRequest({
      path: '/plans',
      method: 'POST',
      body: {
        name: 'Ack Test Plan ' + crypto.randomUUID(),
        effective_from: '2025-01-01',
        rules: { rate_type: 'gross_fee', base_rate: 0.1 },
      },
    }),
    claims,
    testSql,
  );
  expect(createRes.status).toBe(201);
  const createData = (await jsonBody(createRes)) as {
    plan: { id: string };
    version: { id: string };
  };
  const planId = createData.plan.id;
  const versionId = createData.version.id;

  const activateRes = await handleActivatePlanVersion(planId, versionId, claims, testSql);
  expect(activateRes.status).toBe(200);

  return { planId, versionId };
}

/**
 * Assigns a producer to a plan version via POST /plans/:id/assignments.
 */
async function assignProducer(
  planId: string,
  planVersionId: string,
  producerId: string,
  claims: SessionClaims,
): Promise<void> {
  const res = await handleCreatePlanAssignment(
    planId,
    makeRequest({
      path: `/plans/${planId}/assignments`,
      method: 'POST',
      body: { producer_id: producerId, plan_version_id: planVersionId },
    }),
    claims,
    testSql,
  );
  expect(res.status).toBe(201);
}

// ---------------------------------------------------------------------------
// AC#1 — Acknowledge creates durable acceptance record
// ---------------------------------------------------------------------------

describe('POST /plans/:id/versions/:vid/acknowledge', () => {
  test('AC#1: producer acknowledging assigned plan version creates acceptance record with actor + version + timestamp', async () => {
    const { planId, versionId } = await createActivePlan(hrClaims);
    await assignProducer(planId, versionId, PRODUCER_A_ID, hrClaims);

    const res = await handleAcknowledgePlanVersion(
      planId,
      versionId,
      producerAClaims,
      testSql,
      auditSql,
    );

    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as {
      id: string;
      org_id: string;
      plan_version_id: string;
      producer_id: string;
      acknowledged_by: string;
      acknowledged_at: string;
    };

    expect(body.plan_version_id).toBe(versionId);
    expect(body.producer_id).toBe(PRODUCER_A_ID);
    expect(body.acknowledged_by).toBe(PRODUCER_A_ID);
    expect(body.acknowledged_at).toBeTruthy();
    expect(body.org_id).toBe(ORG_A_ID);

    // Verify the record persists in the DB
    const dbRows = await testSql.unsafe(
      'SELECT * FROM plan_acknowledgments WHERE plan_version_id = $1 AND producer_id = $2',
      [versionId, PRODUCER_A_ID],
    );
    expect(dbRows.length).toBe(1);
    expect(dbRows[0].acknowledged_by).toBe(PRODUCER_A_ID);
  });

  // -------------------------------------------------------------------------
  // AC#2 — Idempotency
  // -------------------------------------------------------------------------

  test('AC#2: re-acknowledging is idempotent — no duplicate record, timestamp stable', async () => {
    const { planId, versionId } = await createActivePlan(hrClaims);
    await assignProducer(planId, versionId, PRODUCER_A_ID, hrClaims);

    const res1 = await handleAcknowledgePlanVersion(
      planId,
      versionId,
      producerAClaims,
      testSql,
      auditSql,
    );
    expect(res1.status).toBe(200);
    const body1 = (await jsonBody(res1)) as { acknowledged_at: string; id: string };

    const res2 = await handleAcknowledgePlanVersion(
      planId,
      versionId,
      producerAClaims,
      testSql,
      auditSql,
    );
    expect(res2.status).toBe(200);
    const body2 = (await jsonBody(res2)) as { acknowledged_at: string; id: string };

    // Same record — same id and timestamp
    expect(body2.id).toBe(body1.id);
    expect(body2.acknowledged_at).toBe(body1.acknowledged_at);

    // Only one row in DB
    const dbRows = await testSql.unsafe(
      'SELECT * FROM plan_acknowledgments WHERE plan_version_id = $1 AND producer_id = $2',
      [versionId, PRODUCER_A_ID],
    );
    expect(dbRows.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // AC#4 — Cross-producer isolation: producer cannot acknowledge unassigned plan
  // -------------------------------------------------------------------------

  test('AC#4: producer cannot acknowledge a plan version they are not assigned to — returns 403', async () => {
    const { planId, versionId } = await createActivePlan(hrClaims);
    // Only assign producer A, not producer B
    await assignProducer(planId, versionId, PRODUCER_A_ID, hrClaims);

    const res = await handleAcknowledgePlanVersion(
      planId,
      versionId,
      producerBClaims, // not assigned
      testSql,
      auditSql,
    );

    expect(res.status).toBe(403);
  });

  test('role gating: non-Producer (HR) cannot acknowledge on behalf of a producer — returns 403', async () => {
    const { planId, versionId } = await createActivePlan(hrClaims);

    const res = await handleAcknowledgePlanVersion(planId, versionId, hrClaims, testSql, auditSql);

    expect(res.status).toBe(403);
  });

  test('returns 404 when plan does not exist in tenant', async () => {
    const res = await handleAcknowledgePlanVersion(
      crypto.randomUUID(),
      crypto.randomUUID(),
      producerAClaims,
      testSql,
      auditSql,
    );

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — GET /plans/:id/assignments returns acknowledgedAt/acknowledgedBy
// ---------------------------------------------------------------------------

describe('GET /plans/:id/assignments — acknowledgment status', () => {
  test('AC#3: returns acknowledgedAt/acknowledgedBy for acknowledged producers, null for unacknowledged', async () => {
    const { planId, versionId } = await createActivePlan(hrClaims);

    // Assign both producers
    await assignProducer(planId, versionId, PRODUCER_A_ID, hrClaims);
    await assignProducer(planId, versionId, PRODUCER_B_ID, hrClaims);

    // Only producer A acknowledges
    const ackRes = await handleAcknowledgePlanVersion(
      planId,
      versionId,
      producerAClaims,
      testSql,
      auditSql,
    );
    expect(ackRes.status).toBe(200);

    // HR reads assignments
    const listRes = await handleListPlanAssignments(planId, hrClaims, testSql);
    expect(listRes.status).toBe(200);
    const assignments = (await jsonBody(listRes)) as Array<{
      producer_id: string;
      acknowledged_at: string | null;
      acknowledged_by: string | null;
    }>;

    const aEntry = assignments.find((a) => a.producer_id === PRODUCER_A_ID);
    const bEntry = assignments.find((a) => a.producer_id === PRODUCER_B_ID);

    expect(aEntry).toBeTruthy();
    expect(aEntry!.acknowledged_at).toBeTruthy();
    expect(aEntry!.acknowledged_by).toBe(PRODUCER_A_ID);

    expect(bEntry).toBeTruthy();
    expect(bEntry!.acknowledged_at).toBeNull();
    expect(bEntry!.acknowledged_by).toBeNull();
  });

  test('AC#4: a Producer role can only see their own assignment row in GET /plans/:id/assignments', async () => {
    const { planId, versionId } = await createActivePlan(hrClaims);

    await assignProducer(planId, versionId, PRODUCER_A_ID, hrClaims);
    await assignProducer(planId, versionId, PRODUCER_B_ID, hrClaims);

    // Producer A reads assignments — should only see their own row
    const res = await handleListPlanAssignments(planId, producerAClaims, testSql);
    expect(res.status).toBe(200);
    const assignments = (await jsonBody(res)) as Array<{ producer_id: string }>;

    expect(assignments.length).toBe(1);
    expect(assignments[0].producer_id).toBe(PRODUCER_A_ID);
  });
});

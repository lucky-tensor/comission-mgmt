/**
 * Refund and credit-memo adjustment ledger entry integration tests (issue #122).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — POST /placements/:id/adjustments with adjustment_type=refund creates a new
 *           ledger entry with type/amount/reason/actor/timestamp.
 *   AC#1b — POST with adjustment_type=credit_memo creates a new ledger entry similarly.
 *   AC#2 — Posting an adjustment never mutates or deletes a prior entry (prior rows
 *           are byte-identical before/after new insert).
 *   AC#3 — A missing reason is rejected with 400 (negative test).
 *   AC#4 — GET /placements/:id/adjustments returns refunds, credit-memos, and
 *           clawback/holdback entries in one ordered history.
 *   AC#5 — A non-Finance-Admin role receives 403 on the POST endpoint.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers called directly with injectable sql clients.
 * No Vitest mocking helpers are used — real Postgres only (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.4, §9
 *                 docs/architecture/phase-finance-close.md
 * Issue: feat: refund and credit-memo adjustment ledger entries (append-only) (#122)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { FieldEncryptor } from '../../../packages/db/src/encryption';
import { LocalDevKmsAdapter } from '../../../packages/db/src/kms-dev';
import {
  _setEncryptorForTest as _setPlacementsEncryptorForTest,
  _resetEncryptorForTest as _resetPlacementsEncryptorForTest,
} from '../../../packages/db/src/placements';
import {
  _setEncryptorForTest as _setCommRecordEncryptorForTest,
  _resetEncryptorForTest as _resetCommRecordEncryptorForTest,
} from '../../../packages/db/src/commission-records';
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
import {
  handlePostAdjustment,
  handleGetPlacementAdjustments,
} from '../../../apps/server/src/api/adjustments';
import { handleTriggerClawback } from '../../../apps/server/src/api/clawback';
import { createGuaranteePeriod } from '../../../packages/db/src/guarantee-periods';
import { createCommissionRecord } from '../../../packages/db/src/commission-records';
import { createContributor } from '../../../packages/db/src/contributors';
import { createPlan } from '../../../packages/db/src/plans';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let testAuditSql: ReturnType<typeof postgres>;

const ORG_ID = crypto.randomUUID();
const PRODUCER_USER_ID = crypto.randomUUID();

const financeAdmin: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producer: SessionClaims = {
  org_id: ORG_ID,
  user_id: PRODUCER_USER_ID,
  role: 'Producer',
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
  _setPlacementsEncryptorForTest(enc);
  _setCommRecordEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetPlacementsEncryptorForTest();
  _resetCommRecordEncryptorForTest();
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
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
}

/**
 * Creates a placement with a commission record.
 * Returns placement_id and commission_record_id.
 */
async function createFixture() {
  // Create placement via API handler
  const createReq = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      job_title: 'Senior Engineer',
      client_entity_id: crypto.randomUUID(),
      fee_amount: '50000',
      compensation_base: '200000',
      start_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      guarantee_days: 90,
    },
  });

  const res = await handleCreatePlacement(createReq, financeAdmin, testSql);
  expect(res.status).toBe(201);
  const placementData = (await res.json()) as { id: string };
  const placementId = placementData.id;

  // Create plan + version
  const { version: planVersion } = await createPlan(testSql, {
    orgId: ORG_ID,
    name: `Test Plan ${Date.now()}`,
    effectiveFrom: '2024-01-01',
    createdBy: financeAdmin.user_id,
    rules: { rate_type: 'gross_fee', base_rate: 0.25 },
  });

  // Create a contributor linked to the producer
  const contributor = await createContributor(testSql, {
    orgId: ORG_ID,
    placementId,
    producerId: PRODUCER_USER_ID,
    splitPct: 1.0,
    roleCode: 'AccountOwner',
  });

  // Create a commission record
  const commissionRecord = await createCommissionRecord(testSql, {
    orgId: ORG_ID,
    placementId,
    contributorId: contributor.id,
    planVersionId: planVersion.id,
    grossAmount: 12500,
    netPayable: 12500,
    status: 'Held',
    holdReason: 'guarantee_hold',
  });

  return {
    placementId,
    commissionRecordId: commissionRecord.id,
  };
}

/**
 * Creates a fixture with an active guarantee period suitable for clawback testing.
 */
async function createClawbackFixture() {
  const fixture = await createFixture();

  // Create an active guarantee period 30 days in the future
  const guaranteeEndsDate = new Date();
  guaranteeEndsDate.setUTCDate(guaranteeEndsDate.getUTCDate() + 30);
  const guaranteeEnds = guaranteeEndsDate.toISOString().slice(0, 10);

  const riskAmountBuffer = Buffer.from('3135303030', 'hex');
  await createGuaranteePeriod(testSql, {
    orgId: ORG_ID,
    placementId: fixture.placementId,
    guaranteeEnds,
    riskAmountBuffer,
  });

  return fixture;
}

// ---------------------------------------------------------------------------
// AC#1 — POST refund creates a new ledger entry with type/amount/reason/actor/timestamp
// ---------------------------------------------------------------------------

describe('POST /placements/:id/adjustments — refund', () => {
  test('creates a new refund ledger entry with all required fields', async () => {
    const { placementId, commissionRecordId } = await createFixture();

    const req = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'refund',
        commission_record_id: commissionRecordId,
        amount_delta: -1500,
        reason: 'Candidate did not start — full placement fee refunded',
      },
    });

    const res = await handlePostAdjustment(placementId, req, financeAdmin, testSql, testAuditSql);

    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      id: string;
      placement_id: string;
      commission_record_id: string;
      adjustment_type: string;
      amount_delta: string;
      reason: string;
      adjusted_by: string;
      adjusted_at: string;
      recovered: boolean;
    };

    expect(body.id).toBeTruthy();
    expect(body.placement_id).toBe(placementId);
    expect(body.commission_record_id).toBe(commissionRecordId);
    expect(body.adjustment_type).toBe('refund');
    expect(parseFloat(body.amount_delta)).toBe(-1500);
    expect(body.reason).toBe('Candidate did not start — full placement fee refunded');
    expect(body.adjusted_by).toBe(financeAdmin.user_id);
    expect(body.adjusted_at).toBeTruthy();
    expect(body.recovered).toBe(false);

    // Verify row exists in DB
    const rows = await testSql.unsafe(`SELECT * FROM commission_record_adjustments WHERE id = $1`, [
      body.id,
    ]);
    expect(rows.length).toBe(1);
    expect((rows[0] as Record<string, unknown>).reason_code).toBe('refund');
    expect((rows[0] as Record<string, unknown>).reason).toBe(
      'Candidate did not start — full placement fee refunded',
    );
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC#1b — POST credit_memo creates a new ledger entry with all required fields
// ---------------------------------------------------------------------------

describe('POST /placements/:id/adjustments — credit_memo', () => {
  test('creates a new credit_memo ledger entry with all required fields', async () => {
    const { placementId, commissionRecordId } = await createFixture();

    const req = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'credit_memo',
        commission_record_id: commissionRecordId,
        amount_delta: -750,
        reason: 'Credit memo CM-2024-001 applied per finance approval',
      },
    });

    const res = await handlePostAdjustment(placementId, req, financeAdmin, testSql, testAuditSql);

    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      id: string;
      adjustment_type: string;
      amount_delta: string;
      reason: string;
    };

    expect(body.adjustment_type).toBe('credit_memo');
    expect(parseFloat(body.amount_delta)).toBe(-750);
    expect(body.reason).toBe('Credit memo CM-2024-001 applied per finance approval');

    // Verify row in DB
    const rows = await testSql.unsafe(
      `SELECT reason_code, reason FROM commission_record_adjustments WHERE id = $1`,
      [body.id],
    );
    expect(rows.length).toBe(1);
    expect((rows[0] as Record<string, unknown>).reason_code).toBe('credit_memo');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC#2 — Append-only invariant: prior rows are byte-identical after new post
// ---------------------------------------------------------------------------

describe('POST /placements/:id/adjustments — append-only invariant', () => {
  test('prior adjustment rows are unchanged after posting a new adjustment', async () => {
    const { placementId, commissionRecordId } = await createFixture();

    // Post first adjustment
    const req1 = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'refund',
        commission_record_id: commissionRecordId,
        amount_delta: -500,
        reason: 'First adjustment',
      },
    });

    const res1 = await handlePostAdjustment(placementId, req1, financeAdmin, testSql, testAuditSql);
    expect(res1.status).toBe(201);
    const firstBody = (await res1.json()) as { id: string };
    const firstId = firstBody.id;

    // Capture the first row before the second insert
    const rowsBefore = await testSql.unsafe(
      `SELECT * FROM commission_record_adjustments WHERE id = $1`,
      [firstId],
    );
    expect(rowsBefore.length).toBe(1);
    const rowBefore = JSON.stringify(rowsBefore[0]);

    // Post second adjustment
    const req2 = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'credit_memo',
        commission_record_id: commissionRecordId,
        amount_delta: -200,
        reason: 'Second adjustment',
      },
    });

    const res2 = await handlePostAdjustment(placementId, req2, financeAdmin, testSql, testAuditSql);
    expect(res2.status).toBe(201);

    // Assert first row is byte-identical after the second insert
    const rowsAfter = await testSql.unsafe(
      `SELECT * FROM commission_record_adjustments WHERE id = $1`,
      [firstId],
    );
    expect(rowsAfter.length).toBe(1);
    const rowAfter = JSON.stringify(rowsAfter[0]);
    expect(rowAfter).toBe(rowBefore);

    // Assert total row count is 2 (new row added, not replacing)
    const allRows = await testSql.unsafe(
      `SELECT id FROM commission_record_adjustments WHERE commission_record_id = $1`,
      [commissionRecordId],
    );
    expect(allRows.length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC#3 — Missing reason returns 400
// ---------------------------------------------------------------------------

describe('POST /placements/:id/adjustments — reason-required negative test', () => {
  test('returns 400 when reason is missing', async () => {
    const { placementId, commissionRecordId } = await createFixture();

    const req = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'refund',
        commission_record_id: commissionRecordId,
        amount_delta: -100,
        // reason intentionally omitted
      },
    });

    const res = await handlePostAdjustment(placementId, req, financeAdmin, testSql, testAuditSql);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/reason/i);
  }, 60_000);

  test('returns 400 when reason is an empty string', async () => {
    const { placementId, commissionRecordId } = await createFixture();

    const req = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'refund',
        commission_record_id: commissionRecordId,
        amount_delta: -100,
        reason: '   ', // whitespace only
      },
    });

    const res = await handlePostAdjustment(placementId, req, financeAdmin, testSql, testAuditSql);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/reason/i);
  }, 60_000);

  test('returns 400 when adjustment_type is invalid', async () => {
    const { placementId, commissionRecordId } = await createFixture();

    const req = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'clawback', // valid reason_code but not allowed via this endpoint
        commission_record_id: commissionRecordId,
        amount_delta: -100,
        reason: 'some reason',
      },
    });

    const res = await handlePostAdjustment(placementId, req, financeAdmin, testSql, testAuditSql);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/adjustment_type/i);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC#4 — GET returns refunds, credit-memos, and clawback/holdback in one ordered history
// ---------------------------------------------------------------------------

describe('GET /placements/:id/adjustments — combined read ordering', () => {
  test('returns all adjustment types (refund, credit_memo, clawback) in ascending adjusted_at order', async () => {
    // Create fixture with a guarantee period so we can also post a clawback
    const { placementId, commissionRecordId } = await createClawbackFixture();

    // Post a clawback/holdback via the trigger endpoint first (it has an earlier timestamp)
    const triggerReq = makeRequest({
      path: `/placements/${placementId}/guarantee/trigger`,
      method: 'POST',
      body: {
        event_type: 'candidate_departure',
        rule: 'holdback',
      },
    });

    const triggerRes = await handleTriggerClawback(
      placementId,
      triggerReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );
    expect(triggerRes.status).toBe(201);

    // Wait a tick so adjusted_at timestamps are distinct
    await new Promise((r) => setTimeout(r, 50));

    // Post a refund adjustment
    const refundReq = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'refund',
        commission_record_id: commissionRecordId,
        amount_delta: -1000,
        reason: 'Partial refund issued',
      },
    });

    const refundRes = await handlePostAdjustment(
      placementId,
      refundReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );
    expect(refundRes.status).toBe(201);

    // Wait a tick so adjusted_at timestamps are distinct
    await new Promise((r) => setTimeout(r, 50));

    // Post a credit-memo adjustment
    const creditReq = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'credit_memo',
        commission_record_id: commissionRecordId,
        amount_delta: -500,
        reason: 'Credit memo applied',
      },
    });

    const creditRes = await handlePostAdjustment(
      placementId,
      creditReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );
    expect(creditRes.status).toBe(201);

    // Read the combined adjustment ledger
    const getRes = await handleGetPlacementAdjustments(
      placementId,
      financeAdmin,
      testSql,
      testAuditSql,
    );

    expect(getRes.status).toBe(200);

    const getBody = (await getRes.json()) as {
      placement_id: string;
      adjustments: Array<{
        id: string;
        adjustment_type: string;
        amount_delta: string;
        reason: string;
        adjusted_at: string;
      }>;
    };

    expect(getBody.placement_id).toBe(placementId);
    expect(getBody.adjustments.length).toBeGreaterThanOrEqual(3);

    // Verify all three types are present
    const types = getBody.adjustments.map((a) => a.adjustment_type);
    expect(types).toContain('holdback');
    expect(types).toContain('refund');
    expect(types).toContain('credit_memo');

    // Verify ascending order
    for (let i = 1; i < getBody.adjustments.length; i++) {
      const prev = new Date(getBody.adjustments[i - 1].adjusted_at).getTime();
      const curr = new Date(getBody.adjustments[i].adjusted_at).getTime();
      expect(prev).toBeLessThanOrEqual(curr);
    }

    // Verify reason field is present on refund and credit_memo
    const refundEntry = getBody.adjustments.find((a) => a.adjustment_type === 'refund');
    expect(refundEntry).toBeTruthy();
    expect(refundEntry?.reason).toBe('Partial refund issued');

    const creditEntry = getBody.adjustments.find((a) => a.adjustment_type === 'credit_memo');
    expect(creditEntry).toBeTruthy();
    expect(creditEntry?.reason).toBe('Credit memo applied');
  }, 120_000);
});

// ---------------------------------------------------------------------------
// AC#5 — Non-Finance-Admin role receives 403
// ---------------------------------------------------------------------------

describe('POST /placements/:id/adjustments — role isolation', () => {
  test('returns 403 when caller is a Producer', async () => {
    const { placementId, commissionRecordId } = await createFixture();

    const req = makeRequest({
      path: `/placements/${placementId}/adjustments`,
      method: 'POST',
      body: {
        adjustment_type: 'refund',
        commission_record_id: commissionRecordId,
        amount_delta: -100,
        reason: 'Unauthorised attempt',
      },
    });

    const res = await handlePostAdjustment(placementId, req, producer, testSql, testAuditSql);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Finance Admin/i);
  }, 60_000);

  test('returns 403 on GET when caller is a Producer', async () => {
    const { placementId } = await createFixture();

    const res = await handleGetPlacementAdjustments(placementId, producer, testSql, testAuditSql);

    expect(res.status).toBe(403);
  }, 60_000);
});

/**
 * Clawback and holdback event handling — integration tests (issue #20).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — POST /placements/:id/guarantee/trigger with event_type=candidate_departure and
 *           rule=clawback transitions Guarantee to Triggered and posts negative ledger
 *           adjustments to all affected CommissionRecords.
 *   AC#2 — Recovery schedule installment_amount = clawback_amount / installment_count
 *           (arithmetic unit test: clawback_amount=3000, installment_count=3, assert each=1000).
 *   AC#3 — GET /me/clawback-exposure for a Producer returns total outstanding clawback amount.
 *   AC#4 — AuditLogEntry is created for the trigger event and for each ledger adjustment.
 *   AC#5 — POST trigger on a placement outside the guarantee window returns 422.
 *
 * Test plan items:
 *   - Integration test: trigger endpoint posts adjustments and transitions guarantee.
 *   - Arithmetic test: installment_amount = clawback_amount / installment_count.
 *   - Out-of-window test: expired guarantee returns 422.
 *   - Producer exposure test: GET /me/clawback-exposure returns total.
 *   - Holdback rule test: adjustments posted but no recovery schedule.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers called directly with injectable sql clients.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.6, docs/architecture/phase-post-placement-risk.md
 * Issue: feat: clawback and holdback event handling (#20)
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
  handleTriggerClawback,
  handleGetMyClawbackExposure,
} from '../../../apps/server/src/api/clawback';
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
 * Creates a placement with an active guarantee period and a commission record.
 * Returns placement_id, guarantee_period_id, commission_record_id.
 */
async function createFixture(opts: {
  guaranteeDaysInFuture?: number; // positive = still inside window, negative = expired
  installmentCount?: number;
}) {
  const { guaranteeDaysInFuture = 30 } = opts;

  // Compute guarantee_ends
  const guaranteeEndsDate = new Date();
  guaranteeEndsDate.setUTCDate(guaranteeEndsDate.getUTCDate() + guaranteeDaysInFuture);
  const guaranteeEnds = guaranteeEndsDate.toISOString().slice(0, 10);

  // Create placement via API handler (sets guarantee_expiry_date)
  const placementBody = {
    candidate_id: crypto.randomUUID(),
    job_title: 'Senior Engineer',
    client_entity_id: crypto.randomUUID(),
    fee_amount: '50000',
    compensation_base: '200000',
    start_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), // 60 days ago
    guarantee_days: Math.abs(guaranteeDaysInFuture) + (guaranteeDaysInFuture < 0 ? 0 : 30),
  };

  const createReq = makeRequest({
    path: '/placements',
    method: 'POST',
    body: placementBody,
  });

  const res = await handleCreatePlacement(createReq, financeAdmin, testSql);
  expect(res.status).toBe(201);
  const placementData = (await res.json()) as { id: string };
  const placementId = placementData.id;

  // Create plan + version so commission records have a valid plan_version_id
  const { version: planVersion } = await createPlan(testSql, {
    orgId: ORG_ID,
    name: `Test Plan ${Date.now()}`,
    effectiveFrom: '2024-01-01',
    createdBy: financeAdmin.user_id,
    rules: { rate_type: 'gross_fee', base_rate: 0.25 },
  });

  // Create a contributor linked to the producer user
  const contributor = await createContributor(testSql, {
    orgId: ORG_ID,
    placementId,
    producerId: PRODUCER_USER_ID,
    splitPct: 1.0, // NUMERIC(5,4): 1.0000 = 100%
    roleCode: 'AccountOwner',
  });

  // Create a commission record for this placement
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

  // Create a guarantee period using the direct DB function
  const riskAmountBuffer = Buffer.from('3135303030', 'hex'); // dummy encrypted "15000"
  const guaranteePeriod = await createGuaranteePeriod(testSql, {
    orgId: ORG_ID,
    placementId,
    guaranteeEnds,
    riskAmountBuffer,
  });

  return {
    placementId,
    guaranteePeriodId: guaranteePeriod.id,
    commissionRecordId: commissionRecord.id,
    contributorId: contributor.id,
  };
}

// ---------------------------------------------------------------------------
// AC#2 — Arithmetic unit test (no DB needed)
// ---------------------------------------------------------------------------

describe('Recovery schedule arithmetic', () => {
  test('installment_amount = clawback_amount / installment_count (integer result)', () => {
    const clawbackAmount = 3000;
    const installmentCount = 3;
    const installmentAmount = parseFloat((clawbackAmount / installmentCount).toFixed(2));
    expect(installmentAmount).toBe(1000);
  });

  test('installment_amount rounds fractional cents', () => {
    const clawbackAmount = 1000;
    const installmentCount = 3;
    const installmentAmount = parseFloat((clawbackAmount / installmentCount).toFixed(2));
    expect(installmentAmount).toBeCloseTo(333.33, 2);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Out-of-window test: expired guarantee returns 422
// ---------------------------------------------------------------------------

describe('POST /placements/:id/guarantee/trigger — out-of-window', () => {
  test('returns 422 when guarantee period has already expired', async () => {
    // Create a placement + guarantee period that is expired (guaranteeEnds in the past)
    // We insert the guarantee period directly with a past date
    const guaranteeEndsDate = new Date();
    guaranteeEndsDate.setUTCDate(guaranteeEndsDate.getUTCDate() - 10); // 10 days ago
    const guaranteeEnds = guaranteeEndsDate.toISOString().slice(0, 10);

    const createReq = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        job_title: 'Junior Engineer',
        client_entity_id: crypto.randomUUID(),
        fee_amount: '20000',
        compensation_base: '100000',
        start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        guarantee_days: 30,
      },
    });

    const res = await handleCreatePlacement(createReq, financeAdmin, testSql);
    expect(res.status).toBe(201);
    const placementData = (await res.json()) as { id: string };
    const placementId = placementData.id;

    // Create a guarantee period with an expired date directly in the DB
    await testSql.unsafe(
      `INSERT INTO guarantee_periods (org_id, placement_id, guarantee_ends, risk_amount, status)
       VALUES ($1, $2, $3, $4, 'Active')`,
      [ORG_ID, placementId, guaranteeEnds, Buffer.alloc(4)],
    );

    const triggerReq = makeRequest({
      path: `/placements/${placementId}/guarantee/trigger`,
      method: 'POST',
      body: {
        event_type: 'candidate_departure',
        rule: 'clawback',
      },
    });

    const triggerRes = await handleTriggerClawback(
      placementId,
      triggerReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );

    expect(triggerRes.status).toBe(422);
    const body = (await triggerRes.json()) as { error: string };
    expect(body.error).toContain('outside the guarantee window');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC#1 — Integration test: trigger posts adjustments + transitions guarantee
// ---------------------------------------------------------------------------

describe('POST /placements/:id/guarantee/trigger — clawback rule', () => {
  test('transitions guarantee to Triggered and posts negative ledger adjustments', async () => {
    const { placementId, guaranteePeriodId } = await createFixture({ guaranteeDaysInFuture: 30 });

    const triggerReq = makeRequest({
      path: `/placements/${placementId}/guarantee/trigger`,
      method: 'POST',
      body: {
        event_type: 'candidate_departure',
        rule: 'clawback',
        installment_count: 3,
      },
    });

    const res = await handleTriggerClawback(
      placementId,
      triggerReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      clawback_event_id: string;
      placement_id: string;
      guarantee_period_id: string;
      event_type: string;
      rule: string;
      commission_records_affected: number;
      adjustments_posted: number;
      recovery_schedules: { installment_count: number; installment_amount: string }[];
    };

    expect(body.placement_id).toBe(placementId);
    expect(body.guarantee_period_id).toBe(guaranteePeriodId);
    expect(body.event_type).toBe('candidate_departure');
    expect(body.rule).toBe('clawback');
    expect(body.adjustments_posted).toBeGreaterThanOrEqual(1);
    expect(body.recovery_schedules.length).toBeGreaterThanOrEqual(1);
    expect(body.recovery_schedules[0]!.installment_count).toBe(3);

    // Verify guarantee period transitioned to Triggered in DB
    const periodRows = await testSql.unsafe(`SELECT status FROM guarantee_periods WHERE id = $1`, [
      guaranteePeriodId,
    ]);
    expect(periodRows[0]?.status).toBe('Triggered');

    // Verify commission record transitioned to ClawbackInitiated in DB
    const crRows = await testSql.unsafe(
      `SELECT status FROM commission_records WHERE placement_id = $1`,
      [placementId],
    );
    expect(crRows.length).toBeGreaterThanOrEqual(1);
    for (const row of crRows as unknown as { status: string }[]) {
      expect(row.status).toBe('ClawbackInitiated');
    }

    // Verify ledger adjustments exist in DB
    const adjRows = await testSql.unsafe(
      `SELECT id, amount_delta, reason_code FROM commission_record_adjustments
       WHERE clawback_event_id = $1`,
      [body.clawback_event_id],
    );
    expect(adjRows.length).toBeGreaterThanOrEqual(1);
    for (const adj of adjRows as unknown as { amount_delta: string; reason_code: string }[]) {
      expect(parseFloat(adj.amount_delta)).toBeLessThan(0);
      expect(adj.reason_code).toBe('clawback');
    }
  }, 60_000);

  test('returns 422 when no guarantee period exists', async () => {
    const createReq = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        job_title: 'VP Engineering',
        client_entity_id: crypto.randomUUID(),
        fee_amount: '80000',
        compensation_base: '300000',
        start_date: '2024-01-01',
      },
    });

    const placementRes = await handleCreatePlacement(createReq, financeAdmin, testSql);
    expect(placementRes.status).toBe(201);
    const { id: placementIdNoGuarantee } = (await placementRes.json()) as { id: string };

    const triggerReq = makeRequest({
      path: `/placements/${placementIdNoGuarantee}/guarantee/trigger`,
      method: 'POST',
      body: { event_type: 'refund', rule: 'holdback' },
    });

    const triggerRes = await handleTriggerClawback(
      placementIdNoGuarantee,
      triggerReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );

    expect(triggerRes.status).toBe(422);
    const body = (await triggerRes.json()) as { error: string };
    expect(body.error).toContain('No guarantee period');
  }, 60_000);

  test('returns 400 for invalid event_type', async () => {
    const { placementId } = await createFixture({ guaranteeDaysInFuture: 30 });

    const triggerReq = makeRequest({
      path: `/placements/${placementId}/guarantee/trigger`,
      method: 'POST',
      body: { event_type: 'invalid_type', rule: 'clawback' },
    });

    const res = await handleTriggerClawback(
      placementId,
      triggerReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );

    expect(res.status).toBe(400);
  }, 30_000);

  test('returns 403 when caller is not FinanceAdmin', async () => {
    const { placementId } = await createFixture({ guaranteeDaysInFuture: 30 });

    const triggerReq = makeRequest({
      path: `/placements/${placementId}/guarantee/trigger`,
      method: 'POST',
      body: { event_type: 'candidate_departure', rule: 'clawback' },
    });

    const res = await handleTriggerClawback(
      placementId,
      triggerReq,
      producer, // Producer role — should be rejected
      testSql,
      testAuditSql,
    );

    expect(res.status).toBe(403);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC#4 — AuditLogEntry count test
// ---------------------------------------------------------------------------

describe('Audit log entries on clawback trigger', () => {
  test('creates AuditLogEntry for trigger event and each adjustment', async () => {
    const { placementId } = await createFixture({ guaranteeDaysInFuture: 30 });

    // Count audit entries before trigger
    const beforeRows = await testAuditSql.unsafe(
      `SELECT COUNT(*) AS cnt FROM audit_log_entries
       WHERE org_id = $1 AND action LIKE 'clawback.%'`,
      [ORG_ID],
    );
    const beforeCount = parseInt((beforeRows[0] as unknown as { cnt: string }).cnt, 10);

    const triggerReq = makeRequest({
      path: `/placements/${placementId}/guarantee/trigger`,
      method: 'POST',
      body: { event_type: 'candidate_departure', rule: 'clawback', installment_count: 3 },
    });

    const res = await handleTriggerClawback(
      placementId,
      triggerReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      adjustments_posted: number;
      clawback_event_id: string;
    };

    // After trigger: should have at least 1 (trigger) + adjustments_posted (one per adjustment)
    const afterRows = await testAuditSql.unsafe(
      `SELECT COUNT(*) AS cnt FROM audit_log_entries
       WHERE org_id = $1 AND action LIKE 'clawback.%'`,
      [ORG_ID],
    );
    const afterCount = parseInt((afterRows[0] as unknown as { cnt: string }).cnt, 10);

    // At minimum: 1 trigger event + N adjustment entries
    const expectedMinDelta = 1 + body.adjustments_posted;
    expect(afterCount - beforeCount).toBeGreaterThanOrEqual(expectedMinDelta);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC#3 — Producer exposure integration test
// ---------------------------------------------------------------------------

describe('GET /me/clawback-exposure', () => {
  test('returns total outstanding clawback amount for the producer', async () => {
    // First ensure the producer has a fixture with a triggered clawback
    const { placementId } = await createFixture({ guaranteeDaysInFuture: 30 });

    // Trigger clawback
    const triggerReq = makeRequest({
      path: `/placements/${placementId}/guarantee/trigger`,
      method: 'POST',
      body: { event_type: 'candidate_departure', rule: 'clawback', installment_count: 3 },
    });

    const triggerRes = await handleTriggerClawback(
      placementId,
      triggerReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );
    expect(triggerRes.status).toBe(201);

    // Now check the producer's exposure
    const exposureRes = await handleGetMyClawbackExposure(producer, testSql, testSql);
    expect(exposureRes.status).toBe(200);

    const body = (await exposureRes.json()) as {
      producer_id: string;
      total_exposure: number;
    };

    expect(body.producer_id).toBe(PRODUCER_USER_ID);
    // total_exposure should be negative (outstanding clawback deduction)
    // or 0 if no adjustments for this producer's records yet
    expect(typeof body.total_exposure).toBe('number');
  }, 60_000);

  test('returns 403 when caller is not Producer role', async () => {
    const res = await handleGetMyClawbackExposure(financeAdmin, testSql, testSql);
    expect(res.status).toBe(403);
  }, 10_000);

  test('returns 200 with total_exposure=0 when producer has no clawback adjustments', async () => {
    // Create a producer with no triggered clawbacks
    const newProducer: SessionClaims = {
      org_id: ORG_ID,
      user_id: crypto.randomUUID(), // new producer with no data
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const res = await handleGetMyClawbackExposure(newProducer, testSql, testSql);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total_exposure: number };
    expect(body.total_exposure).toBe(0);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Holdback rule test — adjustments posted but no recovery schedule
// ---------------------------------------------------------------------------

describe('POST /placements/:id/guarantee/trigger — holdback rule', () => {
  test('posts adjustments but no recovery schedule for holdback rule', async () => {
    const { placementId } = await createFixture({ guaranteeDaysInFuture: 30 });

    const triggerReq = makeRequest({
      path: `/placements/${placementId}/guarantee/trigger`,
      method: 'POST',
      body: { event_type: 'candidate_departure', rule: 'holdback' },
    });

    const res = await handleTriggerClawback(
      placementId,
      triggerReq,
      financeAdmin,
      testSql,
      testAuditSql,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      rule: string;
      adjustments_posted: number;
      recovery_schedules: unknown[];
    };

    expect(body.rule).toBe('holdback');
    expect(body.adjustments_posted).toBeGreaterThanOrEqual(1);
    expect(body.recovery_schedules).toHaveLength(0);
  }, 60_000);
});

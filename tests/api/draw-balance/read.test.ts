/**
 * Per-producer draw balance and recovery schedule read API — integration tests (issue #124).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — GET /producers/:id/draw-balance returns outstanding draw balance and recovery schedule
 *           for a seeded producer with a draw and a clawback recovery.
 *   AC#2 — The aggregate matches the engine-computed draw offset and per-placement clawback
 *           recovery for that producer (cross-checks against underlying records).
 *   AC#3 — A producer with no draw returns zero/empty balance, not an error.
 *   AC#4 — HR and the producer can read; another producer and non-privileged roles get 403.
 *           Tenant isolation: a different org cannot read.
 *
 * Test plan:
 *   - tests/api/draw-balance/read.test.ts (this suite)
 *   - vitest.draw-balance.config.ts wires the suite into CI
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers called directly with injectable sql clients.
 * No Vitest mocking helpers are used — real Postgres only (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §4, §6, docs/architecture/phase-commission-engine.md
 * Issue: feat: per-producer draw balance and recovery schedule read API (#124)
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
import {
  _setEncryptorForTest as _setDrawBalanceEncryptorForTest,
  _resetEncryptorForTest as _resetDrawBalanceEncryptorForTest,
  createDrawBalance,
} from '../../../packages/db/src/draw-balance';
import { handleGetProducerDrawBalance } from '../../../apps/server/src/api/draw-balance';
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
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
const OTHER_ORG_ID = crypto.randomUUID();
const PRODUCER_USER_ID = crypto.randomUUID();

const hrClaims: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(),
  role: 'HR',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

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

const otherProducer: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(), // different producer in same org
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
  _setDrawBalanceEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetPlacementsEncryptorForTest();
  _resetCommRecordEncryptorForTest();
  _resetDrawBalanceEncryptorForTest();
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
 * Creates a placement with a guarantee period, contributor for PRODUCER_USER_ID,
 * a commission record, and triggers a clawback to create recovery schedules.
 */
async function createFixtureWithClawback() {
  // Compute guarantee_ends in the future
  const guaranteeEndsDate = new Date();
  guaranteeEndsDate.setUTCDate(guaranteeEndsDate.getUTCDate() + 30);
  const guaranteeEnds = guaranteeEndsDate.toISOString().slice(0, 10);

  // Create placement
  const placementBody = {
    candidate_id: crypto.randomUUID(),
    job_title: 'Senior Engineer',
    client_entity_id: crypto.randomUUID(),
    fee_amount: '50000',
    compensation_base: '200000',
    start_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    guarantee_days: 90,
  };

  const createReq = makeRequest({ path: '/placements', method: 'POST', body: placementBody });
  const res = await handleCreatePlacement(createReq, financeAdmin, testSql);
  expect(res.status).toBe(201);
  const placementData = (await res.json()) as { id: string };
  const placementId = placementData.id;

  // Create plan
  const { version: planVersion } = await createPlan(testSql, {
    orgId: ORG_ID,
    name: `Draw Test Plan ${Date.now()}`,
    effectiveFrom: '2024-01-01',
    createdBy: financeAdmin.user_id,
    rules: { rate_type: 'gross_fee', base_rate: 0.25 },
  });

  // Create contributor linked to PRODUCER_USER_ID
  const contributor = await createContributor(testSql, {
    orgId: ORG_ID,
    placementId,
    producerId: PRODUCER_USER_ID,
    splitPct: 1.0,
    roleCode: 'AccountOwner',
  });

  // Create commission record
  await createCommissionRecord(testSql, {
    orgId: ORG_ID,
    placementId,
    contributorId: contributor.id,
    planVersionId: planVersion.id,
    grossAmount: 12500,
    netPayable: 12500,
    status: 'Held',
    holdReason: 'guarantee_hold',
  });

  // Create guarantee period
  const riskAmountBuffer = Buffer.from('3135303030', 'hex');
  const guaranteePeriod = await createGuaranteePeriod(testSql, {
    orgId: ORG_ID,
    placementId,
    guaranteeEnds,
    riskAmountBuffer,
  });

  // Trigger clawback to create recovery schedules
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

  return { placementId, guaranteePeriodId: guaranteePeriod.id, contributorId: contributor.id };
}

// ---------------------------------------------------------------------------
// AC#3 — Zero-draw case
// ---------------------------------------------------------------------------

describe('GET /producers/:id/draw-balance — no draw record', () => {
  test('returns zero balance and empty schedules for a producer with no draw', async () => {
    const noDrawProducerId = crypto.randomUUID();
    const claims: SessionClaims = {
      org_id: ORG_ID,
      user_id: noDrawProducerId,
      role: 'Producer',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const res = await handleGetProducerDrawBalance(noDrawProducerId, claims, testSql, testAuditSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      producer_id: string;
      draw_balance: {
        id: string | null;
        status: string | null;
        outstanding_balance: string;
        draw_limit: string;
      };
      recovery_schedules: unknown[];
    };

    expect(body.producer_id).toBe(noDrawProducerId);
    expect(body.draw_balance.id).toBeNull();
    expect(body.draw_balance.status).toBeNull();
    expect(body.draw_balance.outstanding_balance).toBe('0');
    expect(body.recovery_schedules).toHaveLength(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC#1 + AC#2 — Balance + schedule read, aggregate cross-check
// ---------------------------------------------------------------------------

describe('GET /producers/:id/draw-balance — draw balance and recovery schedules', () => {
  test('returns outstanding draw balance and clawback recovery schedules', async () => {
    // Seed a draw_balances row for the producer
    await createDrawBalance(testSql, {
      orgId: ORG_ID,
      producerId: PRODUCER_USER_ID,
      balance: '5000.00',
      drawLimit: '10000.00',
      status: 'Active',
      recoveryStart: '2024-01-01',
      recoveryEnd: '2024-06-30',
    });

    // Create a fixture with a triggered clawback so recovery schedules exist
    await createFixtureWithClawback();

    const res = await handleGetProducerDrawBalance(
      PRODUCER_USER_ID,
      hrClaims,
      testSql,
      testAuditSql,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      producer_id: string;
      draw_balance: {
        id: string;
        status: string;
        outstanding_balance: string;
        draw_limit: string;
        recovery_start: string;
        recovery_end: string;
      };
      recovery_schedules: {
        id: string;
        clawback_event_id: string;
        commission_record_id: string;
        placement_id: string;
        clawback_amount: string;
        installment_count: number;
        installment_amount: string;
      }[];
    };

    expect(body.producer_id).toBe(PRODUCER_USER_ID);

    // AC#1: draw balance fields are populated
    expect(body.draw_balance.id).not.toBeNull();
    expect(body.draw_balance.status).toBe('Active');
    expect(body.draw_balance.outstanding_balance).toBe('5000.00');
    expect(body.draw_balance.draw_limit).toBe('10000.00');
    expect(body.draw_balance.recovery_start).toBe('2024-01-01');
    expect(body.draw_balance.recovery_end).toBe('2024-06-30');

    // AC#2: recovery schedules are present and cross-check against DB
    expect(body.recovery_schedules.length).toBeGreaterThanOrEqual(1);

    // Verify each schedule exists in the DB
    for (const schedule of body.recovery_schedules) {
      const dbRows = await testSql.unsafe(
        `SELECT id, clawback_amount::text, installment_count, installment_amount::text
         FROM clawback_recovery_schedules WHERE id = $1`,
        [schedule.id],
      );
      expect(dbRows.length).toBe(1);
      const dbRow = dbRows[0] as unknown as {
        id: string;
        clawback_amount: string;
        installment_count: number;
        installment_amount: string;
      };
      expect(schedule.clawback_amount).toBe(dbRow.clawback_amount);
      expect(schedule.installment_count).toBe(dbRow.installment_count);
      expect(schedule.installment_amount).toBe(dbRow.installment_amount);
    }

    // Also verify the draw_balance row exists in DB with correct org scoping
    const drawRows = await testSql.unsafe(
      `SELECT id, status FROM draw_balances WHERE id = $1 AND org_id = $2`,
      [body.draw_balance.id, ORG_ID],
    );
    expect(drawRows.length).toBe(1);
    expect((drawRows[0] as unknown as { status: string }).status).toBe('Active');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC#4 — Role and isolation tests
// ---------------------------------------------------------------------------

describe('GET /producers/:id/draw-balance — RBAC and isolation', () => {
  test('HR can read any producer in the org', async () => {
    const res = await handleGetProducerDrawBalance(
      PRODUCER_USER_ID,
      hrClaims,
      testSql,
      testAuditSql,
    );
    expect(res.status).toBe(200);
  }, 30_000);

  test('Producer can read their own draw balance', async () => {
    const res = await handleGetProducerDrawBalance(
      PRODUCER_USER_ID,
      producer,
      testSql,
      testAuditSql,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { producer_id: string };
    expect(body.producer_id).toBe(PRODUCER_USER_ID);
  }, 30_000);

  test("Producer cannot read another producer's draw balance (403)", async () => {
    // otherProducer tries to read PRODUCER_USER_ID's balance
    const res = await handleGetProducerDrawBalance(
      PRODUCER_USER_ID,
      otherProducer, // wrong producer
      testSql,
      testAuditSql,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('own draw balance');
  }, 10_000);

  test('FinanceAdmin gets 403 (not HR or Producer)', async () => {
    const res = await handleGetProducerDrawBalance(
      PRODUCER_USER_ID,
      financeAdmin,
      testSql,
      testAuditSql,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('HR or Producer role required');
  }, 10_000);

  test('Manager gets 403', async () => {
    const managerClaims: SessionClaims = {
      org_id: ORG_ID,
      user_id: crypto.randomUUID(),
      role: 'Manager',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const res = await handleGetProducerDrawBalance(
      PRODUCER_USER_ID,
      managerClaims,
      testSql,
      testAuditSql,
    );
    expect(res.status).toBe(403);
  }, 10_000);

  test("Tenant isolation: HR from another org sees zero (not other org's data)", async () => {
    // HR from OTHER_ORG_ID tries to read PRODUCER_USER_ID who belongs to ORG_ID
    const otherOrgHr: SessionClaims = {
      org_id: OTHER_ORG_ID,
      user_id: crypto.randomUUID(),
      role: 'HR',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const res = await handleGetProducerDrawBalance(
      PRODUCER_USER_ID,
      otherOrgHr,
      testSql,
      testAuditSql,
    );
    // Should return 200 with zero balance (no data found for that org+producer combo)
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draw_balance: { id: string | null; outstanding_balance: string };
      recovery_schedules: unknown[];
    };
    // No draw row exists for OTHER_ORG_ID + PRODUCER_USER_ID
    expect(body.draw_balance.id).toBeNull();
    expect(body.draw_balance.outstanding_balance).toBe('0');
    expect(body.recovery_schedules).toHaveLength(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Audit log test
// ---------------------------------------------------------------------------

describe('GET /producers/:id/draw-balance — audit log', () => {
  test('writes an audit log entry for the read', async () => {
    const beforeRows = await testAuditSql.unsafe(
      `SELECT COUNT(*) AS cnt FROM audit_log_entries
       WHERE org_id = $1 AND action = 'draw_balance.read'`,
      [ORG_ID],
    );
    const beforeCount = parseInt((beforeRows[0] as unknown as { cnt: string }).cnt, 10);

    await handleGetProducerDrawBalance(PRODUCER_USER_ID, hrClaims, testSql, testAuditSql);

    const afterRows = await testAuditSql.unsafe(
      `SELECT COUNT(*) AS cnt FROM audit_log_entries
       WHERE org_id = $1 AND action = 'draw_balance.read'`,
      [ORG_ID],
    );
    const afterCount = parseInt((afterRows[0] as unknown as { cnt: string }).cnt, 10);

    expect(afterCount).toBeGreaterThan(beforeCount);
  }, 30_000);
});

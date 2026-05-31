/**
 * Guarantee period tracking and monitoring — integration tests (issue #19).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — guarantee_expiry_date = start_date + guarantee_period_days is computed correctly
 *           (unit test on computeGuaranteeExpiryDate) and stored on Placement.
 *   AC#2 — GET /placements?guarantee=active returns only placements inside an active window
 *           (today < guarantee_expiry_date).
 *   AC#3 — When guarantee_expiry_date passes, the background job transitions Guarantee to
 *           ExpiredClean and releases held CommissionRecords to Payable.
 *   AC#4 — AuditLogEntry is created on clean expiry.
 *   AC#5 — GET /placements/:id/guarantee returns current state and expiry date.
 *
 * Test plan items:
 *   - Unit test: computeGuaranteeExpiryDate for various start dates and period_days values.
 *   - Integration test: create placement with guarantee, use a past expiry date, run expiry
 *     worker handler directly, assert Guarantee=ExpiredClean and CommissionRecord=Payable.
 *   - Filter test: three placements — one expired, one active, one far future;
 *     assert GET /placements?guarantee=active returns only the active one.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.6, docs/architecture/phase-post-placement-risk.md
 * Issue: feat: guarantee period tracking and monitoring (#19)
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
  handleCreatePlacement,
  handleListPlacements,
  handleGetPlacementGuarantee,
  computeGuaranteeExpiryDate,
} from '../../../apps/server/src/api/placements';
import {
  createGuaranteePeriod,
  listActiveExpiredGuaranteePeriods,
} from '../../../packages/db/src/guarantee-periods';
import { createCommissionRecord } from '../../../packages/db/src/commission-records';
import { processGuaranteeExpiredRecalc } from '../../../apps/server/src/api/guarantee-expiry-worker';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let testAuditSql: ReturnType<typeof postgres>;

const ORG_ID = crypto.randomUUID();

const financeAdmin: SessionClaims = {
  org_id: ORG_ID,
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
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
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
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function jsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return JSON.parse(text);
}

async function createTestPlacement(
  startDate: string,
  guaranteeDays: number,
): Promise<{ id: string; guaranteeExpiryDate: string | null }> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Software Engineer',
      compensation_base: '120000',
      fee_amount: '18000',
      start_date: startDate,
      guarantee_days: guaranteeDays,
    },
  });
  const res = await handleCreatePlacement(req, financeAdmin, testSql);
  expect(res.status).toBe(201);
  const body = (await jsonBody(res)) as { id: string; guarantee_expiry_date: string | null };
  return { id: body.id, guaranteeExpiryDate: body.guarantee_expiry_date };
}

// ---------------------------------------------------------------------------
// AC#1 — computeGuaranteeExpiryDate unit tests
// ---------------------------------------------------------------------------

describe('computeGuaranteeExpiryDate', () => {
  test('computes expiry correctly for a standard case', () => {
    expect(computeGuaranteeExpiryDate('2025-01-01', 90)).toBe('2025-04-01');
  });

  test('computes expiry across month boundary', () => {
    expect(computeGuaranteeExpiryDate('2025-01-15', 30)).toBe('2025-02-14');
  });

  test('computes expiry across year boundary', () => {
    expect(computeGuaranteeExpiryDate('2024-12-01', 60)).toBe('2025-01-30');
  });

  test('returns null when startDate is null', () => {
    expect(computeGuaranteeExpiryDate(null, 90)).toBeNull();
  });

  test('returns null when guaranteeDays is null', () => {
    expect(computeGuaranteeExpiryDate('2025-01-01', null)).toBeNull();
  });

  test('returns null when guaranteeDays is negative', () => {
    expect(computeGuaranteeExpiryDate('2025-01-01', -1)).toBeNull();
  });

  test('returns same date when guaranteeDays is 0', () => {
    expect(computeGuaranteeExpiryDate('2025-06-15', 0)).toBe('2025-06-15');
  });
});

// ---------------------------------------------------------------------------
// AC#1 — guarantee_expiry_date stored on Placement via POST /placements
// ---------------------------------------------------------------------------

describe('POST /placements — guarantee_expiry_date', () => {
  test('stores guarantee_expiry_date = start_date + guarantee_days', async () => {
    const { id, guaranteeExpiryDate } = await createTestPlacement('2025-01-01', 90);
    expect(id).toBeTruthy();
    // 2025-01-01 + 90 days = 2025-04-01
    expect(guaranteeExpiryDate).toBe('2025-04-01');
  });

  test('guarantee_expiry_date is null when start_date is absent', async () => {
    const req = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Analyst',
        compensation_base: '90000',
        fee_amount: '13500',
        guarantee_days: 60,
      },
    });
    const res = await handleCreatePlacement(req, financeAdmin, testSql);
    expect(res.status).toBe(201);
    const body = (await jsonBody(res)) as { guarantee_expiry_date: string | null };
    expect(body.guarantee_expiry_date).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC#2 — GET /placements?guarantee=active filter
// ---------------------------------------------------------------------------

describe('GET /placements?guarantee=active', () => {
  test('returns only placements inside an active guarantee window', async () => {
    // Create three placements with distinct guarantee dates
    const now = new Date();

    // Placement A: already expired (past)
    const pastStartDate = '2020-01-01'; // start_date in the past
    const { id: placementAId } = await createTestPlacement(pastStartDate, 30); // expired 2020-01-31

    // Placement B: active window (future expiry) — start today - 10 days with 365-day guarantee
    const recentDate = new Date(now);
    recentDate.setUTCDate(recentDate.getUTCDate() - 10);
    const recentStart = recentDate.toISOString().slice(0, 10);
    const { id: placementBId } = await createTestPlacement(recentStart, 365);

    // Placement C: far future start_date — guarantee not yet started
    const futureDate = new Date(now);
    futureDate.setUTCFullYear(futureDate.getUTCFullYear() + 1);
    const futureStart = futureDate.toISOString().slice(0, 10);
    const { id: placementCId } = await createTestPlacement(futureStart, 90);

    // Insert guarantee_periods rows to drive the filter:
    //   A: past (status Active but guarantee_ends in past) — should NOT be returned
    //   B: active (guarantee_ends in future) — SHOULD be returned
    //   C: not yet started — create with far-future guarantee_ends — technically active
    // We want to test that the filter correctly uses today < guarantee_ends

    const riskBuf = Buffer.alloc(1); // sentinel — risk_amount required by schema

    // A: expired guarantee_period (ends in the past)
    await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId: placementAId,
      guaranteeEnds: '2020-01-31', // in the past
      riskAmountBuffer: riskBuf,
    });

    // B: active guarantee_period (ends in the future)
    const bEnds = new Date(now);
    bEnds.setUTCDate(bEnds.getUTCDate() + 355); // 355 days from now
    await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId: placementBId,
      guaranteeEnds: bEnds.toISOString().slice(0, 10),
      riskAmountBuffer: riskBuf,
    });

    // C: far-future guarantee_period
    const cEnds = new Date(futureDate);
    cEnds.setUTCDate(cEnds.getUTCDate() + 90);
    await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId: placementCId,
      guaranteeEnds: cEnds.toISOString().slice(0, 10),
      riskAmountBuffer: riskBuf,
    });

    // GET /placements?guarantee=active
    const req = makeRequest({ path: '/placements?guarantee=active' });
    const res = await handleListPlacements(req, financeAdmin, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Array<{ id: string }>;
    const ids = body.map((p) => p.id);

    // B and C both have future guarantee_ends and Active status → both returned
    expect(ids).toContain(placementBId);
    expect(ids).toContain(placementCId);
    // A has past guarantee_ends → NOT returned
    expect(ids).not.toContain(placementAId);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — background job transitions Guarantee → ExpiredClean and releases holds
// AC#4 — AuditLogEntry created on clean expiry
// ---------------------------------------------------------------------------

describe('processGuaranteeExpiredRecalc', () => {
  test('transitions ExpiredClean and releases held commission records', async () => {
    // Set up a placement with a past expiry date
    const { id: placementId } = await createTestPlacement('2024-01-01', 30); // expired 2024-01-31

    // Update the placement status to GuaranteeActive
    await testSql.unsafe(`UPDATE placements SET status = 'GuaranteeActive' WHERE id = $1`, [
      placementId,
    ]);

    // Insert a guarantee_period with a past guarantee_ends
    const riskBuf = Buffer.alloc(1);
    const period = await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId,
      guaranteeEnds: '2024-01-31', // past
      riskAmountBuffer: riskBuf,
    });

    // Insert a commission record in Held state with hold_reason='guarantee_hold'.
    // contributor_id is a FK to contributors.id; plan_version_id is a FK to plan_versions.id.
    // Insert the minimal chain: commission_plan → plan_version → contributor → commission_record.
    const producerId = crypto.randomUUID();

    const [planRow] = (await testSql.unsafe(
      `INSERT INTO commission_plans (org_id, name, effective_from, config_entity_id, created_by)
       VALUES ($1, $2, '2024-01-01', $3, $4) RETURNING id`,
      [
        ORG_ID,
        `Guarantee Test Plan ${crypto.randomUUID()}`,
        crypto.randomUUID(),
        crypto.randomUUID(),
      ],
    )) as unknown as Array<{ id: string }>;

    const [planVersionRow] = (await testSql.unsafe(
      `INSERT INTO plan_versions (org_id, plan_id, version_num, status, rules_snapshot, effective_at)
       VALUES ($1, $2, 1, 'Active', '{"tiers":[]}'::jsonb, NOW()) RETURNING id`,
      [ORG_ID, planRow.id],
    )) as unknown as Array<{ id: string }>;
    const planVersionId = planVersionRow.id;

    const [contributorRow] = (await testSql.unsafe(
      `INSERT INTO contributors (org_id, placement_id, producer_id, role_code, split_pct)
       VALUES ($1, $2, $3, 'owner', 1.0) RETURNING id`,
      [ORG_ID, placementId, producerId],
    )) as unknown as Array<{ id: string }>;
    const contributorId = contributorRow.id;

    const commRecord = await createCommissionRecord(testSql, {
      orgId: ORG_ID,
      placementId,
      contributorId,
      planVersionId,
      grossAmount: '18000',
      netPayable: '18000',
      status: 'Held',
      holdReason: 'guarantee_hold',
    });

    expect(commRecord.status).toBe('Held');
    expect(commRecord.holdReason).toBe('guarantee_hold');

    // Run the worker handler
    const result = await processGuaranteeExpiredRecalc(
      {
        guarantee_period_id: period.id,
        placement_id: placementId,
        org_id: ORG_ID,
      },
      testSql,
      testAuditSql,
    );

    expect(result.skipped).toBe(false);
    expect(result.new_guarantee_state).toBe('ExpiredClean');
    expect(result.commission_records_released).toBe(1);

    // Verify commission record is now Payable
    const [updatedRecord] = (await testSql.unsafe(
      `SELECT status, hold_reason FROM commission_records WHERE id = $1`,
      [commRecord.id],
    )) as unknown as Array<{ status: string; hold_reason: string | null }>;
    expect(updatedRecord.status).toBe('Payable');
    expect(updatedRecord.hold_reason).toBeNull();

    // Verify guarantee_periods row is ExpiredClean
    const [updatedPeriod] = (await testSql.unsafe(
      `SELECT status FROM guarantee_periods WHERE id = $1`,
      [period.id],
    )) as unknown as Array<{ status: string }>;
    expect(updatedPeriod.status).toBe('ExpiredClean');
  });

  test('is idempotent — skips when guarantee period is already ExpiredClean', async () => {
    const { id: placementId } = await createTestPlacement('2024-02-01', 30);

    const riskBuf = Buffer.alloc(1);
    const period = await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId,
      guaranteeEnds: '2024-02-28',
      riskAmountBuffer: riskBuf,
    });

    // Manually mark as ExpiredClean
    await testSql.unsafe(
      `UPDATE guarantee_periods SET status = 'ExpiredClean', expired_at = NOW() WHERE id = $1`,
      [period.id],
    );

    const result = await processGuaranteeExpiredRecalc(
      {
        guarantee_period_id: period.id,
        placement_id: placementId,
        org_id: ORG_ID,
      },
      testSql,
      testAuditSql,
    );

    expect(result.skipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — AuditLogEntry created on clean expiry
// ---------------------------------------------------------------------------

describe('AuditLogEntry on clean expiry', () => {
  test('writes an audit log entry with action=guarantee.expired_clean', async () => {
    const { id: placementId } = await createTestPlacement('2023-01-01', 30);

    await testSql.unsafe(`UPDATE placements SET status = 'GuaranteeActive' WHERE id = $1`, [
      placementId,
    ]);

    const riskBuf = Buffer.alloc(1);
    const period = await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId,
      guaranteeEnds: '2023-01-31',
      riskAmountBuffer: riskBuf,
    });

    await processGuaranteeExpiredRecalc(
      { guarantee_period_id: period.id, placement_id: placementId, org_id: ORG_ID },
      testSql,
      testAuditSql,
    );

    const auditRows = (await testAuditSql.unsafe(
      `SELECT action, entity_type, entity_id FROM audit_log_entries
       WHERE entity_id = $1 AND action = 'guarantee.expired_clean'`,
      [period.id],
    )) as unknown as Array<{ action: string; entity_type: string; entity_id: string }>;

    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].action).toBe('guarantee.expired_clean');
    expect(auditRows[0].entity_type).toBe('guarantee_period');
    expect(auditRows[0].entity_id).toBe(period.id);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — GET /placements/:id/guarantee returns current state and expiry date
// ---------------------------------------------------------------------------

describe('GET /placements/:id/guarantee', () => {
  test('returns guarantee state and expiry for a placement with an active period', async () => {
    const { id: placementId } = await createTestPlacement('2025-03-01', 90);

    const riskBuf = Buffer.alloc(1);
    const period = await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId,
      guaranteeEnds: '2025-05-30',
      riskAmountBuffer: riskBuf,
    });

    const res = await handleGetPlacementGuarantee(placementId, financeAdmin, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      placement_id: string;
      guarantee_expiry_date: string | null;
      guarantee_state: string | null;
      guarantee_period_id: string | null;
    };

    expect(body.placement_id).toBe(placementId);
    // guarantee_expiry_date from placement: 2025-03-01 + 90 = 2025-05-30
    expect(body.guarantee_expiry_date).toBe('2025-05-30');
    expect(body.guarantee_state).toBe('Active');
    expect(body.guarantee_period_id).toBe(period.id);
  });

  test('returns null guarantee_state when no guarantee period exists', async () => {
    const { id: placementId } = await createTestPlacement('2025-04-01', 60);

    const res = await handleGetPlacementGuarantee(placementId, financeAdmin, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      placement_id: string;
      guarantee_state: string | null;
    };

    expect(body.placement_id).toBe(placementId);
    expect(body.guarantee_state).toBeNull();
  });

  test('returns 404 when placement does not exist', async () => {
    const nonExistentId = crypto.randomUUID();
    const res = await handleGetPlacementGuarantee(nonExistentId, financeAdmin, testSql);
    expect(res.status).toBe(404);
  });

  test('returns 404 when placement belongs to different org', async () => {
    const { id: placementId } = await createTestPlacement('2025-04-01', 60);

    const otherOrgClaims: SessionClaims = {
      ...financeAdmin,
      org_id: crypto.randomUUID(),
    };
    const res = await handleGetPlacementGuarantee(placementId, otherOrgClaims, testSql);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// listActiveExpiredGuaranteePeriods — cron scan integration test
// ---------------------------------------------------------------------------

describe('listActiveExpiredGuaranteePeriods', () => {
  test('returns only periods with status=Active AND guarantee_ends < cutoff', async () => {
    const { id: p1 } = await createTestPlacement('2020-01-01', 7);
    const { id: p2 } = await createTestPlacement('2025-12-01', 365);

    const riskBuf = Buffer.alloc(1);

    // Period 1: expired (guarantee_ends = 2020-01-08)
    const expiredPeriod = await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId: p1,
      guaranteeEnds: '2020-01-08',
      riskAmountBuffer: riskBuf,
    });

    // Period 2: not yet expired (guarantee_ends = 2026-12-01)
    await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId: p2,
      guaranteeEnds: '2026-12-01',
      riskAmountBuffer: riskBuf,
    });

    const today = new Date().toISOString().slice(0, 10);
    const expired = await listActiveExpiredGuaranteePeriods(testSql, today);

    const expiredIds = expired.map((p) => p.id);
    expect(expiredIds).toContain(expiredPeriod.id);
    // Period 2 should not appear
    const p2Ids = expired.filter((p) => p.placementId === p2);
    expect(p2Ids.length).toBe(0);
  });
});

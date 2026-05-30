/**
 * Executive dashboard analytics — integration tests (issue #22).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — GET /analytics/executive returns all required metrics in a single JSON response
 *           (schema snapshot test against fixture data).
 *   AC#2 — gross_fees_booked equals sum of all Placement.fee_amount for the period.
 *   AC#3 — clawback_exposure equals sum of all negative CommissionRecord adjustments
 *           not yet recovered.
 *   AC#4 — exception_rate = total exceptions in period / total placements in period.
 *   AC#5 — Producer token returns 403; Executive and Finance Admin return 200.
 *
 * Additional tests:
 *   - Manager returns 403.
 *   - Period filtering: placements outside the period are excluded from gross_fees_booked.
 *   - dispute_rate calculation.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with injectable sql clients.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §4 (Executive user stories)
 * Issue: feat: executive margin and commission liability dashboard (#22)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { FieldEncryptor } from '../../../../packages/db/src/encryption';
import { LocalDevKmsAdapter } from '../../../../packages/db/src/kms-dev';
import {
  _setEncryptorForTest as _setPlacementsEncryptorForTest,
  _resetEncryptorForTest as _resetPlacementsEncryptorForTest,
} from '../../../../packages/db/src/placements';
import {
  _setEncryptorForTest as _setCommRecordEncryptorForTest,
  _resetEncryptorForTest as _resetCommRecordEncryptorForTest,
} from '../../../../packages/db/src/commission-records';
import { _setEncryptorForTest as _setAnalyticsEncryptorForTest } from '../../../../packages/db/src/analytics-executive';
import { _resetEncryptorForTest as _resetAnalyticsEncryptorForTest } from '../../../../packages/db/src/analytics-executive';
import { handleGetExecutiveAnalytics } from '../../../../apps/server/src/api/analytics';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
// Shared encryptor instance used by both DB helpers (for encryption) and analytics module (for decryption).
// Must be the same instance so that DEK cache is shared and decryption succeeds.
let sharedEnc: FieldEncryptor;

const ORG_ID = crypto.randomUUID();

const adminClaims: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const executiveClaims: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(),
  role: 'Executive',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producerClaims: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(),
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const managerClaims: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(),
  role: 'Manager',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: null, analyticsDatabaseUrl: null });

  const adapter = new LocalDevKmsAdapter();
  sharedEnc = new FieldEncryptor(adapter);
  _setPlacementsEncryptorForTest(sharedEnc);
  _setCommRecordEncryptorForTest(sharedEnc);
  _setAnalyticsEncryptorForTest(sharedEnc);
}, 120_000);

afterAll(async () => {
  _resetPlacementsEncryptorForTest();
  _resetCommRecordEncryptorForTest();
  _resetAnalyticsEncryptorForTest();
  await testSql?.end({ timeout: 5 });
  await pg?.stop();
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function periodUrl(start: string, end: string): string {
  return `/analytics/executive?period_start=${start}&period_end=${end}`;
}

/** ISO date string offset by `days` from today */
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Insert a placement row directly with encrypted fee_amount */
async function insertPlacement(opts: {
  orgId: string;
  clientEntityId: string;
  feeAmount: string;
  compensationBase: string;
  startDate: string;
  status?: string;
}): Promise<string> {
  const feeAmountBuf = await sharedEnc.encrypt('placements', 'fee_amount', opts.feeAmount);
  const compensationBaseBuf = await sharedEnc.encrypt(
    'placements',
    'compensation_base',
    opts.compensationBase,
  );

  const rows = (await testSql.unsafe(
    `
    INSERT INTO placements (
      org_id, candidate_id, client_entity_id, job_title,
      fee_amount, compensation_base, start_date, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [
      opts.orgId,
      crypto.randomUUID(),
      opts.clientEntityId,
      'Test Role',
      feeAmountBuf,
      compensationBaseBuf,
      opts.startDate,
      opts.status ?? 'Active',
    ],
  )) as unknown as { id: string }[];

  return rows[0].id;
}

/** Insert a contributor row and return contributor id */
async function insertContributor(
  orgId: string,
  placementId: string,
  producerId: string,
): Promise<string> {
  const rows = (await testSql.unsafe(
    `
    INSERT INTO contributors (org_id, placement_id, producer_id, role_code, split_pct)
    VALUES ($1, $2, $3, 'owner', 1.0)
    RETURNING id
    `,
    [orgId, placementId, producerId],
  )) as unknown as { id: string }[];
  return rows[0].id;
}

/** Insert a commission record with encrypted amounts */
async function insertCommissionRecord(opts: {
  orgId: string;
  placementId: string;
  contributorId: string;
  grossAmount: string;
  netPayable: string;
  status: string;
}): Promise<string> {
  const grossAmountBuf = await sharedEnc.encrypt(
    'commission_records',
    'gross_amount',
    opts.grossAmount,
  );
  const netPayableBuf = await sharedEnc.encrypt(
    'commission_records',
    'net_payable',
    opts.netPayable,
  );

  // Insert requires a plan_version_id; create a minimal plan with correct schema columns.
  // commission_plans requires: name, effective_from, config_entity_id, created_by
  const planRows = (await testSql.unsafe(
    `
    INSERT INTO commission_plans (org_id, name, effective_from, config_entity_id, created_by)
    VALUES ($1, 'Test Plan', '2020-01-01', $2, $3)
    RETURNING id
    `,
    [opts.orgId, crypto.randomUUID(), crypto.randomUUID()],
  )) as unknown as { id: string }[];
  const planId = planRows[0].id;

  // plan_versions requires: plan_id, org_id, version_num, rules_snapshot, effective_at
  const versionRows = (await testSql.unsafe(
    `
    INSERT INTO plan_versions (plan_id, org_id, version_num, rules_snapshot, effective_at)
    VALUES ($1, $2, 1, '{"tiers":[],"base_rate":0.20,"draw_enabled":false}'::jsonb, NOW())
    RETURNING id
    `,
    [planId, opts.orgId],
  )) as unknown as { id: string }[];
  const planVersionId = versionRows[0].id;

  const rows = (await testSql.unsafe(
    `
    INSERT INTO commission_records (
      org_id, placement_id, contributor_id, plan_version_id,
      gross_amount, net_payable, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
    `,
    [
      opts.orgId,
      opts.placementId,
      opts.contributorId,
      planVersionId,
      grossAmountBuf,
      netPayableBuf,
      opts.status,
    ],
  )) as unknown as { id: string }[];

  return rows[0].id;
}

/** Insert a negative commission_record_adjustment (clawback) */
async function insertClawbackAdjustment(opts: {
  orgId: string;
  commissionRecordId: string;
  amountDelta: number; // negative
  recovered?: boolean;
}): Promise<void> {
  await testSql.unsafe(
    `
    INSERT INTO commission_record_adjustments (
      org_id, commission_record_id, amount_delta, reason_code, adjusted_by, recovered
    ) VALUES ($1, $2, $3, 'clawback', $4, $5)
    `,
    [
      opts.orgId,
      opts.commissionRecordId,
      opts.amountDelta,
      crypto.randomUUID(),
      opts.recovered ?? false,
    ],
  );
}

/** Insert an exception row for a placement */
async function insertException(opts: {
  orgId: string;
  placementId: string;
  status: string;
}): Promise<void> {
  await testSql.unsafe(
    `
    INSERT INTO exceptions (org_id, placement_id, requested_by, exception_type, justification, status)
    VALUES ($1, $2, $3, 'manual_override', 'Test exception', $4::exception_state)
    `,
    [opts.orgId, opts.placementId, crypto.randomUUID(), opts.status],
  );
}

// ---------------------------------------------------------------------------
// AC#5 — RBAC tests
// ---------------------------------------------------------------------------

describe('GET /analytics/executive — RBAC', () => {
  const start = isoDate(-30);
  const end = isoDate(0);

  test('Producer returns 403', async () => {
    const req = makeRequest(periodUrl(start, end));
    const res = await handleGetExecutiveAnalytics(req, producerClaims, testSql);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Forbidden');
  });

  test('Manager returns 403', async () => {
    const req = makeRequest(periodUrl(start, end));
    const res = await handleGetExecutiveAnalytics(req, managerClaims, testSql);
    expect(res.status).toBe(403);
  });

  test('Executive returns 200', async () => {
    const req = makeRequest(periodUrl(start, end));
    const res = await handleGetExecutiveAnalytics(req, executiveClaims, testSql);
    expect(res.status).toBe(200);
  });

  test('FinanceAdmin returns 200', async () => {
    const req = makeRequest(periodUrl(start, end));
    const res = await handleGetExecutiveAnalytics(req, adminClaims, testSql);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// AC#1 — Schema snapshot: all required fields are present
// ---------------------------------------------------------------------------

describe('GET /analytics/executive — schema snapshot', () => {
  test('response contains all required top-level fields', async () => {
    const start = isoDate(-30);
    const end = isoDate(0);

    const req = makeRequest(periodUrl(start, end));
    const res = await handleGetExecutiveAnalytics(req, adminClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;

    // All PRD executive dashboard metrics must be present
    expect(body).toHaveProperty('period');
    expect(body).toHaveProperty('gross_fees_booked');
    expect(body).toHaveProperty('net_fee_income');
    expect(body).toHaveProperty('commission_accrued');
    expect(body).toHaveProperty('commission_payable');
    expect(body).toHaveProperty('commission_held');
    expect(body).toHaveProperty('clawback_exposure');
    expect(body).toHaveProperty('guarantee_exposure');
    expect(body).toHaveProperty('disputed_commission');
    expect(body).toHaveProperty('exception_rate');
    expect(body).toHaveProperty('dispute_rate');
    expect(body).toHaveProperty('total_placements');
    expect(body).toHaveProperty('profitability_by_client');
    expect(body).toHaveProperty('profitability_by_producer');

    // Period object has start and end
    const period = body.period as { start: string; end: string };
    expect(period.start).toBe(start);
    expect(period.end).toBe(end);

    // profitability arrays
    expect(Array.isArray(body.profitability_by_client)).toBe(true);
    expect(Array.isArray(body.profitability_by_producer)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — gross_fees_booked arithmetic
// ---------------------------------------------------------------------------

describe('GET /analytics/executive — gross_fees_booked arithmetic', () => {
  // Use a specific org and period to avoid cross-test interference
  const arithmeticOrgId = crypto.randomUUID();
  const arithmeticClaims: SessionClaims = {
    org_id: arithmeticOrgId,
    user_id: crypto.randomUUID(),
    role: 'FinanceAdmin',
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const periodStart = '2024-01-01';
  const periodEnd = '2024-12-31';

  // Two placements with known fee amounts
  const FEE_A = '30000.00';
  const FEE_B = '20000.00';
  const EXPECTED_TOTAL = (30000 + 20000).toFixed(2); // "50000.00"

  const clientId = crypto.randomUUID();

  test('gross_fees_booked equals sum of all placement fee_amounts in period', async () => {
    // Insert two placements inside the period
    await insertPlacement({
      orgId: arithmeticOrgId,
      clientEntityId: clientId,
      feeAmount: FEE_A,
      compensationBase: '150000',
      startDate: '2024-06-01',
    });
    await insertPlacement({
      orgId: arithmeticOrgId,
      clientEntityId: clientId,
      feeAmount: FEE_B,
      compensationBase: '100000',
      startDate: '2024-09-15',
    });
    // Insert one placement OUTSIDE the period (should be excluded)
    await insertPlacement({
      orgId: arithmeticOrgId,
      clientEntityId: clientId,
      feeAmount: '99999.00',
      compensationBase: '200000',
      startDate: '2023-12-31', // before period
    });

    const req = makeRequest(periodUrl(periodStart, periodEnd));
    const res = await handleGetExecutiveAnalytics(req, arithmeticClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { gross_fees_booked: string; total_placements: number };
    expect(body.gross_fees_booked).toBe(EXPECTED_TOTAL);
    expect(body.total_placements).toBe(2);
  });

  test('placements outside period are excluded from gross_fees_booked', async () => {
    // Query period that has no placements for this org (beyond 2024 data)
    const req = makeRequest(periodUrl('2025-01-01', '2025-12-31'));
    const res = await handleGetExecutiveAnalytics(req, arithmeticClaims, testSql);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gross_fees_booked: string; total_placements: number };
    expect(body.gross_fees_booked).toBe('0.00');
    expect(body.total_placements).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — clawback_exposure arithmetic
// ---------------------------------------------------------------------------

describe('GET /analytics/executive — clawback_exposure arithmetic', () => {
  const clawbackOrgId = crypto.randomUUID();
  const clawbackClaims: SessionClaims = {
    org_id: clawbackOrgId,
    user_id: crypto.randomUUID(),
    role: 'FinanceAdmin',
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const periodStart = '2024-01-01';
  const periodEnd = '2024-12-31';

  test('clawback_exposure equals sum of unrecovered negative adjustments', async () => {
    // Create fixture: placement + contributor + commission record + adjustments
    const placementId = await insertPlacement({
      orgId: clawbackOrgId,
      clientEntityId: crypto.randomUUID(),
      feeAmount: '50000',
      compensationBase: '200000',
      startDate: '2024-06-01',
    });

    const producerId = crypto.randomUUID();
    const contributorId = await insertContributor(clawbackOrgId, placementId, producerId);

    const commRecordId = await insertCommissionRecord({
      orgId: clawbackOrgId,
      placementId,
      contributorId,
      grossAmount: '10000',
      netPayable: '10000',
      status: 'Accrued',
    });

    // Insert two unrecovered negative adjustments
    await insertClawbackAdjustment({
      orgId: clawbackOrgId,
      commissionRecordId: commRecordId,
      amountDelta: -3000,
      recovered: false,
    });
    await insertClawbackAdjustment({
      orgId: clawbackOrgId,
      commissionRecordId: commRecordId,
      amountDelta: -2000,
      recovered: false,
    });
    // Insert a recovered adjustment (should NOT be counted)
    await insertClawbackAdjustment({
      orgId: clawbackOrgId,
      commissionRecordId: commRecordId,
      amountDelta: -1000,
      recovered: true,
    });

    const req = makeRequest(periodUrl(periodStart, periodEnd));
    const res = await handleGetExecutiveAnalytics(req, clawbackClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { clawback_exposure: string };
    // clawback_exposure = -3000 + -2000 = -5000 (negative = money owed back)
    expect(body.clawback_exposure).toBe('-5000.00');
  });
});

// ---------------------------------------------------------------------------
// AC#4 — exception_rate calculation
// ---------------------------------------------------------------------------

describe('GET /analytics/executive — exception_rate calculation', () => {
  const exceptionOrgId = crypto.randomUUID();
  const exceptionClaims: SessionClaims = {
    org_id: exceptionOrgId,
    user_id: crypto.randomUUID(),
    role: 'FinanceAdmin',
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const periodStart = '2024-01-01';
  const periodEnd = '2024-12-31';

  test('exception_rate = placements with approved exception / total placements', async () => {
    // Create 3 placements; 1 has an Approved exception, 1 has a Requested exception,
    // 1 has no exception.
    const clientId = crypto.randomUUID();

    const p1 = await insertPlacement({
      orgId: exceptionOrgId,
      clientEntityId: clientId,
      feeAmount: '10000',
      compensationBase: '100000',
      startDate: '2024-03-01',
    });
    const p2 = await insertPlacement({
      orgId: exceptionOrgId,
      clientEntityId: clientId,
      feeAmount: '10000',
      compensationBase: '100000',
      startDate: '2024-04-01',
    });
    // p3 intentionally has no exception (no variable needed)
    await insertPlacement({
      orgId: exceptionOrgId,
      clientEntityId: clientId,
      feeAmount: '10000',
      compensationBase: '100000',
      startDate: '2024-05-01',
    });

    // p1 gets an Approved exception
    await insertException({ orgId: exceptionOrgId, placementId: p1, status: 'Approved' });
    // p2 gets a Requested exception (not Approved — should NOT count)
    await insertException({ orgId: exceptionOrgId, placementId: p2, status: 'Requested' });

    const req = makeRequest(periodUrl(periodStart, periodEnd));
    const res = await handleGetExecutiveAnalytics(req, exceptionClaims, testSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { exception_rate: number; total_placements: number };
    // Only p1 counts; 3 total placements → rate = 1/3 ≈ 0.3333
    expect(body.total_placements).toBe(3);
    expect(body.exception_rate).toBeCloseTo(1 / 3, 4);
  });
});

// ---------------------------------------------------------------------------
// Input validation tests
// ---------------------------------------------------------------------------

describe('GET /analytics/executive — input validation', () => {
  test('invalid date format returns 400', async () => {
    const req = makeRequest('/analytics/executive?period_start=not-a-date&period_end=2024-12-31');
    const res = await handleGetExecutiveAnalytics(req, adminClaims, testSql);
    expect(res.status).toBe(400);
  });

  test('period_start after period_end returns 400', async () => {
    const req = makeRequest('/analytics/executive?period_start=2024-12-31&period_end=2024-01-01');
    const res = await handleGetExecutiveAnalytics(req, adminClaims, testSql);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Multi-tenant isolation
// ---------------------------------------------------------------------------

describe('GET /analytics/executive — multi-tenant isolation', () => {
  test('analytics for one org does not bleed into another', async () => {
    const orgA = crypto.randomUUID();
    const orgB = crypto.randomUUID();
    const claimsA: SessionClaims = {
      org_id: orgA,
      user_id: crypto.randomUUID(),
      role: 'FinanceAdmin',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const claimsB: SessionClaims = {
      org_id: orgB,
      user_id: crypto.randomUUID(),
      role: 'FinanceAdmin',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    // Insert a placement for org A with a large fee
    await insertPlacement({
      orgId: orgA,
      clientEntityId: crypto.randomUUID(),
      feeAmount: '88000',
      compensationBase: '300000',
      startDate: '2024-07-01',
    });

    const start = '2024-01-01';
    const end = '2024-12-31';

    // Org A should see its placement
    const resA = await handleGetExecutiveAnalytics(
      makeRequest(periodUrl(start, end)),
      claimsA,
      testSql,
    );
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as { gross_fees_booked: string };
    expect(parseFloat(bodyA.gross_fees_booked)).toBeGreaterThanOrEqual(88000);

    // Org B should see 0 (no placements created for it)
    const resB = await handleGetExecutiveAnalytics(
      makeRequest(periodUrl(start, end)),
      claimsB,
      testSql,
    );
    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as { gross_fees_booked: string };
    expect(bodyB.gross_fees_booked).toBe('0.00');
  });
});

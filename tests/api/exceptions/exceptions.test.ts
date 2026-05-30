/**
 * Exception request and approval workflow — integration tests (issue #14).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — POST /exceptions with valid fields returns 201 with state=Requested.
 *   AC#2 — POST /exceptions/:id/approve by Finance Admin transitions to Approved
 *            and posts a ledger adjustment (CommissionRecord.net_payable increases).
 *   AC#3 — POST /exceptions/:id/approve by Producer returns 403 (RBAC).
 *   AC#4 — POST /exceptions/:id/reject records the rejection reason.
 *   AC#5 — Each exception state transition creates an AuditLogEntry.
 *   AC#6 — GET /exceptions?state=Requested returns only open requests.
 *
 * Additional:
 *   - Ledger adjustment test: approve exception with impact_amount=500, assert
 *     CommissionRecord.net_payable increases by 500 and AuditLogEntry is created.
 *   - Attachment test: POST with multipart/form-data attachment returns 201 and
 *     GET /exceptions/:id includes attachment metadata (attachment_url).
 *   - Multi-tenant isolation.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.4, §7.5
 * Issue: feat: exception request and approval workflow (#14)
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
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
import { handleAddContributor } from '../../../apps/server/src/api/contributors';
import {
  handleCreatePlan,
  handleActivatePlanVersion,
  handleCreatePlanAssignment,
} from '../../../apps/server/src/api/plans';
import { handleCalculateCommission } from '../../../apps/server/src/api/calculate';
import {
  handleCreateException,
  handleListExceptions,
  handleGetException,
  handleApproveException,
  handleRejectException,
} from '../../../apps/server/src/api/exceptions';
import { getCommissionRecord } from '../../../packages/db/src/commission-records';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let auditSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const USER_A_ID = crypto.randomUUID();
const ORG_B_ID = crypto.randomUUID();
const USER_B_ID = crypto.randomUUID();

const adminClaimsA: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: USER_A_ID,
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producerClaimsA: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: crypto.randomUUID(),
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const adminClaimsB: SessionClaims = {
  org_id: ORG_B_ID,
  user_id: USER_B_ID,
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  auditSql = postgres(pg.url, { max: 2 });

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

/** Create a placement with all commission-required fields. */
async function createPlacement(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Account Executive',
      compensation_base: '130000',
      fee_amount: '26000',
      start_date: '2025-04-01',
      guarantee_days: null,
    },
  });
  const res = await handleCreatePlacement(req, claims, sql);
  expect(res.status).toBe(201);
  const body = (await jsonBody(res)) as { id: string };
  return body.id;
}

/** Set a placement to Active status via direct SQL */
async function activatePlacement(
  sql: ReturnType<typeof postgres>,
  placementId: string,
): Promise<void> {
  await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
}

/** Create an active plan and assign to a producer */
async function createActivePlan(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  producerId: string,
): Promise<string> {
  const createReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: `Exception Test Plan ${Date.now()}-${Math.random()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.25 },
    },
  });
  const createRes = await handleCreatePlan(createReq, claims, sql);
  expect(createRes.status).toBe(201);
  const createBody = (await jsonBody(createRes)) as {
    plan: { id: string };
    version: { id: string };
  };
  const planId = createBody.plan.id;
  const versionId = createBody.version.id;

  const activateRes = await handleActivatePlanVersion(planId, versionId, claims, sql);
  expect(activateRes.status).toBe(200);

  const assignReq = makeRequest({
    path: `/plans/${planId}/assignments`,
    method: 'POST',
    body: { producer_id: producerId, plan_version_id: versionId },
  });
  const assignRes = await handleCreatePlanAssignment(planId, assignReq, claims, sql);
  expect(assignRes.status).toBe(201);

  return versionId;
}

/** Create a placement with a contributor and an active plan; returns { placementId, commissionRecordIds } */
async function setupPlacementWithCommissionRecords(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
): Promise<{ placementId: string; commissionRecordIds: string[] }> {
  const placementId = await createPlacement(sql, claims);
  await activatePlacement(sql, placementId);

  const producerId = crypto.randomUUID();
  const addReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 1.0 },
  });
  const addRes = await handleAddContributor(placementId, addReq, claims, sql);
  expect(addRes.status).toBe(201);

  await createActivePlan(sql, claims, producerId);

  const calcReq = makeRequest({
    path: `/placements/${placementId}/calculate`,
    method: 'POST',
  });
  const calcRes = await handleCalculateCommission(placementId, calcReq, claims, sql);
  expect(calcRes.status).toBe(200);
  const calcBody = (await jsonBody(calcRes)) as { commission_records: Array<{ id: string }> };
  const commissionRecordIds = calcBody.commission_records.map((r) => r.id);

  return { placementId, commissionRecordIds };
}

// ---------------------------------------------------------------------------
// AC#1 — POST /exceptions with valid fields returns 201 with state=Requested
// ---------------------------------------------------------------------------

describe('POST /exceptions — create exception request (AC#1)', () => {
  test('returns 201 with state=Requested for valid JSON body', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);

    const req = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        exception_type: 'fee_discount',
        reason: 'Client negotiated a 10% fee discount at contract stage.',
        impact_amount: '2600',
      },
    });

    const res = await handleCreateException(req, adminClaimsA, testSql, auditSql);
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as {
      id: string;
      status: string;
      exception_type: string;
      justification: string;
      impact_amount: string;
    };

    expect(body.id).toBeTruthy();
    expect(body.status).toBe('Requested');
    expect(body.exception_type).toBe('fee_discount');
    expect(body.justification).toBe('Client negotiated a 10% fee discount at contract stage.');
    expect(parseFloat(body.impact_amount)).toBeCloseTo(2600, 0);
  });

  test('returns 422 when placement_id is missing', async () => {
    const req = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: { exception_type: 'fee_discount', reason: 'Reason text' },
    });
    const res = await handleCreateException(req, adminClaimsA, testSql, auditSql);
    expect(res.status).toBe(422);
    const body = (await jsonBody(res)) as { fields: Record<string, string> };
    expect(body.fields['placement_id']).toBeTruthy();
  });

  test('returns 422 when exception_type is invalid', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);
    const req = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        exception_type: 'invalid_type',
        reason: 'Some reason',
      },
    });
    const res = await handleCreateException(req, adminClaimsA, testSql, auditSql);
    expect(res.status).toBe(422);
    const body = (await jsonBody(res)) as { fields: Record<string, string> };
    expect(body.fields['exception_type']).toMatch(/must be one of/i);
  });

  test('all exception_type values are accepted', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);
    const types = [
      'custom_split',
      'fee_discount',
      'accelerated_payout',
      'manual_override',
      'draw_forgiveness',
      'clawback_waiver',
      'special_partner_agreement',
      'post_termination_payout',
    ];
    for (const exceptionType of types) {
      const req = makeRequest({
        path: '/exceptions',
        method: 'POST',
        body: { placement_id: placementId, exception_type: exceptionType, reason: 'Test reason' },
      });
      const res = await handleCreateException(req, adminClaimsA, testSql, auditSql);
      expect(res.status, `expected 201 for type: ${exceptionType}`).toBe(201);
    }
  });

  test('Producer can submit an exception request', async () => {
    const placementId = await createPlacement(testSql, producerClaimsA);
    const req = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        exception_type: 'accelerated_payout',
        reason: 'Producer requesting early payout due to deal complexity.',
      },
    });
    const res = await handleCreateException(req, producerClaimsA, testSql, auditSql);
    expect(res.status).toBe(201);
    const body = (await jsonBody(res)) as { status: string };
    expect(body.status).toBe('Requested');
  });
});

// ---------------------------------------------------------------------------
// AC#2 — POST /exceptions/:id/approve transitions to Approved + ledger adjustment
// ---------------------------------------------------------------------------

describe('POST /exceptions/:id/approve — approval and ledger adjustment (AC#2)', () => {
  test('transitions state to Approved and increments net_payable by impact_amount', async () => {
    const { placementId, commissionRecordIds } = await setupPlacementWithCommissionRecords(
      testSql,
      adminClaimsA,
    );
    const commissionRecordId = commissionRecordIds[0];

    // Read initial net_payable
    const before = await getCommissionRecord(testSql, ORG_A_ID, commissionRecordId);
    expect(before).not.toBeNull();
    const netPayableBefore = parseFloat(before!.netPayable);

    // Create exception with impact_amount linked to the commission record
    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        commission_record_id: commissionRecordId,
        exception_type: 'manual_override',
        reason: 'Approved manual override per Finance Director instruction.',
        impact_amount: '500',
      },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    expect(createRes.status).toBe(201);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    // Approve
    const approveRes = await handleApproveException(exceptionId, adminClaimsA, testSql, auditSql);
    expect(approveRes.status).toBe(200);

    const approveBody = (await jsonBody(approveRes)) as {
      status: string;
      reviewed_by: string;
      ledger_adjusted: boolean;
    };
    expect(approveBody.status).toBe('Approved');
    expect(approveBody.reviewed_by).toBe(USER_A_ID);
    expect(approveBody.ledger_adjusted).toBe(true);

    // Assert net_payable increased by 500
    const after = await getCommissionRecord(testSql, ORG_A_ID, commissionRecordId);
    expect(after).not.toBeNull();
    const netPayableAfter = parseFloat(after!.netPayable);
    expect(netPayableAfter).toBeCloseTo(netPayableBefore + 500, 1);
  });

  test('returns 409 when exception is already Approved', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);

    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        exception_type: 'fee_discount',
        reason: 'Approved test.',
        impact_amount: '100',
      },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    expect(createRes.status).toBe(201);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    // First approval
    const firstRes = await handleApproveException(exceptionId, adminClaimsA, testSql, auditSql);
    expect(firstRes.status).toBe(200);

    // Second approval — should 409
    const secondRes = await handleApproveException(exceptionId, adminClaimsA, testSql, auditSql);
    expect(secondRes.status).toBe(409);
  });

  test('returns 404 for unknown exception', async () => {
    const res = await handleApproveException(crypto.randomUUID(), adminClaimsA, testSql, auditSql);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — POST /exceptions/:id/approve by Producer returns 403 (RBAC)
// ---------------------------------------------------------------------------

describe('POST /exceptions/:id/approve — RBAC (AC#3)', () => {
  test('returns 403 when called by a Producer', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);

    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        exception_type: 'draw_forgiveness',
        reason: 'Producer-submitted exception.',
      },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    expect(createRes.status).toBe(201);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    // Producer attempts to approve — must get 403
    const approveRes = await handleApproveException(
      exceptionId,
      producerClaimsA,
      testSql,
      auditSql,
    );
    expect(approveRes.status).toBe(403);
    const body = (await jsonBody(approveRes)) as { error: string };
    expect(body.error).toMatch(/Finance Admin/i);
  });

  test('returns 403 when reject called by a Producer', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);

    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        exception_type: 'fee_discount',
        reason: 'Test RBAC for reject.',
      },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    const rejectReq = makeRequest({
      path: `/exceptions/${exceptionId}/reject`,
      method: 'POST',
      body: { reason: 'Not approved.' },
    });
    const rejectRes = await handleRejectException(
      exceptionId,
      rejectReq,
      producerClaimsA,
      testSql,
      auditSql,
    );
    expect(rejectRes.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — POST /exceptions/:id/reject records the rejection reason
// ---------------------------------------------------------------------------

describe('POST /exceptions/:id/reject — rejection with reason (AC#4)', () => {
  test('transitions to Rejected and records rejection reason', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);

    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        exception_type: 'clawback_waiver',
        reason: 'Requesting waiver of clawback on terminated placement.',
      },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    expect(createRes.status).toBe(201);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    const rejectReq = makeRequest({
      path: `/exceptions/${exceptionId}/reject`,
      method: 'POST',
      body: { reason: 'Clawback policy does not allow waiver at this stage.' },
    });
    const rejectRes = await handleRejectException(
      exceptionId,
      rejectReq,
      adminClaimsA,
      testSql,
      auditSql,
    );
    expect(rejectRes.status).toBe(200);

    const body = (await jsonBody(rejectRes)) as {
      status: string;
      rejection_reason: string;
      reviewed_by: string;
    };
    expect(body.status).toBe('Rejected');
    expect(body.rejection_reason).toBe('Clawback policy does not allow waiver at this stage.');
    expect(body.reviewed_by).toBe(USER_A_ID);
  });

  test('returns 422 when rejection reason is missing', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);
    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: { placement_id: placementId, exception_type: 'fee_discount', reason: 'Some reason' },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    const rejectReq = makeRequest({
      path: `/exceptions/${exceptionId}/reject`,
      method: 'POST',
      body: {},
    });
    const rejectRes = await handleRejectException(
      exceptionId,
      rejectReq,
      adminClaimsA,
      testSql,
      auditSql,
    );
    expect(rejectRes.status).toBe(422);
  });

  test('returns 409 when exception is already Rejected', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);
    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: { placement_id: placementId, exception_type: 'fee_discount', reason: 'Test' },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    const rejectReq = makeRequest({
      path: `/exceptions/${exceptionId}/reject`,
      method: 'POST',
      body: { reason: 'Initial rejection.' },
    });
    await handleRejectException(exceptionId, rejectReq, adminClaimsA, testSql, auditSql);

    // Second rejection — 409
    const rejectReq2 = makeRequest({
      path: `/exceptions/${exceptionId}/reject`,
      method: 'POST',
      body: { reason: 'Second rejection attempt.' },
    });
    const res = await handleRejectException(
      exceptionId,
      rejectReq2,
      adminClaimsA,
      testSql,
      auditSql,
    );
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Each state transition creates an AuditLogEntry
// ---------------------------------------------------------------------------

describe('AuditLogEntry — state transition audit trail (AC#5)', () => {
  test('creation, approval, and rejection each produce an AuditLogEntry', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);

    // Create exception → 1 audit entry
    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        exception_type: 'post_termination_payout',
        reason: 'Post-termination payout request for producer.',
      },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    expect(createRes.status).toBe(201);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    // Check audit entry for creation
    const afterCreate = await auditSql.unsafe(
      `SELECT action FROM audit_log_entries WHERE entity_type = 'exception' AND entity_id = $1 ORDER BY created_at ASC`,
      [exceptionId],
    );
    expect(afterCreate.length).toBeGreaterThanOrEqual(1);
    const actions = (afterCreate as unknown as Array<{ action: string }>).map((r) => r.action);
    expect(actions).toContain('exception.requested');

    // Approve → 1 more audit entry
    const approveRes = await handleApproveException(exceptionId, adminClaimsA, testSql, auditSql);
    expect(approveRes.status).toBe(200);

    const afterApprove = await auditSql.unsafe(
      `SELECT action FROM audit_log_entries WHERE entity_type = 'exception' AND entity_id = $1 ORDER BY created_at ASC`,
      [exceptionId],
    );
    const afterApproveActions = (afterApprove as unknown as Array<{ action: string }>).map(
      (r) => r.action,
    );
    expect(afterApproveActions).toContain('exception.approved');
  });

  test('rejection creates an AuditLogEntry with exception.rejected action', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);
    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: {
        placement_id: placementId,
        exception_type: 'custom_split',
        reason: 'Requesting custom split for this placement.',
      },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    const rejectReq = makeRequest({
      path: `/exceptions/${exceptionId}/reject`,
      method: 'POST',
      body: { reason: 'Custom split not within policy.' },
    });
    await handleRejectException(exceptionId, rejectReq, adminClaimsA, testSql, auditSql);

    const entries = await auditSql.unsafe(
      `SELECT action FROM audit_log_entries WHERE entity_type = 'exception' AND entity_id = $1`,
      [exceptionId],
    );
    const actions = (entries as unknown as Array<{ action: string }>).map((r) => r.action);
    expect(actions).toContain('exception.rejected');
  });
});

// ---------------------------------------------------------------------------
// AC#6 — GET /exceptions?state=Requested returns only open requests
// ---------------------------------------------------------------------------

describe('GET /exceptions — filter by state (AC#6)', () => {
  test('?state=Requested returns only Requested exceptions', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);

    // Create two Requested and one Rejected
    const createOne = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: { placement_id: placementId, exception_type: 'fee_discount', reason: 'Reason 1' },
    });
    const resOne = await handleCreateException(createOne, adminClaimsA, testSql, auditSql);
    expect(resOne.status).toBe(201);
    const { id: id1 } = (await jsonBody(resOne)) as { id: string };

    const createTwo = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: { placement_id: placementId, exception_type: 'accelerated_payout', reason: 'Reason 2' },
    });
    const resTwo = await handleCreateException(createTwo, adminClaimsA, testSql, auditSql);
    expect(resTwo.status).toBe(201);
    const { id: id2 } = (await jsonBody(resTwo)) as { id: string };

    // Reject id2
    const rejectReq = makeRequest({
      path: `/exceptions/${id2}/reject`,
      method: 'POST',
      body: { reason: 'Not approved.' },
    });
    await handleRejectException(id2, rejectReq, adminClaimsA, testSql, auditSql);

    // List with ?state=Requested
    const listReq = new Request(`http://localhost/exceptions?state=Requested`, { method: 'GET' });
    const listRes = await handleListExceptions(listReq, adminClaimsA, testSql);
    expect(listRes.status).toBe(200);

    const listBody = (await jsonBody(listRes)) as {
      exceptions: Array<{ id: string; status: string }>;
    };

    const ids = listBody.exceptions.map((e) => e.id);
    expect(ids).toContain(id1);
    expect(ids).not.toContain(id2);

    for (const e of listBody.exceptions) {
      expect(e.status).toBe('Requested');
    }
  });

  test('returns all exceptions when no state filter provided', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);

    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: { placement_id: placementId, exception_type: 'manual_override', reason: 'Any reason' },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    expect(createRes.status).toBe(201);

    const listReq = new Request(`http://localhost/exceptions`, { method: 'GET' });
    const listRes = await handleListExceptions(listReq, adminClaimsA, testSql);
    expect(listRes.status).toBe(200);

    const listBody = (await jsonBody(listRes)) as { exceptions: Array<{ id: string }> };
    expect(Array.isArray(listBody.exceptions)).toBe(true);
    expect(listBody.exceptions.length).toBeGreaterThan(0);
  });

  test('multi-tenant isolation: Org B cannot see Org A exceptions', async () => {
    const placementAId = await createPlacement(testSql, adminClaimsA);
    const createReq = makeRequest({
      path: '/exceptions',
      method: 'POST',
      body: { placement_id: placementAId, exception_type: 'fee_discount', reason: 'Org A reason' },
    });
    const createRes = await handleCreateException(createReq, adminClaimsA, testSql, auditSql);
    expect(createRes.status).toBe(201);
    const { id: exceptionId } = (await jsonBody(createRes)) as { id: string };

    // Org B list should not include Org A's exception
    const listReq = new Request(`http://localhost/exceptions`, { method: 'GET' });
    const listRes = await handleListExceptions(listReq, adminClaimsB, testSql);
    const listBody = (await jsonBody(listRes)) as { exceptions: Array<{ id: string }> };
    const ids = listBody.exceptions.map((e) => e.id);
    expect(ids).not.toContain(exceptionId);

    // GET by ID should also 404 for Org B
    const getRes = await handleGetException(exceptionId, adminClaimsB, testSql);
    expect(getRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Attachment upload test
// ---------------------------------------------------------------------------

describe('POST /exceptions with multipart/form-data attachment', () => {
  test('returns 201 and GET /exceptions/:id includes attachment_url', async () => {
    const placementId = await createPlacement(testSql, adminClaimsA);

    // Build a multipart request with an attachment
    const formData = new FormData();
    formData.append('placement_id', placementId);
    formData.append('exception_type', 'special_partner_agreement');
    formData.append('reason', 'Supporting agreement attached.');
    formData.append('impact_amount', '1500');
    const blob = new Blob(['PDF content here'], { type: 'application/pdf' });
    formData.append('attachment', blob, 'agreement.pdf');

    const req = new Request('http://localhost/exceptions', {
      method: 'POST',
      body: formData,
    });

    const res = await handleCreateException(req, adminClaimsA, testSql, auditSql);
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as { id: string; attachment_url: string | null };
    expect(body.id).toBeTruthy();
    expect(body.attachment_url).not.toBeNull();
    expect(body.attachment_url).toContain('agreement.pdf');

    // Fetch by ID and verify attachment_url is persisted
    const getRes = await handleGetException(body.id, adminClaimsA, testSql);
    expect(getRes.status).toBe(200);
    const getBody = (await jsonBody(getRes)) as { attachment_url: string | null };
    expect(getBody.attachment_url).not.toBeNull();
    expect(getBody.attachment_url).toContain('agreement.pdf');
  });
});

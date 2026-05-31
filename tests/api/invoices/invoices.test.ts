/**
 * Invoice and collection tracking API integration tests — issue #12 acceptance criteria.
 *
 * Tests (Acceptance criteria):
 *   AC#1 — POST /invoices linked to a placement returns 201 with status=Issued.
 *   AC#2 — PATCH /invoices/:id to status=Paid triggers re-evaluation of collection-gated
 *            CommissionRecords and transitions them to status=Payable.
 *   AC#3 — PATCH /invoices/:id with a WrittenOff status creates an AuditLogEntry.
 *   AC#4 — GET /commission-records?reason=collection_gate returns only Held records
 *            with that hold reason.
 *   AC#5 — POST /invoices/import with a valid CSV creates/updates invoices and triggers
 *            re-evaluation.
 *
 * Additional:
 *   - End-to-end: create placement → calculate → invoice Issued → assert CommissionRecord=Held
 *                  → mark invoice Paid → assert CommissionRecord=Payable.
 *   - Audit test: each invoice state change produces an AuditLogEntry.
 *   - Multi-tenant isolation.
 *   - Invalid state transition rejection.
 *   - POST /invoices returns 404 for unknown placement.
 *   - PATCH /invoices/:id returns 404 for unknown invoice.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.5, §7.2
 * Issue: feat: invoice and collection tracking (#12)
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
  handleCreateInvoice,
  handleUpdateInvoice,
  handleImportInvoices,
  handleListAllCommissionRecords,
  parseInvoiceCsv,
} from '../../../apps/server/src/api/invoices';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
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

  // Inject deterministic encryption so tests run without env config
  const adapter = new LocalDevKmsAdapter();
  const enc = new FieldEncryptor(adapter);
  _setEncryptorForTest(enc);
  _setCommRecordEncryptorForTest(enc);
  _setInvoiceEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
  _resetCommRecordEncryptorForTest();
  _resetInvoiceEncryptorForTest();
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

/** Create a placement and return its ID */
async function createPlacement(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Account Executive',
      compensation_base: '120000',
      fee_amount: '24000',
      start_date: '2025-03-01',
      guarantee_days: null,
      ...overrides,
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

/** Create an active plan version assigned to a producer */
async function createActivePlan(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  producerId: string,
  rules: Record<string, unknown> = {},
): Promise<string> {
  const createReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: `Invoice Test Plan ${Date.now()}`,
      effective_from: '2025-01-01',
      rules: {
        rate_type: 'gross_fee',
        base_rate: 0.25,
        ...rules,
      },
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

/** Add a contributor to a placement and return contributor + producer IDs */
async function addContributor(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  placementId: string,
  splitPct = 1.0,
): Promise<{ contributorId: string; producerId: string }> {
  const producerId = crypto.randomUUID();
  const req = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: splitPct },
  });
  const res = await handleAddContributor(placementId, req, claims, sql);
  expect(res.status).toBe(201);
  const body = (await jsonBody(res)) as { id: string };
  return { contributorId: body.id, producerId };
}

/** Run calculate on a placement and return commission records */
async function runCalculation(
  sql: ReturnType<typeof postgres>,
  claims: SessionClaims,
  placementId: string,
): Promise<Array<{ id: string; status: string; hold_reason: string | null }>> {
  const req = makeRequest({ path: `/placements/${placementId}/calculate`, method: 'POST' });
  const res = await handleCalculateCommission(placementId, req, claims, sql);
  expect(res.status).toBe(200);
  const body = (await jsonBody(res)) as {
    commission_records: Array<{ id: string; status: string; hold_reason: string | null }>;
  };
  return body.commission_records;
}

// ---------------------------------------------------------------------------
// AC#1 — POST /invoices creates invoice with status=Issued
// ---------------------------------------------------------------------------

describe('POST /invoices — create invoice (AC#1)', () => {
  test('returns 201 with status=Issued when linked to a valid placement', async () => {
    const placementId = await createPlacement(testSql, claimsA);

    const req = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: `INV-AC1-${Date.now()}`,
        amount_billed: '24000',
        issued_at: new Date().toISOString(),
      },
    });

    const res = await handleCreateInvoice(req, claimsA, testSql, testSql);
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as {
      id: string;
      placement_id: string;
      status: string;
      amount_billed: string;
      invoice_number: string;
    };

    expect(body.status).toBe('Issued');
    expect(body.placement_id).toBe(placementId);
    expect(body.id).toBeTruthy();
    expect(body.invoice_number).toMatch(/^INV-AC1-/);
  });

  test('returns 404 when placement does not exist', async () => {
    const req = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: crypto.randomUUID(),
        invoice_number: `INV-NOTFOUND-${Date.now()}`,
        amount_billed: '10000',
      },
    });

    const res = await handleCreateInvoice(req, claimsA, testSql, testSql);
    expect(res.status).toBe(404);
  });

  test('returns 404 when placement belongs to another org (multi-tenant isolation)', async () => {
    // Create placement under org B
    const placementId = await createPlacement(testSql, claimsB);

    // Try to create invoice as org A
    const req = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: `INV-ISOLATION-${Date.now()}`,
        amount_billed: '10000',
      },
    });

    const res = await handleCreateInvoice(req, claimsA, testSql, testSql);
    expect(res.status).toBe(404);
  });

  test('returns 422 when required fields are missing', async () => {
    const placementId = await createPlacement(testSql, claimsA);

    // Missing invoice_number
    const req = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        amount_billed: '5000',
      },
    });

    const res = await handleCreateInvoice(req, claimsA, testSql, testSql);
    expect(res.status).toBe(422);
  });

  test('returns 422 when amount_billed is not numeric', async () => {
    const placementId = await createPlacement(testSql, claimsA);

    const req = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: `INV-BAD-${Date.now()}`,
        amount_billed: 'not-a-number',
      },
    });

    const res = await handleCreateInvoice(req, claimsA, testSql, testSql);
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — PATCH /invoices/:id to Paid triggers collection gate release
// ---------------------------------------------------------------------------

describe('PATCH /invoices/:id to Paid — collection gate release (AC#2)', () => {
  test('Paid transition releases Held commission records to Payable', async () => {
    // Setup: placement → calculate (collection gate active = no invoice) → Held
    const placementId = await createPlacement(testSql, claimsA, { fee_amount: '40000' });
    await activatePlacement(testSql, placementId);

    const { producerId } = await addContributor(testSql, claimsA, placementId);
    await createActivePlan(testSql, claimsA, producerId);

    // Calculate with no invoice — records should be Held (collection_gate)
    const records = await runCalculation(testSql, claimsA, placementId);
    expect(records.length).toBe(1);
    expect(records[0].status).toBe('Held');
    expect(records[0].hold_reason).toBe('collection_gate');

    // Create an invoice
    const createReq = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: `INV-PAID-${Date.now()}`,
        amount_billed: '40000',
      },
    });
    const createRes = await handleCreateInvoice(createReq, claimsA, testSql, testSql);
    expect(createRes.status).toBe(201);
    const createBody = (await jsonBody(createRes)) as { id: string };
    const invoiceId = createBody.id;

    // Patch invoice to Paid
    const patchReq = makeRequest({
      path: `/invoices/${invoiceId}`,
      method: 'PATCH',
      body: { status: 'Paid', amount_collected: '40000' },
    });
    const patchRes = await handleUpdateInvoice(invoiceId, patchReq, claimsA, testSql, testSql);
    expect(patchRes.status).toBe(200);

    const patchBody = (await jsonBody(patchRes)) as {
      status: string;
      collection_released: number;
    };
    expect(patchBody.status).toBe('Paid');
    expect(patchBody.collection_released).toBe(1);

    // Verify commission record is now Payable
    const recRow = await testSql.unsafe(
      `SELECT status, hold_reason FROM commission_records WHERE id = $1`,
      [records[0].id],
    );
    expect(recRow[0].status).toBe('Payable');
    expect(recRow[0].hold_reason).toBeNull();
  });

  test('collection_released is 0 when no Held records exist for placement', async () => {
    // Placement with Paid invoice from the start — records will be Accrued, not Held
    const placementId = await createPlacement(testSql, claimsA, { fee_amount: '20000' });
    await activatePlacement(testSql, placementId);

    const { producerId } = await addContributor(testSql, claimsA, placementId);
    await createActivePlan(testSql, claimsA, producerId);

    // Create invoice as Issued first
    const createReq = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: `INV-NORELEASE-${Date.now()}`,
        amount_billed: '20000',
      },
    });
    const createRes = await handleCreateInvoice(createReq, claimsA, testSql, testSql);
    expect(createRes.status).toBe(201);
    const { id: invoiceId } = (await jsonBody(createRes)) as { id: string };

    // Transition to Paid without any Held commission records
    const patchReq = makeRequest({
      path: `/invoices/${invoiceId}`,
      method: 'PATCH',
      body: { status: 'Paid', amount_collected: '20000' },
    });
    const patchRes = await handleUpdateInvoice(invoiceId, patchReq, claimsA, testSql, testSql);
    expect(patchRes.status).toBe(200);

    const body = (await jsonBody(patchRes)) as { collection_released: number };
    expect(body.collection_released).toBe(0);
  });

  test('returns 404 for unknown invoice', async () => {
    const fakeId = crypto.randomUUID();
    const req = makeRequest({
      path: `/invoices/${fakeId}`,
      method: 'PATCH',
      body: { status: 'Paid' },
    });
    const res = await handleUpdateInvoice(fakeId, req, claimsA, testSql, testSql);
    expect(res.status).toBe(404);
  });

  test('returns 422 for invalid state transition', async () => {
    const placementId = await createPlacement(testSql, claimsA);

    const createReq = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: `INV-BADTRANS-${Date.now()}`,
        amount_billed: '10000',
      },
    });
    const createRes = await handleCreateInvoice(createReq, claimsA, testSql, testSql);
    expect(createRes.status).toBe(201);
    const { id: invoiceId } = (await jsonBody(createRes)) as { id: string };

    // Patch to WrittenOff then try to change to Paid (invalid)
    const toWrittenOff = makeRequest({
      path: `/invoices/${invoiceId}`,
      method: 'PATCH',
      body: { status: 'WrittenOff' },
    });
    const res1 = await handleUpdateInvoice(invoiceId, toWrittenOff, claimsA, testSql, testSql);
    expect(res1.status).toBe(200);

    // Now try to transition WrittenOff → Paid (not allowed)
    const toPaid = makeRequest({
      path: `/invoices/${invoiceId}`,
      method: 'PATCH',
      body: { status: 'Paid' },
    });
    const res2 = await handleUpdateInvoice(invoiceId, toPaid, claimsA, testSql, testSql);
    expect(res2.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — PATCH /invoices/:id to WrittenOff creates AuditLogEntry
// ---------------------------------------------------------------------------

describe('PATCH /invoices/:id to WrittenOff — audit log (AC#3)', () => {
  test('WrittenOff transition produces an AuditLogEntry with actor, timestamp, and prior state', async () => {
    const placementId = await createPlacement(testSql, claimsA);

    const createReq = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: `INV-WRITEOFF-${Date.now()}`,
        amount_billed: '15000',
      },
    });
    const createRes = await handleCreateInvoice(createReq, claimsA, testSql, testSql);
    expect(createRes.status).toBe(201);
    const { id: invoiceId } = (await jsonBody(createRes)) as { id: string };

    // Patch to WrittenOff
    const patchReq = makeRequest({
      path: `/invoices/${invoiceId}`,
      method: 'PATCH',
      body: { status: 'WrittenOff' },
    });
    const patchRes = await handleUpdateInvoice(invoiceId, patchReq, claimsA, testSql, testSql);
    expect(patchRes.status).toBe(200);

    // Verify AuditLogEntry was created with actor, timestamp, and state fields
    const auditRows = await testSql.unsafe(
      `
      SELECT
        id,
        actor_id,
        action,
        entity_type,
        created_at,
        before_json,
        after_json,
        before_json->>'status' AS before_status,
        after_json->>'status'  AS after_status
      FROM audit_log_entries
      WHERE entity_type = 'invoice'
        AND entity_id = $1
        AND action = 'invoice.written_off'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [invoiceId],
    );

    expect(auditRows.length).toBe(1);
    const auditRow = auditRows[0] as unknown as {
      actor_id: string;
      action: string;
      entity_type: string;
      created_at: Date;
      before_json: unknown;
      after_json: unknown;
      before_status: string | null;
      after_status: string | null;
    };

    // actor_id must match the session user
    expect(auditRow.actor_id).toBe(USER_A_ID);
    // timestamp must exist
    expect(auditRow.created_at).toBeTruthy();
    // before_json must contain prior state — check raw JSONB and extracted status
    // Note: before_json is a JSONB object, so check the raw object's status key
    const beforeStatus =
      auditRow.before_status ??
      (auditRow.before_json != null && typeof auditRow.before_json === 'object'
        ? (auditRow.before_json as Record<string, unknown>)['status']
        : null);
    expect(beforeStatus).toBe('Issued');
    // after_json must contain new status
    expect(auditRow.after_status).toBe('WrittenOff');
  });

  test('invoice creation also produces an AuditLogEntry', async () => {
    const placementId = await createPlacement(testSql, claimsA);
    const invoiceNumber = `INV-AUDIT-CREATE-${Date.now()}`;

    const createReq = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: invoiceNumber,
        amount_billed: '5000',
      },
    });
    const createRes = await handleCreateInvoice(createReq, claimsA, testSql, testSql);
    expect(createRes.status).toBe(201);
    const { id: invoiceId } = (await jsonBody(createRes)) as { id: string };

    // Verify AuditLogEntry for creation
    const auditRows = await testSql.unsafe(
      `
      SELECT id, actor_id, action, entity_type, entity_id
      FROM audit_log_entries
      WHERE entity_type = 'invoice' AND entity_id = $1 AND action = 'invoice.created'
      `,
      [invoiceId],
    );

    expect(auditRows.length).toBe(1);
    const row = auditRows[0] as unknown as { actor_id: string };
    expect(row.actor_id).toBe(USER_A_ID);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — GET /commission-records?reason=collection_gate filter
// ---------------------------------------------------------------------------

describe('GET /commission-records?reason=collection_gate (AC#4)', () => {
  test('returns only Held records with hold_reason=collection_gate', async () => {
    // Create two placements: one with collection gate, one with guarantee hold
    const placementId1 = await createPlacement(testSql, claimsA, { fee_amount: '50000' });
    await activatePlacement(testSql, placementId1);

    const { producerId: p1 } = await addContributor(testSql, claimsA, placementId1);
    await createActivePlan(testSql, claimsA, p1);

    // No invoice → collection-gated
    const records1 = await runCalculation(testSql, claimsA, placementId1);
    expect(records1[0].hold_reason).toBe('collection_gate');

    // Query for collection_gate records
    const reqWithUrl = new Request('http://localhost/commission-records?reason=collection_gate', {
      method: 'GET',
    });
    const res = await handleListAllCommissionRecords(reqWithUrl, claimsA, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      commission_records: Array<{
        id: string;
        status: string;
        hold_reason: string;
        placement_id: string;
      }>;
    };

    // All returned records must have status=Held and hold_reason=collection_gate
    expect(body.commission_records.length).toBeGreaterThan(0);
    for (const record of body.commission_records) {
      expect(record.status).toBe('Held');
      expect(record.hold_reason).toBe('collection_gate');
    }

    // The record we just created must be in the results
    const found = body.commission_records.find((r) => r.id === records1[0].id);
    expect(found).toBeTruthy();
  });

  test('does not return records from other tenants (multi-tenant isolation)', async () => {
    // Create a collection-gated record under org B
    const placementId = await createPlacement(testSql, claimsB, { fee_amount: '30000' });
    await activatePlacement(testSql, placementId);

    const { producerId } = await addContributor(testSql, claimsB, placementId);
    await createActivePlan(testSql, claimsB, producerId);

    const bRecords = await runCalculation(testSql, claimsB, placementId);
    expect(bRecords[0].hold_reason).toBe('collection_gate');

    // Query as org A — must not see org B's records
    const reqWithUrl = new Request('http://localhost/commission-records?reason=collection_gate', {
      method: 'GET',
    });
    const res = await handleListAllCommissionRecords(reqWithUrl, claimsA, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      commission_records: Array<{ id: string }>;
    };

    const orgBRecordId = bRecords[0].id;
    const found = body.commission_records.find((r) => r.id === orgBRecordId);
    expect(found).toBeUndefined();
  });

  test('released records (Payable) do not appear in collection_gate results', async () => {
    const placementId = await createPlacement(testSql, claimsA, { fee_amount: '35000' });
    await activatePlacement(testSql, placementId);

    const { producerId } = await addContributor(testSql, claimsA, placementId);
    await createActivePlan(testSql, claimsA, producerId);

    // Calculate → Held
    const records = await runCalculation(testSql, claimsA, placementId);
    expect(records[0].status).toBe('Held');

    // Create invoice and pay it → releases to Payable
    const createReq = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: `INV-RELEASE-FILTER-${Date.now()}`,
        amount_billed: '35000',
      },
    });
    const createRes = await handleCreateInvoice(createReq, claimsA, testSql, testSql);
    expect(createRes.status).toBe(201);
    const { id: invoiceId } = (await jsonBody(createRes)) as { id: string };

    const patchReq = makeRequest({
      path: `/invoices/${invoiceId}`,
      method: 'PATCH',
      body: { status: 'Paid' },
    });
    await handleUpdateInvoice(invoiceId, patchReq, claimsA, testSql, testSql);

    // Now the released record must not appear in collection_gate filter
    const reqWithUrl = new Request('http://localhost/commission-records?reason=collection_gate', {
      method: 'GET',
    });
    const res = await handleListAllCommissionRecords(reqWithUrl, claimsA, testSql, testSql);
    const body = (await jsonBody(res)) as {
      commission_records: Array<{ id: string; status: string }>;
    };

    const released = body.commission_records.find((r) => r.id === records[0].id);
    expect(released).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC#5 — POST /invoices/import CSV batch import with re-evaluation
// ---------------------------------------------------------------------------

describe('POST /invoices/import — CSV batch import (AC#5)', () => {
  test('valid CSV creates invoices and triggers collection gate release when status=Paid', async () => {
    const placementId = await createPlacement(testSql, claimsA, { fee_amount: '60000' });
    await activatePlacement(testSql, placementId);

    const { producerId } = await addContributor(testSql, claimsA, placementId);
    await createActivePlan(testSql, claimsA, producerId);

    // Calculate with no invoice → Held
    const records = await runCalculation(testSql, claimsA, placementId);
    expect(records[0].status).toBe('Held');

    const invoiceNumber = `INV-CSV-IMPORT-${Date.now()}`;
    const csv = [
      'invoice_number,placement_id,amount_billed,status',
      `${invoiceNumber},${placementId},60000,Paid`,
    ].join('\n');

    const req = new Request('http://localhost/invoices/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv,
    });

    const res = await handleImportInvoices(req, claimsA, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as {
      processed: number;
      invoices: Array<{ status: string; invoice_number: string }>;
      collection_released: number;
    };

    expect(body.processed).toBe(1);
    expect(body.invoices[0].status).toBe('Paid');
    expect(body.invoices[0].invoice_number).toBe(invoiceNumber);
    expect(body.collection_released).toBe(1);

    // Verify commission record is now Payable
    const recRow = await testSql.unsafe(`SELECT status FROM commission_records WHERE id = $1`, [
      records[0].id,
    ]);
    expect(recRow[0].status).toBe('Payable');
  });

  test('import with Issued status does not release collection gate', async () => {
    const placementId = await createPlacement(testSql, claimsA, { fee_amount: '45000' });
    await activatePlacement(testSql, placementId);

    const { producerId } = await addContributor(testSql, claimsA, placementId);
    await createActivePlan(testSql, claimsA, producerId);

    const records = await runCalculation(testSql, claimsA, placementId);
    expect(records[0].status).toBe('Held');

    const invoiceNumber = `INV-CSV-ISSUED-${Date.now()}`;
    const csv = [
      'invoice_number,placement_id,amount_billed,status',
      `${invoiceNumber},${placementId},45000,Issued`,
    ].join('\n');

    const req = new Request('http://localhost/invoices/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv,
    });

    const res = await handleImportInvoices(req, claimsA, testSql, testSql);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as { collection_released: number };
    expect(body.collection_released).toBe(0);

    // Commission record still Held
    const recRow = await testSql.unsafe(`SELECT status FROM commission_records WHERE id = $1`, [
      records[0].id,
    ]);
    expect(recRow[0].status).toBe('Held');
  });

  test('returns 400 for empty CSV body', async () => {
    const req = new Request('http://localhost/invoices/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: '',
    });
    const res = await handleImportInvoices(req, claimsA, testSql, testSql);
    expect(res.status).toBe(400);
  });

  test('returns 400 when CSV is missing required columns', async () => {
    const csv = 'invoice_number,amount_billed\nINV-001,10000';
    const req = new Request('http://localhost/invoices/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv,
    });
    const res = await handleImportInvoices(req, claimsA, testSql, testSql);
    expect(res.status).toBe(400);
  });

  test('upsert: re-importing same invoice_number updates the existing row', async () => {
    const placementId = await createPlacement(testSql, claimsA);
    const invoiceNumber = `INV-UPSERT-${Date.now()}`;

    // First import: Issued
    const csv1 = [
      'invoice_number,placement_id,amount_billed,status',
      `${invoiceNumber},${placementId},10000,Issued`,
    ].join('\n');

    const req1 = new Request('http://localhost/invoices/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv1,
    });
    const res1 = await handleImportInvoices(req1, claimsA, testSql, testSql);
    expect(res1.status).toBe(200);
    const body1 = (await jsonBody(res1)) as { invoices: Array<{ id: string; status: string }> };
    expect(body1.invoices[0].status).toBe('Issued');

    // Second import: Paid (same invoice_number)
    const csv2 = [
      'invoice_number,placement_id,amount_billed,status',
      `${invoiceNumber},${placementId},10000,Paid`,
    ].join('\n');

    const req2 = new Request('http://localhost/invoices/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv2,
    });
    const res2 = await handleImportInvoices(req2, claimsA, testSql, testSql);
    expect(res2.status).toBe(200);
    const body2 = (await jsonBody(res2)) as { invoices: Array<{ status: string }> };
    expect(body2.invoices[0].status).toBe('Paid');
  });
});

// ---------------------------------------------------------------------------
// End-to-end test: placement → calculate → Issued → Held → Paid → Payable
// ---------------------------------------------------------------------------

describe('End-to-end: placement → calculate → invoice Paid → CommissionRecord=Payable', () => {
  test('full lifecycle: Issued invoice gates commission, Paid invoice releases it', async () => {
    // 1. Create and activate placement
    const placementId = await createPlacement(testSql, claimsA, { fee_amount: '100000' });
    await activatePlacement(testSql, placementId);

    // 2. Add contributor and plan
    const { producerId } = await addContributor(testSql, claimsA, placementId);
    await createActivePlan(testSql, claimsA, producerId, { base_rate: 0.2 });

    // 3. Calculate with no invoice — CommissionRecord should be Held
    const heldRecords = await runCalculation(testSql, claimsA, placementId);
    expect(heldRecords.length).toBe(1);
    expect(heldRecords[0].status).toBe('Held');
    expect(heldRecords[0].hold_reason).toBe('collection_gate');

    const recordId = heldRecords[0].id;

    // 4. Create invoice with status=Issued — commission stays Held
    const invoiceNumber = `INV-E2E-${Date.now()}`;
    const createReq = makeRequest({
      path: '/invoices',
      method: 'POST',
      body: {
        placement_id: placementId,
        invoice_number: invoiceNumber,
        amount_billed: '100000',
      },
    });
    const createRes = await handleCreateInvoice(createReq, claimsA, testSql, testSql);
    expect(createRes.status).toBe(201);
    const { id: invoiceId, status: createdStatus } = (await jsonBody(createRes)) as {
      id: string;
      status: string;
    };
    expect(createdStatus).toBe('Issued');

    // 5. Verify CommissionRecord still Held
    const afterCreate = await testSql.unsafe(
      `SELECT status, hold_reason FROM commission_records WHERE id = $1`,
      [recordId],
    );
    expect(afterCreate[0].status).toBe('Held');

    // 6. Mark invoice as Paid
    const patchReq = makeRequest({
      path: `/invoices/${invoiceId}`,
      method: 'PATCH',
      body: { status: 'Paid', amount_collected: '100000' },
    });
    const patchRes = await handleUpdateInvoice(invoiceId, patchReq, claimsA, testSql, testSql);
    expect(patchRes.status).toBe(200);

    const patchBody = (await jsonBody(patchRes)) as {
      status: string;
      collection_released: number;
    };
    expect(patchBody.status).toBe('Paid');
    expect(patchBody.collection_released).toBe(1);

    // 7. Assert CommissionRecord is now Payable
    const afterPaid = await testSql.unsafe(
      `SELECT status, hold_reason FROM commission_records WHERE id = $1`,
      [recordId],
    );
    expect(afterPaid[0].status).toBe('Payable');
    expect(afterPaid[0].hold_reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseInvoiceCsv unit tests
// ---------------------------------------------------------------------------

describe('parseInvoiceCsv', () => {
  test('parses valid CSV with required columns', () => {
    const csv = [
      'invoice_number,placement_id,amount_billed,status',
      'INV-001,abc-123,50000,Issued',
    ].join('\n');

    const rows = parseInvoiceCsv(csv);
    expect(rows.length).toBe(1);
    expect(rows[0]['invoice_number']).toBe('INV-001');
    expect(rows[0]['placement_id']).toBe('abc-123');
    expect(rows[0]['amount_billed']).toBe('50000');
    expect(rows[0]['status']).toBe('Issued');
  });

  test('throws when required column is missing', () => {
    const csv = 'invoice_number,amount_billed,status\nINV-001,50000,Issued';
    expect(() => parseInvoiceCsv(csv)).toThrow(/missing required column: placement_id/);
  });

  test('skips blank lines', () => {
    const csv = [
      'invoice_number,placement_id,amount_billed,status',
      '',
      'INV-001,abc,10000,Issued',
      '',
    ].join('\n');
    const rows = parseInvoiceCsv(csv);
    expect(rows.length).toBe(1);
  });

  test('throws for empty CSV', () => {
    expect(() => parseInvoiceCsv('')).toThrow();
  });

  test('parses optional amount_collected column', () => {
    const csv = [
      'invoice_number,placement_id,amount_billed,status,amount_collected',
      'INV-002,xyz-456,30000,Paid,30000',
    ].join('\n');
    const rows = parseInvoiceCsv(csv);
    expect(rows[0]['amount_collected']).toBe('30000');
  });
});

/**
 * External Partner scoped deal-list endpoint — integration tests (issue #125).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — GET /partner/placements returns exactly the authenticated partner's
 *            split deals (placements where they hold a contributor row).
 *   AC#2 — A placement the partner is not on never appears in the list
 *            (negative test with a seeded unrelated placement).
 *   AC#3 — Other contributors' credit, internal margin, and draw fields are
 *            masked/absent in each list entry; masking mirrors #64.
 *   AC#4 — A non-partner role receives 403.
 *   AC#5 — One partner cannot see another partner's deals (isolation test).
 *   AC#6 — Confidential placement appears with masked job_title / client_entity_id
 *            for ExternalPartner; amounts are not masked.
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No Vitest mocking helpers are used — real Postgres only (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §4 (External Partner), §5.11, §9
 * Issue: feat: external partner scoped deal-list endpoint (#125)
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
import {
  handleCreatePlacement,
  handleUpdatePlacement,
  handleListPartnerPlacements,
} from '../../../apps/server/src/api/placements';
import { handleAddContributor } from '../../../apps/server/src/api/contributors';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let auditSql: ReturnType<typeof postgres>;

const ORG_ID = crypto.randomUUID();
const OTHER_ORG_ID = crypto.randomUUID();

const financeAdmin: SessionClaims = {
  org_id: ORG_ID,
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const partnerUserId = crypto.randomUUID();
const partner: SessionClaims = {
  org_id: ORG_ID,
  user_id: partnerUserId,
  role: 'ExternalPartner',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const partner2UserId = crypto.randomUUID();
const partner2: SessionClaims = {
  org_id: ORG_ID,
  user_id: partner2UserId,
  role: 'ExternalPartner',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  auditSql = postgres(pg.url, { max: 3 });

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });

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
 * Creates a placement (via the FinanceAdmin handler) and returns its id.
 */
async function createPlacement(opts: {
  jobTitle?: string;
  isConfidential?: boolean;
  claimsOverride?: SessionClaims;
}): Promise<string> {
  const claims = opts.claimsOverride ?? financeAdmin;
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: opts.jobTitle ?? 'Partner Test Role',
      compensation_base: '100000',
      fee_amount: '18000',
      start_date: '2025-06-01',
      guarantee_days: null,
    },
  });
  const res = await handleCreatePlacement(req, claims, testSql);
  expect(res.status).toBe(201);
  const { id } = (await jsonBody(res)) as { id: string };
  return id;
}

/**
 * Assigns a contributor (partner) to a placement as ExternalSplit.
 */
async function addPartnerContributor(placementId: string, producerId: string): Promise<void> {
  // Activate the placement first so contributors can be added
  await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);

  const req = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: { producer_id: producerId, role: 'CandidateOwner', split_pct: 0.15 },
  });
  const res = await handleAddContributor(placementId, req, financeAdmin, testSql);
  expect(res.status).toBe(201);
}

// ---------------------------------------------------------------------------
// AC#1 — Scoped list: partner sees only their own deals
// ---------------------------------------------------------------------------

describe('AC#1 — Scoped list returns only partner deals', () => {
  let ownPlacementId: string;
  let unrelatedPlacementId: string;

  beforeAll(async () => {
    ownPlacementId = await createPlacement({ jobTitle: 'Partner Own Deal' });
    unrelatedPlacementId = await createPlacement({ jobTitle: 'Unrelated Deal' });

    // Only add the partner to ownPlacementId
    await addPartnerContributor(ownPlacementId, partnerUserId);
  }, 60_000);

  test('GET /partner/placements returns 200 with an array', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner, testSql);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test('Response includes the placement the partner is on', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner, testSql);
    const body = (await jsonBody(res)) as Array<{ id: string }>;
    const ids = body.map((p) => p.id);
    expect(ids).toContain(ownPlacementId);
  });

  // AC#2 — unrelated placement never appears
  test('AC#2 — Unrelated placement never appears in the list', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner, testSql);
    const body = (await jsonBody(res)) as Array<{ id: string }>;
    const ids = body.map((p) => p.id);
    expect(ids).not.toContain(unrelatedPlacementId);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — Field masking: confidential placement returns masked fields
// ---------------------------------------------------------------------------

describe('AC#3 — Field masking on confidential placement', () => {
  let confidentialId: string;
  const JOB_TITLE = `Confidential Partner Role ${Date.now()}`;

  beforeAll(async () => {
    confidentialId = await createPlacement({ jobTitle: JOB_TITLE });
    await addPartnerContributor(confidentialId, partnerUserId);

    // Mark as confidential
    const patchReq = makeRequest({
      path: `/placements/${confidentialId}`,
      method: 'PATCH',
      body: { is_confidential: true },
    });
    await handleUpdatePlacement(confidentialId, patchReq, financeAdmin, testSql, auditSql);
  }, 60_000);

  test('ExternalPartner sees job_title="Confidential" and null client_entity_id', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner, testSql);
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    const entry = body.find((p) => p.id === confidentialId);
    expect(entry).toBeDefined();
    expect(entry!.job_title).toBe('Confidential');
    expect(entry!.client_entity_id).toBeNull();
    expect(entry!.is_confidential).toBe(true);
  });

  test('Amounts (fee_amount, compensation_base) are NOT masked', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner, testSql);
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    const entry = body.find((p) => p.id === confidentialId);
    expect(entry).toBeDefined();
    expect(entry!.fee_amount).toBeTruthy();
    expect(entry!.compensation_base).toBeTruthy();
  });

  test('Non-confidential placement shows real job_title to ExternalPartner', async () => {
    const plainId = await createPlacement({ jobTitle: 'Non-Confidential Partner Deal' });
    await addPartnerContributor(plainId, partnerUserId);

    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner, testSql);
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    const entry = body.find((p) => p.id === plainId);
    expect(entry).toBeDefined();
    expect(entry!.job_title).toBe('Non-Confidential Partner Deal');
    expect(entry!.client_entity_id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Role 403: non-partner roles are rejected
// ---------------------------------------------------------------------------

describe('AC#4 — Non-partner role receives 403', () => {
  const roles: Array<SessionClaims['role']> = ['Producer', 'Manager', 'HR', 'Executive'];

  for (const role of roles) {
    test(`Role ${role} receives 403`, async () => {
      const claims: SessionClaims = {
        org_id: ORG_ID,
        user_id: crypto.randomUUID(),
        role,
        jti: crypto.randomUUID(),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const req = makeRequest({ path: '/partner/placements' });
      const res = await handleListPartnerPlacements(req, claims, testSql);
      expect(res.status).toBe(403);
    });
  }
});

// ---------------------------------------------------------------------------
// AC#5 — Cross-partner isolation: partner1 cannot see partner2's deals
// ---------------------------------------------------------------------------

describe('AC#5 — Cross-partner isolation', () => {
  let partner1PlacementId: string;
  let partner2PlacementId: string;

  beforeAll(async () => {
    partner1PlacementId = await createPlacement({ jobTitle: 'Partner1 Exclusive Deal' });
    partner2PlacementId = await createPlacement({ jobTitle: 'Partner2 Exclusive Deal' });

    await addPartnerContributor(partner1PlacementId, partnerUserId);
    await addPartnerContributor(partner2PlacementId, partner2UserId);
  }, 60_000);

  test('Partner1 does not see Partner2 exclusive deal', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner, testSql);
    const body = (await jsonBody(res)) as Array<{ id: string }>;
    const ids = body.map((p) => p.id);
    expect(ids).not.toContain(partner2PlacementId);
  });

  test('Partner2 does not see Partner1 exclusive deal', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner2, testSql);
    const body = (await jsonBody(res)) as Array<{ id: string }>;
    const ids = body.map((p) => p.id);
    expect(ids).not.toContain(partner1PlacementId);
  });

  test('Partner1 sees their own exclusive deal', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner, testSql);
    const body = (await jsonBody(res)) as Array<{ id: string }>;
    const ids = body.map((p) => p.id);
    expect(ids).toContain(partner1PlacementId);
  });

  test('Partner2 sees their own exclusive deal', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner2, testSql);
    const body = (await jsonBody(res)) as Array<{ id: string }>;
    const ids = body.map((p) => p.id);
    expect(ids).toContain(partner2PlacementId);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Tenant isolation: partner from different org sees empty list
// ---------------------------------------------------------------------------

describe('AC#5 — Tenant isolation: partner from different org sees no placements', () => {
  test('Partner with different org_id sees empty list', async () => {
    const foreignPartner: SessionClaims = {
      org_id: OTHER_ORG_ID,
      user_id: partnerUserId, // same user_id but different org
      role: 'ExternalPartner',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, foreignPartner, testSql);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Array<unknown>;
    expect(body).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Response shape: each entry carries the expected fields
// ---------------------------------------------------------------------------

describe('Response shape — each list entry carries expected fields', () => {
  let shapePlacementId: string;

  beforeAll(async () => {
    shapePlacementId = await createPlacement({ jobTitle: 'Shape Test Deal' });
    await addPartnerContributor(shapePlacementId, partnerUserId);
  }, 60_000);

  test('Each entry has required placement fields', async () => {
    const req = makeRequest({ path: '/partner/placements' });
    const res = await handleListPartnerPlacements(req, partner, testSql);
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    const entry = body.find((p) => p.id === shapePlacementId);
    expect(entry).toBeDefined();
    expect(typeof entry!.id).toBe('string');
    expect(typeof entry!.org_id).toBe('string');
    expect(typeof entry!.job_title).toBe('string');
    expect(typeof entry!.fee_amount).toBe('string');
    expect(typeof entry!.compensation_base).toBe('string');
    expect(typeof entry!.status).toBe('string');
    expect(typeof entry!.is_confidential).toBe('boolean');
    // Internal margin and other contributors' data are not included
    expect('margin' in entry!).toBe(false);
    expect('draw_balance' in entry!).toBe(false);
  });
});

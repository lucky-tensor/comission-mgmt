/**
 * Placement API integration tests — issue #5 acceptance criteria.
 *
 * Tests:
 *   AC#1 — POST /placements with all required fields returns 201 with status='Created'
 *   AC#2 — POST /placements missing required fields returns 422 with field-level errors
 *   AC#3 — POST /placements/import with a valid CSV returns 200 and creates one
 *           placement per data row; all fields are mapped correctly
 *   AC#4 — POST /placements/import with a malformed CSV returns 400 with parseable error
 *   AC#5 — GET /placements returns only placements belonging to the authenticated tenant
 *           (multi-tenant isolation: tenant A placements invisible to tenant B)
 *
 * Additional tests:
 *   - GET /placements/:id returns 200 for owned placement, 404 for foreign placement
 *   - CSV import test: loads tests/fixtures/placements.csv and asserts row count
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.1
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { FieldEncryptor } from '../../../../../packages/db/src/encryption';
import { LocalDevKmsAdapter } from '../../../../../packages/db/src/kms-dev';
import {
  _setEncryptorForTest,
  _resetEncryptorForTest,
} from '../../../../../packages/db/src/placements';
import {
  generateEcKeyPair,
  _resetKeyStoreForTest,
  _seedKeyPairForTest,
  type EcKeyPair,
} from '../../../src/auth/jwt';
import {
  handleCreatePlacement,
  handleImportPlacements,
  handleListPlacements,
  handleGetPlacement,
  parsePlacementCsv,
} from '../../../src/api/placements';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let sharedKp: EcKeyPair;

const ORG_A_ID = crypto.randomUUID();
const ORG_B_ID = crypto.randomUUID();
const USER_A_ID = crypto.randomUUID();
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

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: null, analyticsDatabaseUrl: null });

  // Inject deterministic encryption so tests run without env config
  const adapter = new LocalDevKmsAdapter();
  const enc = new FieldEncryptor(adapter);
  _setEncryptorForTest(enc);

  // Seed deterministic JWT key pair
  _resetKeyStoreForTest();
  sharedKp = await generateEcKeyPair();
  _seedKeyPairForTest(sharedKp);
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
  await testSql?.end({ timeout: 5 });
  await pg?.stop();
  _resetKeyStoreForTest();
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(opts: {
  path: string;
  method?: string;
  body?: unknown;
  contentType?: string;
  cookie?: string;
}): Request {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    'Content-Type': opts.contentType ?? 'application/json',
  };
  if (opts.cookie) headers['Cookie'] = opts.cookie;

  return new Request(`http://localhost${opts.path}`, {
    method,
    headers,
    body:
      opts.body !== undefined
        ? typeof opts.body === 'string'
          ? opts.body
          : JSON.stringify(opts.body)
        : undefined,
  });
}

// ---------------------------------------------------------------------------
// AC#1 — POST /placements — happy path
// ---------------------------------------------------------------------------

describe('POST /placements — create placement', () => {
  test('returns 201 with status=Created when all required fields are present', async () => {
    const req = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Software Engineer',
        compensation_base: '150000',
        fee_amount: '30000',
        start_date: '2025-03-01',
      },
    });

    const res = await handleCreatePlacement(req, claimsA, testSql);
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('Created');
    expect(body.id).toBeTruthy();
    expect(body.org_id).toBe(ORG_A_ID);
    expect(body.job_title).toBe('Software Engineer');
    expect(body.compensation_base).toBe('150000');
    expect(body.fee_amount).toBe('30000');
    expect(body.start_date).toBe('2025-03-01');
  });

  test('derives fee_amount from fee_pct when fee_amount is not provided', async () => {
    const req = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Product Manager',
        compensation_base: '180000',
        fee_pct: '20',
        start_date: '2025-04-01',
      },
    });

    const res = await handleCreatePlacement(req, claimsA, testSql);
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('Created');
    // 180000 * 20% = 36000
    expect(body.fee_amount).toBe('36000');
  });
});

// ---------------------------------------------------------------------------
// AC#2 — POST /placements — validation errors
// ---------------------------------------------------------------------------

describe('POST /placements — validation errors', () => {
  test('returns 422 with field-level errors when required fields are missing', async () => {
    const req = makeRequest({
      path: '/placements',
      method: 'POST',
      // Missing: candidate_id, client_entity_id, job_title, compensation_base, fee fields
      body: {},
    });

    const res = await handleCreatePlacement(req, claimsA, testSql);
    expect(res.status).toBe(422);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('Validation failed');
    const fields = body.fields as Record<string, string>;
    expect(fields).toBeDefined();
    expect(Object.keys(fields).length).toBeGreaterThan(0);
    // All required fields should appear in the error map
    expect(fields['candidate_id']).toBeTruthy();
    expect(fields['client_entity_id']).toBeTruthy();
    expect(fields['job_title']).toBeTruthy();
    expect(fields['compensation_base']).toBeTruthy();
  });

  test('returns 422 when only some required fields are missing', async () => {
    const req = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        // Missing: client_entity_id, job_title, compensation_base
        fee_amount: '10000',
      },
    });

    const res = await handleCreatePlacement(req, claimsA, testSql);
    expect(res.status).toBe(422);

    const body = (await res.json()) as Record<string, unknown>;
    const fields = body.fields as Record<string, string>;
    expect(fields['client_entity_id']).toBeTruthy();
    expect(fields['job_title']).toBeTruthy();
    expect(fields['compensation_base']).toBeTruthy();
    // candidate_id was provided — should NOT be in errors
    expect(fields['candidate_id']).toBeUndefined();
  });

  test('returns 400 for invalid JSON body', async () => {
    const req = makeRequest({
      path: '/placements',
      method: 'POST',
      body: 'not json',
      contentType: 'application/json',
    });

    const res = await handleCreatePlacement(req, claimsA, testSql);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — POST /placements/import — valid CSV
// ---------------------------------------------------------------------------

describe('POST /placements/import — valid CSV', () => {
  test('returns 200 and creates one placement per data row', async () => {
    const csv = `client,job_order,candidate,start_date,fee_pct,compensation_base,gross_fee
Acme Corp,Software Engineer,Alice Johnson,2025-03-01,20,150000,30000
Globex Inc,Product Manager,Bob Smith,2025-04-15,18,180000,32400`;

    const req = makeRequest({
      path: '/placements/import',
      method: 'POST',
      body: csv,
      contentType: 'text/csv',
    });

    const res = await handleImportPlacements(req, claimsA, testSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.created).toBe(2);
    const placements = body.placements as Record<string, unknown>[];
    expect(placements).toHaveLength(2);

    // Verify all placements belong to the correct tenant
    for (const p of placements) {
      expect(p.org_id).toBe(ORG_A_ID);
      expect(p.id).toBeTruthy();
      expect(p.status).toBe('Created');
    }

    // Verify field mapping for first row
    const first = placements[0];
    expect(first.job_title).toBe('Software Engineer');
    expect(first.compensation_base).toBe('150000');
    expect(first.fee_amount).toBe('30000');
    expect(first.start_date).toBe('2025-03-01');
  });

  test('loads tests/fixtures/placements.csv and creates the correct row count', async () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const fixturesCsvPath = resolve(__dirname, '../../../../../tests/fixtures/placements.csv');
    const csvText = readFileSync(fixturesCsvPath, 'utf-8');

    // Parse manually to get expected row count
    const rows = parsePlacementCsv(csvText);
    expect(rows.length).toBe(3); // 3 data rows in the fixture

    const req = makeRequest({
      path: '/placements/import',
      method: 'POST',
      body: csvText,
      contentType: 'text/csv',
    });

    const res = await handleImportPlacements(req, claimsA, testSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.created).toBe(rows.length);

    const placements = body.placements as Record<string, unknown>[];
    expect(placements).toHaveLength(rows.length);

    // Verify all fields are mapped correctly for each fixture row
    const expectedJobs = ['Software Engineer', 'Product Manager', 'Data Analyst'];
    const expectedBases = ['150000', '180000', '120000'];
    const expectedFees = ['30000', '32400', '26400'];

    for (let i = 0; i < placements.length; i++) {
      expect(placements[i].job_title).toBe(expectedJobs[i]);
      expect(placements[i].compensation_base).toBe(expectedBases[i]);
      expect(placements[i].fee_amount).toBe(expectedFees[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// AC#4 — POST /placements/import — malformed CSV
// ---------------------------------------------------------------------------

describe('POST /placements/import — malformed CSV', () => {
  test('returns 400 with a parseable error body for CSV missing required columns', async () => {
    const csv = `client,candidate
Acme Corp,Alice Johnson`;

    const req = makeRequest({
      path: '/placements/import',
      method: 'POST',
      body: csv,
      contentType: 'text/csv',
    });

    const res = await handleImportPlacements(req, claimsA, testSql);
    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeTruthy();
    expect(typeof body.error).toBe('string');
    // Error message should be parseable — contains the column name
    expect((body.error as string).toLowerCase()).toContain('column');
  });

  test('returns 400 for an empty CSV body', async () => {
    const req = makeRequest({
      path: '/placements/import',
      method: 'POST',
      body: '',
      contentType: 'text/csv',
    });

    const res = await handleImportPlacements(req, claimsA, testSql);
    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeTruthy();
  });

  test('returns 400 for CSV with mismatched column counts', async () => {
    const csv = `client,job_order,candidate,start_date,fee_pct,compensation_base,gross_fee
Acme Corp,Software Engineer,Alice Johnson`;

    const req = makeRequest({
      path: '/placements/import',
      method: 'POST',
      body: csv,
      contentType: 'text/csv',
    });

    const res = await handleImportPlacements(req, claimsA, testSql);
    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC#5 — GET /placements — multi-tenant isolation
// ---------------------------------------------------------------------------

describe('GET /placements — multi-tenant isolation', () => {
  test('tenant A cannot see placements created by tenant B', async () => {
    // Create a placement for tenant B
    const createReq = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Tenant B Exclusive Role',
        compensation_base: '200000',
        fee_amount: '40000',
      },
    });
    const createRes = await handleCreatePlacement(createReq, claimsB, testSql);
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    const tenantBPlacementId = created.id as string;

    // Fetch list as tenant A
    const listReq = makeRequest({ path: '/placements', method: 'GET' });
    const listRes = await handleListPlacements(listReq, claimsA, testSql);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as Record<string, unknown>[];

    // Tenant A's list must not include tenant B's placement
    const orgBItems = listBody.filter((p) => p.org_id === ORG_B_ID);
    expect(orgBItems).toHaveLength(0);

    // Verify the placement really belongs to tenant B (sanity check)
    const listReqB = makeRequest({ path: '/placements', method: 'GET' });
    const listResB = await handleListPlacements(listReqB, claimsB, testSql);
    expect(listResB.status).toBe(200);
    const listBodyB = (await listResB.json()) as Record<string, unknown>[];
    const tenantBItem = listBodyB.find((p) => p.id === tenantBPlacementId);
    expect(tenantBItem).toBeDefined();
  });

  test('GET /placements/:id returns 404 when placement belongs to a different tenant', async () => {
    // Create a placement for tenant B
    const createReq = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Cross-Tenant Secret Role',
        compensation_base: '250000',
        fee_amount: '50000',
      },
    });
    const createRes = await handleCreatePlacement(createReq, claimsB, testSql);
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    const placementId = created.id as string;

    // Attempt to get the placement as tenant A — should get 404
    const getRes = await handleGetPlacement(placementId, claimsA, testSql);
    expect(getRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /placements and GET /placements/:id — additional coverage
// ---------------------------------------------------------------------------

describe('GET /placements and GET /placements/:id', () => {
  test('GET /placements returns only placements belonging to the authenticated tenant', async () => {
    // Create two placements for tenant A
    for (let i = 0; i < 2; i++) {
      const req = makeRequest({
        path: '/placements',
        method: 'POST',
        body: {
          candidate_id: crypto.randomUUID(),
          client_entity_id: crypto.randomUUID(),
          job_title: `List Test Role ${i}`,
          compensation_base: '100000',
          fee_amount: '20000',
        },
      });
      const res = await handleCreatePlacement(req, claimsA, testSql);
      expect(res.status).toBe(201);
    }

    const listReq = makeRequest({ path: '/placements', method: 'GET' });
    const listRes = await handleListPlacements(listReq, claimsA, testSql);
    expect(listRes.status).toBe(200);

    const list = (await listRes.json()) as Record<string, unknown>[];
    // All returned placements must belong to tenant A
    for (const p of list) {
      expect(p.org_id).toBe(ORG_A_ID);
    }
  });

  test('GET /placements/:id returns 200 with the placement for the owning tenant', async () => {
    const createReq = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Detail Test Role',
        compensation_base: '130000',
        fee_amount: '26000',
        start_date: '2025-06-01',
        guarantee_days: 90,
      },
    });
    const createRes = await handleCreatePlacement(createReq, claimsA, testSql);
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;

    const getRes = await handleGetPlacement(created.id as string, claimsA, testSql);
    expect(getRes.status).toBe(200);

    const p = (await getRes.json()) as Record<string, unknown>;
    expect(p.id).toBe(created.id);
    expect(p.job_title).toBe('Detail Test Role');
    expect(p.compensation_base).toBe('130000');
    expect(p.fee_amount).toBe('26000');
    expect(p.start_date).toBe('2025-06-01');
    expect(p.guarantee_days).toBe(90);
  });

  test('GET /placements/:id returns 404 for a non-existent placement', async () => {
    const nonExistentId = crypto.randomUUID();
    const res = await handleGetPlacement(nonExistentId, claimsA, testSql);
    expect(res.status).toBe(404);
  });
});

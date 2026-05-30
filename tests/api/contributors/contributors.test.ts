/**
 * Contributors API integration tests — issue #7 acceptance criteria.
 *
 * Tests:
 *   AC#1 — POST /placements/:id/contributors with valid role and split_pct returns 201
 *   AC#2 — Attempting to finalize a placement where split_pct values do not sum to 100 returns 422
 *   AC#3 — GET /placements/:id/contributors returns all assigned contributors with role and split_pct
 *   AC#4 — Each contributor assignment creates an AuditLogEntry row
 *   AC#5 — All eight PRD contributor roles are accepted values; unknown role returns 422
 *
 * Additional tests:
 *   - DELETE /placements/:id/contributors/:cid removes the contributor (returns 204)
 *   - POST with unknown role returns 422
 *   - Audit test: after adding 3 contributors, assert AuditLogEntry count is 3
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.2
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { FieldEncryptor } from '../../../packages/db/src/encryption';
import { LocalDevKmsAdapter } from '../../../packages/db/src/kms-dev';
import {
  _setEncryptorForTest,
  _resetEncryptorForTest,
} from '../../../packages/db/src/placements';
import { CONTRIBUTOR_ROLES } from '../../../packages/core/contributor-role';
import {
  handleAddContributor,
  handleListContributors,
  handleDeleteContributor,
} from '../../../apps/server/src/api/contributors';
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let auditSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const USER_A_ID = crypto.randomUUID();

const claimsA: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: USER_A_ID,
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  auditSql = postgres(pg.url, { max: 2 });

  // Migrate the app schema (no separate audit container — use same DB for tests)
  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });

  // Inject deterministic encryption so tests run without env config
  const adapter = new LocalDevKmsAdapter();
  const enc = new FieldEncryptor(adapter);
  _setEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
  await testSql?.end({ timeout: 5 });
  await auditSql?.end({ timeout: 5 });
  await pg?.stop();
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(opts: {
  path: string;
  method?: string;
  body?: unknown;
}): Request {
  const method = opts.method ?? 'GET';
  return new Request(`http://localhost${opts.path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/**
 * Creates a placement for testing and returns its ID.
 */
async function createTestPlacement(): Promise<string> {
  const req = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Test Role',
      compensation_base: '150000',
      fee_amount: '30000',
    },
  });
  const res = await handleCreatePlacement(req, claimsA, testSql);
  expect(res.status).toBe(201);
  const body = (await res.json()) as Record<string, unknown>;
  return body.id as string;
}

// ---------------------------------------------------------------------------
// AC#1 — POST /placements/:id/contributors returns 201
// ---------------------------------------------------------------------------

describe('POST /placements/:id/contributors', () => {
  test('AC#1: valid role and split_pct returns 201', async () => {
    const placementId = await createTestPlacement();

    const req = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: {
        producer_id: crypto.randomUUID(),
        role: 'ClientOriginator',
        split_pct: 1.0,
      },
    });

    const res = await handleAddContributor(placementId, req, claimsA, testSql, auditSql);
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.placement_id).toBe(placementId);
    expect(body.role).toBe('ClientOriginator');
    expect(body.split_pct).toBeCloseTo(1.0);
    expect(body.org_id).toBe(ORG_A_ID);
  });

  test('returns 404 when placement does not exist', async () => {
    const req = makeRequest({
      path: `/placements/${crypto.randomUUID()}/contributors`,
      method: 'POST',
      body: {
        producer_id: crypto.randomUUID(),
        role: 'AccountOwner',
        split_pct: 0.5,
      },
    });
    const res = await handleAddContributor(crypto.randomUUID(), req, claimsA, testSql, auditSql);
    expect(res.status).toBe(404);
  });

  test('returns 404 when placement belongs to a different tenant', async () => {
    const placementId = await createTestPlacement();

    const foreignClaims: SessionClaims = {
      org_id: crypto.randomUUID(),
      user_id: crypto.randomUUID(),
      role: 'FinanceAdmin',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const req = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: {
        producer_id: crypto.randomUUID(),
        role: 'AccountOwner',
        split_pct: 0.5,
      },
    });
    const res = await handleAddContributor(placementId, req, foreignClaims, testSql, auditSql);
    expect(res.status).toBe(404);
  });

  test('returns 422 for unknown role', async () => {
    const placementId = await createTestPlacement();

    const req = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: {
        producer_id: crypto.randomUUID(),
        role: 'InvalidRole',
        split_pct: 0.5,
      },
    });

    const res = await handleAddContributor(placementId, req, claimsA, testSql, auditSql);
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.fields).toBeDefined();
    expect((body.fields as Record<string, string>).role).toBeDefined();
  });

  test('returns 422 for missing producer_id', async () => {
    const placementId = await createTestPlacement();

    const req = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: {
        role: 'AccountOwner',
        split_pct: 0.5,
      },
    });

    const res = await handleAddContributor(placementId, req, claimsA, testSql, auditSql);
    expect(res.status).toBe(422);
  });

  test('returns 422 for split_pct > 1.0', async () => {
    const placementId = await createTestPlacement();

    const req = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: {
        producer_id: crypto.randomUUID(),
        role: 'AccountOwner',
        split_pct: 1.5,
      },
    });

    const res = await handleAddContributor(placementId, req, claimsA, testSql, auditSql);
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Enum validation: all 8 PRD roles accepted; unknown role rejected
// ---------------------------------------------------------------------------

describe('Enum validation — all 8 PRD contributor roles', () => {
  test('AC#5: POST with each valid role returns 201', async () => {
    // Use a fresh placement per sub-test to avoid split_pct accumulation issues
    for (const role of CONTRIBUTOR_ROLES) {
      const placementId = await createTestPlacement();

      const req = makeRequest({
        path: `/placements/${placementId}/contributors`,
        method: 'POST',
        body: {
          producer_id: crypto.randomUUID(),
          role,
          split_pct: 1.0,
        },
      });

      const res = await handleAddContributor(placementId, req, claimsA, testSql, auditSql);
      expect(res.status, `role ${role} should return 201`).toBe(201);
    }
  });

  test('AC#5: POST with unknown role returns 422', async () => {
    const placementId = await createTestPlacement();

    const badRoles = ['admin', 'bd', 'recruiter', 'unknown', '', 'CLIENTORIGINATOR'];
    for (const role of badRoles) {
      const req = makeRequest({
        path: `/placements/${placementId}/contributors`,
        method: 'POST',
        body: {
          producer_id: crypto.randomUUID(),
          role,
          split_pct: 0.5,
        },
      });

      const res = await handleAddContributor(placementId, req, claimsA, testSql, auditSql);
      expect(res.status, `unknown role "${role}" should return 422`).toBe(422);
    }
  });
});

// ---------------------------------------------------------------------------
// AC#3 — GET /placements/:id/contributors returns all assigned contributors
// ---------------------------------------------------------------------------

describe('GET /placements/:id/contributors', () => {
  test('AC#3: returns all contributors with role and split_pct', async () => {
    const placementId = await createTestPlacement();

    // Add two contributors
    const producer1 = crypto.randomUUID();
    const producer2 = crypto.randomUUID();

    const req1 = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: { producer_id: producer1, role: 'ClientOriginator', split_pct: 0.6 },
    });
    await handleAddContributor(placementId, req1, claimsA, testSql, auditSql);

    const req2 = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: { producer_id: producer2, role: 'AccountOwner', split_pct: 0.4 },
    });
    await handleAddContributor(placementId, req2, claimsA, testSql, auditSql);

    // List contributors
    const listRes = await handleListContributors(placementId, claimsA, testSql);
    expect(listRes.status).toBe(200);

    const contributors = (await listRes.json()) as Record<string, unknown>[];
    expect(contributors.length).toBe(2);

    const c1 = contributors.find((c) => c.producer_id === producer1);
    const c2 = contributors.find((c) => c.producer_id === producer2);

    expect(c1).toBeDefined();
    expect(c1!.role).toBe('ClientOriginator');
    expect(Number(c1!.split_pct)).toBeCloseTo(0.6);

    expect(c2).toBeDefined();
    expect(c2!.role).toBe('AccountOwner');
    expect(Number(c2!.split_pct)).toBeCloseTo(0.4);
  });

  test('returns 404 when placement does not exist', async () => {
    const res = await handleListContributors(crypto.randomUUID(), claimsA, testSql);
    expect(res.status).toBe(404);
  });

  test('returns empty array for placement with no contributors', async () => {
    const placementId = await createTestPlacement();
    const res = await handleListContributors(placementId, claimsA, testSql);
    expect(res.status).toBe(200);
    const contributors = (await res.json()) as unknown[];
    expect(contributors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /placements/:id/contributors/:cid
// ---------------------------------------------------------------------------

describe('DELETE /placements/:id/contributors/:contributorId', () => {
  test('removes the contributor and returns 204', async () => {
    const placementId = await createTestPlacement();

    // Add a contributor
    const addReq = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: {
        producer_id: crypto.randomUUID(),
        role: 'JobOwner',
        split_pct: 1.0,
      },
    });
    const addRes = await handleAddContributor(placementId, addReq, claimsA, testSql, auditSql);
    expect(addRes.status).toBe(201);
    const added = (await addRes.json()) as Record<string, unknown>;
    const contributorId = added.id as string;

    // Delete the contributor
    const deleteRes = await handleDeleteContributor(
      placementId,
      contributorId,
      claimsA,
      testSql,
      auditSql,
    );
    expect(deleteRes.status).toBe(204);

    // Verify it is gone
    const listRes = await handleListContributors(placementId, claimsA, testSql);
    const remaining = (await listRes.json()) as unknown[];
    expect(remaining).toHaveLength(0);
  });

  test('returns 404 when contributor does not exist', async () => {
    const placementId = await createTestPlacement();
    const res = await handleDeleteContributor(
      placementId,
      crypto.randomUUID(),
      claimsA,
      testSql,
      auditSql,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — Split validation: finalize returns 422 when split ≠ 100%
// ---------------------------------------------------------------------------

describe('Split validation on finalization', () => {
  test('AC#2: finalize=true with split not summing to 1.0 returns 422', async () => {
    const placementId = await createTestPlacement();

    // Add first contributor with 0.6 split
    const req1 = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: { producer_id: crypto.randomUUID(), role: 'ClientOriginator', split_pct: 0.6 },
    });
    await handleAddContributor(placementId, req1, claimsA, testSql, auditSql);

    // Attempt to add second contributor with finalize=true, total would be 0.6 + 0.3 = 0.9
    const req2 = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: {
        producer_id: crypto.randomUUID(),
        role: 'AccountOwner',
        split_pct: 0.3,
        finalize: true,
      },
    });
    const res = await handleAddContributor(placementId, req2, claimsA, testSql, auditSql);
    expect(res.status).toBe(422);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  test('finalize=true with split summing to exactly 1.0 returns 201', async () => {
    const placementId = await createTestPlacement();

    // Add first contributor (0.6)
    const req1 = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: { producer_id: crypto.randomUUID(), role: 'ClientOriginator', split_pct: 0.6 },
    });
    await handleAddContributor(placementId, req1, claimsA, testSql, auditSql);

    // Add second contributor with finalize=true, total = 0.6 + 0.4 = 1.0 — should succeed
    const req2 = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: {
        producer_id: crypto.randomUUID(),
        role: 'AccountOwner',
        split_pct: 0.4,
        finalize: true,
      },
    });
    const res = await handleAddContributor(placementId, req2, claimsA, testSql, auditSql);
    expect(res.status).toBe(201);
  });

  test('adding a contributor without finalize=true does not validate split sum', async () => {
    const placementId = await createTestPlacement();

    // Add contributor with only 0.5 split — no finalize flag, should succeed
    const req = makeRequest({
      path: `/placements/${placementId}/contributors`,
      method: 'POST',
      body: { producer_id: crypto.randomUUID(), role: 'CandidateSourcer', split_pct: 0.5 },
    });
    const res = await handleAddContributor(placementId, req, claimsA, testSql, auditSql);
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Audit test: adding 3 contributors creates 3 AuditLogEntry rows
// ---------------------------------------------------------------------------

describe('Audit log creation', () => {
  test('AC#4: after adding 3 contributors, AuditLogEntry count for that placement is 3', async () => {
    const placementId = await createTestPlacement();

    const roles = ['ClientOriginator', 'AccountOwner', 'JobOwner'] as const;
    const splitPerContributor = 1 / 3;

    for (const role of roles) {
      const req = makeRequest({
        path: `/placements/${placementId}/contributors`,
        method: 'POST',
        body: {
          producer_id: crypto.randomUUID(),
          role,
          split_pct: splitPerContributor,
        },
      });
      const res = await handleAddContributor(placementId, req, claimsA, testSql, auditSql);
      expect(res.status).toBe(201);
    }

    // Query audit log entries for this placement
    const auditRows = await auditSql.unsafe(
      `
      SELECT COUNT(*) AS count
      FROM audit_log_entries
      WHERE org_id = $1
        AND entity_type = 'Contributor'
        AND action = 'ContributorAdded'
        AND after_json->>'placement_id' = $2
      `,
      [ORG_A_ID, placementId],
    );

    const count = Number((auditRows[0] as unknown as { count: string }).count);
    expect(count).toBe(3);
  });
});

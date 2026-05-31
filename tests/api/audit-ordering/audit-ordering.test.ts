/**
 * Audit-before-read ordering — integration tests (issue #81).
 *
 * Verifies the Superfield DATA blueprint's audit-log-before-sensitive-read
 * guarantee (DATA-D-010, DATA-P-008, IMPL-DATA-021):
 *
 *   1. A sensitive read writes a `commission_audit` (audit_log_entries) row
 *      BEFORE returning data — after a successful GET, the audit row exists.
 *   2. When the audit DB is unavailable (closed pool), the read is DENIED:
 *      the handler returns a non-2xx status and no data is returned.
 *
 * Uses ephemeral Postgres via pg-container (Docker required). All handlers are
 * called directly with injectable sql + auditSql clients.
 * No Vitest mocking helpers are used — real Postgres only (TEST-C-001).
 *
 * Canonical docs: docs/architecture.md — Audit Write Policy (audit-before-read)
 * Issue: feat: complete Superfield-adherence remediation (#81)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { FieldEncryptor } from '../../../packages/db/src/encryption';
import { LocalDevKmsAdapter } from '../../../packages/db/src/kms-dev';
import { _setEncryptorForTest, _resetEncryptorForTest } from '../../../packages/db/src/placements';
import {
  handleCreatePlacement,
  handleGetPlacement,
  handleListPlacements,
} from '../../../apps/server/src/api/placements';
import { sensitiveRead } from '../../../apps/server/src/audit/sensitive-read';
import type { SessionClaims } from 'core/auth';

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let auditSql: ReturnType<typeof postgres>;

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
  auditSql = postgres(pg.url, { max: 3 });

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });

  const enc = new FieldEncryptor(new LocalDevKmsAdapter());
  _setEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
  await testSql?.end({ timeout: 5 });
  await auditSql?.end({ timeout: 5 });
  await pg?.stop();
}, 30_000);

function makeRequest(opts: { path: string; method?: string; body?: unknown }): Request {
  return new Request(`http://localhost${opts.path}`, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function createPlacement(): Promise<string> {
  const res = await handleCreatePlacement(
    makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Senior Recruiter',
        compensation_base: '120000',
        fee_amount: '20000',
        start_date: '2025-04-01',
      },
    }),
    financeAdmin,
    testSql,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function countAuditRows(action: string, entityId: string): Promise<number> {
  const rows = await auditSql.unsafe(
    `SELECT COUNT(*)::int AS cnt FROM audit_log_entries WHERE action = $1 AND entity_id = $2`,
    [action, entityId],
  );
  return (rows[0] as unknown as { cnt: number }).cnt;
}

// ---------------------------------------------------------------------------
// 1. sensitiveRead writes the audit row before running the read body
// ---------------------------------------------------------------------------
describe('sensitiveRead — ordering', () => {
  test('audit row is written before the read body executes', async () => {
    const entityId = crypto.randomUUID();
    let auditCountAtReadTime = -1;

    await sensitiveRead(
      auditSql,
      {
        orgId: ORG_ID,
        actorId: financeAdmin.user_id,
        action: 'ordering.probe',
        entityType: 'probe',
        entityId,
      },
      async () => {
        // By the time the read body runs, the audit row must already be visible.
        auditCountAtReadTime = await countAuditRows('ordering.probe', entityId);
        return 'data';
      },
    );

    expect(auditCountAtReadTime).toBe(1);
  });

  test('read body is NOT executed when the audit write fails', async () => {
    const deadAudit = postgres('postgres://invalid:invalid@127.0.0.1:1/none', {
      max: 1,
      connect_timeout: 2,
    });
    let readRan = false;
    await expect(
      sensitiveRead(
        deadAudit,
        {
          orgId: ORG_ID,
          actorId: financeAdmin.user_id,
          action: 'ordering.deny',
          entityType: 'probe',
          entityId: crypto.randomUUID(),
        },
        async () => {
          readRan = true;
          return 'data';
        },
      ),
    ).rejects.toThrow();
    expect(readRan).toBe(false);
    await deadAudit.end({ timeout: 1 }).catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// 2. GET /placements/:id — audit-before-read on the real handler
// ---------------------------------------------------------------------------
describe('handleGetPlacement — audit-before-read', () => {
  test('a successful read records an audit row', async () => {
    const placementId = await createPlacement();
    const before = await countAuditRows('placement.read', placementId);

    const res = await handleGetPlacement(placementId, financeAdmin, testSql, auditSql);
    expect(res.status).toBe(200);

    const after = await countAuditRows('placement.read', placementId);
    expect(after).toBe(before + 1);
  });

  test('the read is DENIED when the audit DB is unavailable', async () => {
    const placementId = await createPlacement();
    const deadAudit = postgres('postgres://invalid:invalid@127.0.0.1:1/none', {
      max: 1,
      connect_timeout: 2,
    });

    const res = await handleGetPlacement(placementId, financeAdmin, testSql, deadAudit);

    // Read denied: non-2xx, and the body must not contain the placement data.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBeUndefined();
    expect(body.job_title).toBeUndefined();

    await deadAudit.end({ timeout: 1 }).catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// 3. GET /placements — list read is also gated
// ---------------------------------------------------------------------------
describe('handleListPlacements — audit-before-read', () => {
  test('the list read is DENIED when the audit DB is unavailable', async () => {
    const deadAudit = postgres('postgres://invalid:invalid@127.0.0.1:1/none', {
      max: 1,
      connect_timeout: 2,
    });

    const res = await handleListPlacements(
      makeRequest({ path: '/placements' }),
      financeAdmin,
      testSql,
      deadAudit,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);

    await deadAudit.end({ timeout: 1 }).catch(() => {});
  });
});

/**
 * GET /commission-runs list endpoint — integration tests (#203).
 *
 * Backs the Finance run picker: instead of pasting a run UUID, the user clicks
 * a recent run. The endpoint returns the caller-visible runs (newest first)
 * with id, status, period and created_at.
 *
 * Acceptance criteria (#203):
 *   - Returns the caller-visible run list with id, status, created_at.
 *   - Includes an empty-list case (org with no runs).
 *   - RBAC: FinanceAdmin/Executive allowed; other roles 403.
 *   - Multi-tenant isolation: a run from org B is never returned to org A.
 *
 * Uses ephemeral Postgres via pg-container (Docker required). The handler is
 * called directly with an injectable sql client. No vi.fn / vi.mock / vi.spyOn
 * (TEST-C-001).
 *
 * Issue: feat: webapp — UX overhaul: entity pickers, design-system pass (#203)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { handleListCommissionRuns } from '../../../apps/server/src/api/commission-runs';
import type { SessionClaims } from 'core/auth';
import type { AppRole } from 'core/auth';

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const USER_A_ID = crypto.randomUUID();
const ORG_B_ID = crypto.randomUUID();
const USER_B_ID = crypto.randomUUID();

function claims(orgId: string, userId: string, role: AppRole): SessionClaims {
  return {
    org_id: orgId,
    user_id: userId,
    role,
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

const financeA = claims(ORG_A_ID, USER_A_ID, 'FinanceAdmin');

async function jsonBody(res: Response): Promise<{ commission_runs?: unknown[]; error?: string }> {
  return JSON.parse(await res.text());
}

/** Insert a commission_runs row directly and return its id. */
async function insertRun(opts: {
  orgId: string;
  createdBy: string;
  status: string;
  periodStart: string;
  periodEnd: string;
}): Promise<string> {
  const rows = (await testSql.unsafe(
    `
    INSERT INTO commission_runs (org_id, period_start, period_end, status, created_by)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
    `,
    [opts.orgId, opts.periodStart, opts.periodEnd, opts.status, opts.createdBy],
  )) as unknown as { id: string }[];
  return rows[0].id;
}

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });
}, 120_000);

afterAll(async () => {
  await testSql?.end({ timeout: 5 });
  await pg?.stop();
}, 30_000);

describe('GET /commission-runs — list endpoint', () => {
  test('returns an empty list for an org with no runs', async () => {
    const res = await handleListCommissionRuns(financeA, testSql);
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(Array.isArray(body.commission_runs)).toBe(true);
    expect(body.commission_runs).toHaveLength(0);
  });

  test('returns caller-visible runs with id, status, period and created_at, newest first', async () => {
    const older = await insertRun({
      orgId: ORG_A_ID,
      createdBy: USER_A_ID,
      status: 'Open',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
    });
    // Ensure a distinct, later created_at for ordering.
    await new Promise((r) => setTimeout(r, 10));
    const newer = await insertRun({
      orgId: ORG_A_ID,
      createdBy: USER_A_ID,
      status: 'Approved',
      periodStart: '2025-02-01',
      periodEnd: '2025-02-28',
    });

    const res = await handleListCommissionRuns(financeA, testSql);
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    const runs = body.commission_runs as Record<string, unknown>[];
    expect(runs.length).toBe(2);

    // Newest first.
    expect(runs[0].id).toBe(newer);
    expect(runs[1].id).toBe(older);

    // Shape of the first row.
    const first = runs[0];
    expect(first.status).toBe('Approved');
    expect(first.period_start).toBe('2025-02-01');
    expect(first.period_end).toBe('2025-02-28');
    expect(typeof first.created_at).toBe('string');
    expect(first.record_count).toBe(0);
  });

  test('does not return runs from another org (tenant isolation)', async () => {
    await insertRun({
      orgId: ORG_B_ID,
      createdBy: USER_B_ID,
      status: 'Open',
      periodStart: '2025-03-01',
      periodEnd: '2025-03-31',
    });
    const res = await handleListCommissionRuns(financeA, testSql);
    const body = await jsonBody(res);
    const runs = body.commission_runs as Record<string, unknown>[];
    // Org A still has exactly its own two runs; org B's run is not present.
    expect(runs.every((r) => r.period_start !== '2025-03-01')).toBe(true);
  });

  test('Executive may list runs', async () => {
    const exec = claims(ORG_A_ID, crypto.randomUUID(), 'Executive');
    const res = await handleListCommissionRuns(exec, testSql);
    expect(res.status).toBe(200);
  });

  test('non-finance roles are forbidden', async () => {
    for (const role of ['Producer', 'Manager', 'HR', 'ExternalPartner'] as AppRole[]) {
      const res = await handleListCommissionRuns(
        claims(ORG_A_ID, crypto.randomUUID(), role),
        testSql,
      );
      expect(res.status).toBe(403);
    }
  });
});

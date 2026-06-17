/**
 * simulation_run persistence + TTL reaper tests — issue #262.
 *
 * Uses ephemeral Postgres via pg-container (Docker required). Covers:
 *   - insertSimulationRun stamps a 30-day TTL and starts with null result_json
 *   - setSimulationRunResult persists the worker forecast (org-scoped)
 *   - listSimulationRunsByProducer is scoped to (org_id, producer_id)
 *   - reapExpiredSimulationRuns removes rows past ttl_expires_at (TTL job)
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from '../pg-container';
import {
  migrate,
  insertSimulationRun,
  setSimulationRunResult,
  listSimulationRunsByProducer,
  getSimulationRunById,
  reapExpiredSimulationRuns,
  computeSimulationRunTtl,
  SIMULATION_RUN_TTL_SECONDS,
} from '../index';

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;

const ORG_A = crypto.randomUUID();
const ORG_B = crypto.randomUUID();
const PRODUCER_1 = crypto.randomUUID();
const PRODUCER_2 = crypto.randomUUID();

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 5 });
  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: null, analyticsDatabaseUrl: null });
}, 120_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await pg?.stop();
});

describe('simulation_run persistence', () => {
  test('TTL default is 30 days', () => {
    expect(SIMULATION_RUN_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    const now = new Date('2026-01-01T00:00:00Z');
    expect(computeSimulationRunTtl(now).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  test('insert starts with null result_json and a future TTL', async () => {
    const run = await insertSimulationRun(
      { orgId: ORG_A, producerId: PRODUCER_1, inputParams: { kind: 'actual', deal_id: 'd1' } },
      sql,
    );
    expect(run.result_json).toBeNull();
    expect(new Date(run.ttl_expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(run.input_params).toMatchObject({ kind: 'actual', deal_id: 'd1' });
  });

  test('setSimulationRunResult persists the forecast (org-scoped)', async () => {
    const run = await insertSimulationRun(
      { orgId: ORG_A, producerId: PRODUCER_1, inputParams: { kind: 'actual' } },
      sql,
    );
    // Wrong org cannot write the result.
    const wrongOrg = await setSimulationRunResult(
      {
        id: run.id,
        orgId: ORG_B,
        result: { payout_estimate: 1, dispute_risk: 'low', reasoning: 'x' },
      },
      sql,
    );
    expect(wrongOrg).toBeNull();

    const updated = await setSimulationRunResult(
      {
        id: run.id,
        orgId: ORG_A,
        result: { payout_estimate: 5000, dispute_risk: 'low', reasoning: 'Plan v1 25% rate.' },
      },
      sql,
    );
    expect(updated?.result_json).toMatchObject({ payout_estimate: 5000, dispute_risk: 'low' });

    const fetched = await getSimulationRunById(run.id, sql);
    expect(fetched?.result_json).toMatchObject({ payout_estimate: 5000 });
  });

  test('listSimulationRunsByProducer is scoped to (org, producer)', async () => {
    await insertSimulationRun(
      { orgId: ORG_A, producerId: PRODUCER_2, inputParams: { tag: 'p2-a' } },
      sql,
    );
    await insertSimulationRun(
      { orgId: ORG_B, producerId: PRODUCER_2, inputParams: { tag: 'p2-b' } },
      sql,
    );
    const p2OrgA = await listSimulationRunsByProducer(ORG_A, PRODUCER_2, sql);
    expect(p2OrgA.every((r) => r.org_id === ORG_A && r.producer_id === PRODUCER_2)).toBe(true);
    expect(p2OrgA.some((r) => (r.input_params as { tag?: string }).tag === 'p2-a')).toBe(true);
    expect(p2OrgA.some((r) => (r.input_params as { tag?: string }).tag === 'p2-b')).toBe(false);
  });
});

describe('reapExpiredSimulationRuns (TTL job)', () => {
  test('removes rows past ttl_expires_at and keeps live rows', async () => {
    const expiredOrg = crypto.randomUUID();
    const expired = await insertSimulationRun(
      {
        orgId: expiredOrg,
        producerId: PRODUCER_1,
        inputParams: { tag: 'expired' },
        ttlExpiresAt: new Date(Date.now() - 1000),
      },
      sql,
    );
    const live = await insertSimulationRun(
      {
        orgId: expiredOrg,
        producerId: PRODUCER_1,
        inputParams: { tag: 'live' },
        ttlExpiresAt: new Date(Date.now() + 60_000),
      },
      sql,
    );

    const removed = await reapExpiredSimulationRuns(sql);
    expect(removed).toBeGreaterThanOrEqual(1);

    expect(await getSimulationRunById(expired.id, sql)).toBeNull();
    expect(await getSimulationRunById(live.id, sql)).not.toBeNull();
  });
});

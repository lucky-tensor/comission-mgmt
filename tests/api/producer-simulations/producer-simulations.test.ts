/**
 * Producer Deal Simulator — API integration tests (issue #262).
 *
 * Exercises the real handlers against an ephemeral Postgres container (no
 * subprocess / Claude CLI — the worker is tested separately). Covers:
 *   - POST /producer/simulations/actual enqueues + returns a pending envelope
 *     (no 403 / 501) for the producer's own deal.
 *   - Producer scope: another producer's deal_id → 403.
 *   - POST /producer/simulations/hypothetical returns a pending envelope.
 *   - GET /producer/simulations is scoped to the caller only.
 *   - Delegated-result write path persists result_json + writes an AuditLogEntry;
 *     the single-use token cannot be replayed.
 *   - Read-only guarantee: placement/commission/payout rows are unchanged by a run.
 *   - Concurrency: two producers simulate simultaneously with independent results.
 *
 * No Vitest mocking helpers — real Postgres only (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.9, §5.12, §9; docs/arbitration-simulation.md
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { FieldEncryptor } from '../../../packages/db/src/encryption';
import { LocalDevKmsAdapter } from '../../../packages/db/src/kms-dev';
import { _setEncryptorForTest, _resetEncryptorForTest } from '../../../packages/db/src/placements';
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
import { handleAddContributor } from '../../../apps/server/src/api/contributors';
import {
  handleCreatePlan,
  handleActivatePlanVersion,
  handleCreatePlanAssignment,
} from '../../../apps/server/src/api/plans';
import {
  handleCreateActualSimulation,
  handleCreateHypotheticalSimulation,
  handleListMySimulations,
  handleSubmitSimulationResult,
} from '../../../apps/server/src/api/simulations';
import type { SessionClaims } from 'core/auth';

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let testAuditSql: ReturnType<typeof postgres>;

const ORG_A = crypto.randomUUID();

const financeAdmin: SessionClaims = {
  org_id: ORG_A,
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function producer(userId: string): SessionClaims {
  return {
    org_id: ORG_A,
    user_id: userId,
    role: 'Producer',
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

const PRODUCER_A = producer(crypto.randomUUID());
const PRODUCER_B = producer(crypto.randomUUID());

function jsonReq(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Create an Active placement with a producer contributor, returning its id. */
async function seedDeal(producerId: string, planVersionId: string): Promise<string> {
  void planVersionId;
  const placementRes = await handleCreatePlacement(
    jsonReq('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Recruiter',
      compensation_base: '120000',
      fee_amount: '20000',
      start_date: '2026-01-01',
      guarantee_days: null,
    }),
    financeAdmin,
    testSql,
  );
  const placement = (await placementRes.json()) as { id: string };
  await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placement.id]);
  await handleAddContributor(
    placement.id,
    jsonReq(`/placements/${placement.id}/contributors`, {
      producer_id: producerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
    }),
    financeAdmin,
    testSql,
  );
  return placement.id;
}

let dealA: string;
let dealB: string;
let planVersionId: string;

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 8 });
  testAuditSql = postgres(pg.url, { max: 3 });
  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });

  const enc = new FieldEncryptor(new LocalDevKmsAdapter());
  _setEncryptorForTest(enc);

  // A plan + active version assigned to both producers so the forecast can be
  // traced to the producer's plan version (explainability).
  const planRes = await handleCreatePlan(
    jsonReq('/plans', {
      name: 'Sim Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.25 },
    }),
    financeAdmin,
    testSql,
  );
  const plan = (await planRes.json()) as { plan: { id: string }; version: { id: string } };
  planVersionId = plan.version.id;
  await handleActivatePlanVersion(plan.plan.id, plan.version.id, financeAdmin, testSql);
  await handleCreatePlanAssignment(
    plan.plan.id,
    jsonReq(`/plans/${plan.plan.id}/assignments`, {
      producer_id: PRODUCER_A.user_id,
      plan_version_id: plan.version.id,
    }),
    financeAdmin,
    testSql,
  );
  await handleCreatePlanAssignment(
    plan.plan.id,
    jsonReq(`/plans/${plan.plan.id}/assignments`, {
      producer_id: PRODUCER_B.user_id,
      plan_version_id: plan.version.id,
    }),
    financeAdmin,
    testSql,
  );

  dealA = await seedDeal(PRODUCER_A.user_id, planVersionId);
  dealB = await seedDeal(PRODUCER_B.user_id, planVersionId);
}, 180_000);

afterAll(async () => {
  _resetEncryptorForTest();
  await testSql?.end({ timeout: 5 });
  await testAuditSql?.end({ timeout: 5 });
  await pg?.stop();
});

describe('POST /producer/simulations/actual', () => {
  test('enqueues a forecast for own deal (no 403 / 501)', async () => {
    const res = await handleCreateActualSimulation(
      jsonReq('/producer/simulations/actual', { deal_id: dealA }),
      PRODUCER_A,
      testSql,
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      status: string;
      simulation_id: string;
      job_id: string;
      result_token: string;
    };
    expect(body.status).toBe('pending');
    expect(body.simulation_id).toBeTruthy();
    expect(body.job_id).toBeTruthy();
    expect(body.result_token).toBeTruthy();

    // A simulation_run row exists, scoped to the producer.
    const rows = await testSql<{ producer_id: string; org_id: string }[]>`
      SELECT producer_id, org_id FROM simulation_run WHERE id = ${body.simulation_id}
    `;
    expect(rows[0]?.producer_id).toBe(PRODUCER_A.user_id);
    expect(rows[0]?.org_id).toBe(ORG_A);
  });

  test("another producer's deal_id returns 403", async () => {
    const res = await handleCreateActualSimulation(
      jsonReq('/producer/simulations/actual', { deal_id: dealB }),
      PRODUCER_A,
      testSql,
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /producer/simulations/hypothetical', () => {
  test('returns a pending envelope', async () => {
    const res = await handleCreateHypotheticalSimulation(
      jsonReq('/producer/simulations/hypothetical', {
        amount: 80000,
        tier: 'senior',
        bonus_season_flag: true,
        accrual_percent: 5,
      }),
      PRODUCER_A,
      testSql,
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; simulation_id: string };
    expect(body.status).toBe('pending');
    expect(body.simulation_id).toBeTruthy();
  });
});

describe('GET /producer/simulations', () => {
  test('is scoped to the caller only', async () => {
    // Producer B enqueues a run; Producer A must not see it.
    await handleCreateActualSimulation(
      jsonReq('/producer/simulations/actual', { deal_id: dealB }),
      PRODUCER_B,
      testSql,
    );

    const resA = await handleListMySimulations(
      jsonReq('/producer/simulations'),
      PRODUCER_A,
      testSql,
    );
    const bodyA = (await resA.json()) as {
      simulation_runs: Array<{ producer_id: string }>;
    };
    expect(bodyA.simulation_runs.every((r) => r.producer_id === PRODUCER_A.user_id)).toBe(true);

    const resB = await handleListMySimulations(
      jsonReq('/producer/simulations'),
      PRODUCER_B,
      testSql,
    );
    const bodyB = (await resB.json()) as {
      simulation_runs: Array<{ producer_id: string }>;
    };
    expect(bodyB.simulation_runs.every((r) => r.producer_id === PRODUCER_B.user_id)).toBe(true);
    expect(bodyB.simulation_runs.length).toBeGreaterThan(0);
  });
});

describe('delegated-result write path', () => {
  test('persists result_json + audit entry; token is single-use; read-only', async () => {
    // Snapshot production tables before the run (read-only guarantee).
    const before = await testSql<{ c: string }[]>`
      SELECT
        (SELECT count(*) FROM placements) || ':' ||
        (SELECT count(*) FROM commission_records) || ':' ||
        (SELECT count(*) FROM commission_run_records) AS c
    `;

    const enqueueRes = await handleCreateActualSimulation(
      jsonReq('/producer/simulations/actual', { deal_id: dealA }),
      PRODUCER_A,
      testSql,
    );
    const enqueued = (await enqueueRes.json()) as { simulation_id: string; result_token: string };

    const submit = await handleSubmitSimulationResult(
      enqueued.simulation_id,
      new Request(`http://localhost/producer/simulations/${enqueued.simulation_id}/result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${enqueued.result_token}`,
        },
        body: JSON.stringify({
          payout_estimate: 5000,
          dispute_risk: 'low',
          reasoning: 'Sim Plan 25% gross-fee on the $20,000 fee yields $5,000.',
        }),
      }),
      testSql,
      testAuditSql,
    );
    expect(submit.status).toBe(200);

    // result_json persisted and visible to the producer.
    const list = await handleListMySimulations(
      jsonReq('/producer/simulations'),
      PRODUCER_A,
      testSql,
    );
    const body = (await list.json()) as {
      simulation_runs: Array<{ id: string; result_json: { payout_estimate: number } | null }>;
    };
    const run = body.simulation_runs.find((r) => r.id === enqueued.simulation_id);
    expect(run?.result_json?.payout_estimate).toBe(5000);

    // AuditLogEntry written with a correlation id.
    const audit = await testAuditSql<{ action: string; after_json: Record<string, unknown> }[]>`
      SELECT action, after_json FROM audit_log_entries
      WHERE entity_type = 'simulation_run' AND entity_id = ${enqueued.simulation_id}
    `;
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe('simulation.completed');
    expect(audit[0].after_json['correlation_id']).toBeTruthy();

    // Token is single-use: replay is rejected.
    const replay = await handleSubmitSimulationResult(
      enqueued.simulation_id,
      new Request(`http://localhost/producer/simulations/${enqueued.simulation_id}/result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${enqueued.result_token}`,
        },
        body: JSON.stringify({ payout_estimate: 1, dispute_risk: 'high', reasoning: 'replay' }),
      }),
      testSql,
      testAuditSql,
    );
    expect(replay.status).toBe(403);

    // Read-only: production tables unchanged by the simulation lifecycle.
    const after = await testSql<{ c: string }[]>`
      SELECT
        (SELECT count(*) FROM placements) || ':' ||
        (SELECT count(*) FROM commission_records) || ':' ||
        (SELECT count(*) FROM commission_run_records) AS c
    `;
    expect(after[0].c).toBe(before[0].c);
  });

  test('rejects a token bound to a different simulation', async () => {
    const e1 = (await (
      await handleCreateActualSimulation(
        jsonReq('/producer/simulations/actual', { deal_id: dealA }),
        PRODUCER_A,
        testSql,
      )
    ).json()) as { simulation_id: string; result_token: string };
    const e2 = (await (
      await handleCreateActualSimulation(
        jsonReq('/producer/simulations/actual', { deal_id: dealA }),
        PRODUCER_A,
        testSql,
      )
    ).json()) as { simulation_id: string };

    // Submit e1's token against e2's id → bound-token rejection.
    const res = await handleSubmitSimulationResult(
      e2.simulation_id,
      new Request(`http://localhost/producer/simulations/${e2.simulation_id}/result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${e1.result_token}`,
        },
        body: JSON.stringify({ payout_estimate: 1, dispute_risk: 'low', reasoning: 'x' }),
      }),
      testSql,
      testAuditSql,
    );
    expect(res.status).toBe(403);
  });
});

describe('concurrency', () => {
  test('two producers simulate simultaneously with independent results', async () => {
    const [rA, rB] = await Promise.all([
      handleCreateActualSimulation(
        jsonReq('/producer/simulations/actual', { deal_id: dealA }),
        PRODUCER_A,
        testSql,
      ),
      handleCreateActualSimulation(
        jsonReq('/producer/simulations/actual', { deal_id: dealB }),
        PRODUCER_B,
        testSql,
      ),
    ]);
    expect(rA.status).toBe(202);
    expect(rB.status).toBe(202);
    const bA = (await rA.json()) as { simulation_id: string; result_token: string };
    const bB = (await rB.json()) as { simulation_id: string; result_token: string };
    expect(bA.simulation_id).not.toBe(bB.simulation_id);

    await Promise.all([
      handleSubmitSimulationResult(
        bA.simulation_id,
        new Request(`http://localhost/producer/simulations/${bA.simulation_id}/result`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bA.result_token}`,
          },
          body: JSON.stringify({ payout_estimate: 100, dispute_risk: 'low', reasoning: 'A' }),
        }),
        testSql,
        testAuditSql,
      ),
      handleSubmitSimulationResult(
        bB.simulation_id,
        new Request(`http://localhost/producer/simulations/${bB.simulation_id}/result`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bB.result_token}`,
          },
          body: JSON.stringify({ payout_estimate: 200, dispute_risk: 'high', reasoning: 'B' }),
        }),
        testSql,
        testAuditSql,
      ),
    ]);

    const aRuns = (await (
      await handleListMySimulations(jsonReq('/producer/simulations'), PRODUCER_A, testSql)
    ).json()) as {
      simulation_runs: Array<{ id: string; result_json: { payout_estimate: number } | null }>;
    };
    const bRuns = (await (
      await handleListMySimulations(jsonReq('/producer/simulations'), PRODUCER_B, testSql)
    ).json()) as {
      simulation_runs: Array<{ id: string; result_json: { payout_estimate: number } | null }>;
    };

    expect(
      aRuns.simulation_runs.find((r) => r.id === bA.simulation_id)?.result_json?.payout_estimate,
    ).toBe(100);
    expect(
      bRuns.simulation_runs.find((r) => r.id === bB.simulation_id)?.result_json?.payout_estimate,
    ).toBe(200);
  });
});

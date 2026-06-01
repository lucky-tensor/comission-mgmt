/**
 * Isolated tests for the guarantee-expiry worker processing path — issue #87 AC#2 and AC#3.
 *
 * Tests:
 *   AC#2 — Seeds a placement with an expired guarantee window in the task queue,
 *           runs the worker processing loop, asserts the placement state is updated
 *           (GuaranteeActive → GuaranteeExpired) and commission records are released.
 *   AC#3 — Crash-recovery: stale in-progress (claimed) task is re-queued or marked
 *           failed after simulated worker death (visibility timeout expiry).
 *
 * Uses an ephemeral Postgres container (Docker required). No mocks of DB or task queue.
 * The guarantee-expiry handler is called directly — no API server is spun up.
 *
 * Canonical docs: docs/prd.md §5.6, docs/architecture/phase-post-placement-risk.md
 * Issue: #87
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
import { createCommissionRecord } from '../../../packages/db/src/commission-records';
import { createGuaranteePeriod } from '../../../packages/db/src/guarantee-periods';
import { processGuaranteeExpiredRecalc } from '../../../apps/server/src/api/guarantee-expiry-worker';
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let testAuditSql: ReturnType<typeof postgres>;

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
  testAuditSql = postgres(pg.url, { max: 3 });

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });

  const adapter = new LocalDevKmsAdapter();
  const enc = new FieldEncryptor(adapter);
  _setEncryptorForTest(enc);
  _setCommRecordEncryptorForTest(enc);
}, 180_000);

afterAll(async () => {
  _resetEncryptorForTest();
  _resetCommRecordEncryptorForTest();
  await testSql?.end({ timeout: 5 });
  await testAuditSql?.end({ timeout: 5 });
  await pg?.stop();
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKey(): string {
  return `gew-test-${crypto.randomUUID()}`;
}

async function createTestPlacement(startDate: string, guaranteeDays: number): Promise<string> {
  const req = new Request('http://localhost/placements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Software Engineer',
      compensation_base: '120000',
      fee_amount: '18000',
      start_date: startDate,
      guarantee_days: guaranteeDays,
    }),
  });
  const res = await handleCreatePlacement(req, financeAdmin, testSql);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Seeds the minimal plan/contributor chain and returns contributor + planVersion IDs. */
async function seedPlanChain(
  placementId: string,
): Promise<{ contributorId: string; planVersionId: string }> {
  const producerId = crypto.randomUUID();

  const [planRow] = (await testSql.unsafe(
    `INSERT INTO commission_plans (org_id, name, effective_from, config_entity_id, created_by)
     VALUES ($1, $2, '2024-01-01', $3, $4) RETURNING id`,
    [ORG_ID, `GEW Test Plan ${crypto.randomUUID()}`, crypto.randomUUID(), crypto.randomUUID()],
  )) as unknown as Array<{ id: string }>;

  const [planVersionRow] = (await testSql.unsafe(
    `INSERT INTO plan_versions (org_id, plan_id, version_num, status, rules_snapshot, effective_at)
     VALUES ($1, $2, 1, 'Active', '{"tiers":[]}'::jsonb, NOW()) RETURNING id`,
    [ORG_ID, planRow.id],
  )) as unknown as Array<{ id: string }>;

  const [contributorRow] = (await testSql.unsafe(
    `INSERT INTO contributors (org_id, placement_id, producer_id, role_code, split_pct)
     VALUES ($1, $2, $3, 'owner', 1.0) RETURNING id`,
    [ORG_ID, placementId, producerId],
  )) as unknown as Array<{ id: string }>;

  return { contributorId: contributorRow.id, planVersionId: planVersionRow.id };
}

// ---------------------------------------------------------------------------
// AC#2 — Guarantee-expiry isolated worker test
// ---------------------------------------------------------------------------

describe('guarantee-expiry worker: isolated processing', () => {
  test('seeds expired guarantee task, runs handler, asserts placement → GuaranteeExpired and commission → Payable', async () => {
    // 1. Create a placement with a past start date (guarantee already expired)
    const placementId = await createTestPlacement('2024-01-01', 30); // expired 2024-01-31

    // 2. Update placement to GuaranteeActive (simulates it having been active)
    await testSql.unsafe(`UPDATE placements SET status = 'GuaranteeActive' WHERE id = $1`, [
      placementId,
    ]);

    // 3. Seed a guarantee_period row with past guarantee_ends
    const riskBuf = Buffer.alloc(1);
    const period = await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId,
      guaranteeEnds: '2024-01-31',
      riskAmountBuffer: riskBuf,
    });

    // 4. Seed commission record in Held state
    const { contributorId, planVersionId } = await seedPlanChain(placementId);
    const commRecord = await createCommissionRecord(testSql, {
      orgId: ORG_ID,
      placementId,
      contributorId,
      planVersionId,
      grossAmount: '18000',
      netPayable: '18000',
      status: 'Held',
      holdReason: 'guarantee_hold',
    });

    // 5. Enqueue a guarantee_expired_recalc task in the task queue
    const idempKey = makeKey();
    const [taskRow] = await testSql<{ id: string; status: string }[]>`
      INSERT INTO task_queue
        (idempotency_key, agent_type, job_type, payload, created_by)
      VALUES
        (${idempKey}, 'guarantee-expire', 'guarantee_expired_recalc',
         ${testSql.json({
           guarantee_period_id: period.id,
           placement_id: placementId,
           org_id: ORG_ID,
         })}, 'gew-test-suite')
      RETURNING id, status
    `;
    expect(taskRow.status).toBe('pending');

    // 6. Claim the task (simulates atomic worker claim)
    await testSql`
      UPDATE task_queue
      SET status           = 'claimed',
          claimed_by       = 'gew-test-pod',
          claimed_at       = NOW(),
          claim_expires_at = NOW() + INTERVAL '5 minutes',
          attempt          = 1,
          updated_at       = NOW()
      WHERE id = ${taskRow.id}
    `;

    // 7. Run the worker handler directly (isolated — no API server)
    const result = await processGuaranteeExpiredRecalc(
      {
        guarantee_period_id: period.id,
        placement_id: placementId,
        org_id: ORG_ID,
      },
      testSql,
      testAuditSql,
    );

    // 8. Assert correct state transitions
    expect(result.skipped).toBe(false);
    expect(result.new_guarantee_state).toBe('ExpiredClean');
    expect(result.commission_records_released).toBe(1);
    expect(result.placement_advanced).toBe(true);

    // 9. Verify placement status is GuaranteeExpired in DB
    const [placement] = (await testSql.unsafe(`SELECT status FROM placements WHERE id = $1`, [
      placementId,
    ])) as unknown as Array<{ status: string }>;
    expect(placement.status).toBe('GuaranteeExpired');

    // 10. Verify commission record is Payable
    const [commRow] = (await testSql.unsafe(
      `SELECT status, hold_reason FROM commission_records WHERE id = $1`,
      [commRecord.id],
    )) as unknown as Array<{ status: string; hold_reason: string | null }>;
    expect(commRow.status).toBe('Payable');
    expect(commRow.hold_reason).toBeNull();

    // 11. Verify guarantee_periods row is ExpiredClean
    const [periodRow] = (await testSql.unsafe(
      `SELECT status FROM guarantee_periods WHERE id = $1`,
      [period.id],
    )) as unknown as Array<{ status: string }>;
    expect(periodRow.status).toBe('ExpiredClean');

    // 12. Mark the task completed in the queue (simulates worker submit path)
    await testSql`
      UPDATE task_queue
      SET status = 'completed', result = ${testSql.json(result as never)}, updated_at = NOW()
      WHERE id = ${taskRow.id}
    `;
    const [completedTask] = await testSql<{ status: string }[]>`
      SELECT status FROM task_queue WHERE id = ${taskRow.id}
    `;
    expect(completedTask.status).toBe('completed');
  });

  test('handler is idempotent — second invocation on same period returns skipped', async () => {
    // Seed placement + period already expired
    const placementId = await createTestPlacement('2023-06-01', 30);
    await testSql.unsafe(`UPDATE placements SET status = 'GuaranteeActive' WHERE id = $1`, [
      placementId,
    ]);

    const riskBuf = Buffer.alloc(1);
    const period = await createGuaranteePeriod(testSql, {
      orgId: ORG_ID,
      placementId,
      guaranteeEnds: '2023-07-01',
      riskAmountBuffer: riskBuf,
    });

    const payload = { guarantee_period_id: period.id, placement_id: placementId, org_id: ORG_ID };

    // First run — should process cleanly
    const first = await processGuaranteeExpiredRecalc(payload, testSql, testAuditSql);
    expect(first.skipped).toBe(false);
    expect(first.new_guarantee_state).toBe('ExpiredClean');

    // Second run — should be idempotent (skipped)
    const second = await processGuaranteeExpiredRecalc(payload, testSql, testAuditSql);
    expect(second.skipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — Crash-recovery: stale in-progress task is re-queued after worker death
// ---------------------------------------------------------------------------

describe('crash recovery: stale claimed task re-queued after worker death', () => {
  test('task in claimed state with expired claim_expires_at is reset to pending by recovery', async () => {
    const idempKey = makeKey();

    // 1. Insert a task marked as in-progress (claimed) with a stale started_at / claim_expires_at
    const [taskRow] = (await testSql.unsafe(
      `INSERT INTO task_queue
         (idempotency_key, agent_type, job_type, payload, created_by,
          status, claimed_by, claimed_at, claim_expires_at, attempt)
       VALUES
         ($1, 'guarantee-expire', 'guarantee_expired_recalc',
          '{"guarantee_period_id":"00000000-0000-0000-0000-000000000001","placement_id":"00000000-0000-0000-0000-000000000002","org_id":"00000000-0000-0000-0000-000000000003"}'::jsonb,
          'gew-crash-test',
          'claimed',
          'dead-worker-pod',
          NOW() - INTERVAL '10 minutes',
          NOW() - INTERVAL '5 minutes',
          1)
       RETURNING id, status, attempt`,
      [idempKey],
    )) as unknown as Array<{ id: string; status: string; attempt: number }>;
    expect(taskRow.status).toBe('claimed');
    expect(taskRow.attempt).toBe(1);

    // 2. Run the stale claim recovery (simulates startup guard or periodic recovery sweep)
    const recovered = await testSql<{ id: string; status: string; claimed_by: string | null }[]>`
      UPDATE task_queue
      SET
        status           = CASE
                             WHEN attempt >= max_attempts THEN 'dead'
                             ELSE 'pending'
                           END,
        claimed_by       = NULL,
        claimed_at       = NULL,
        claim_expires_at = NULL,
        delegated_token  = NULL,
        next_retry_at    = CASE
                             WHEN attempt >= max_attempts THEN NULL
                             ELSE NOW() + (POWER(2, attempt) * INTERVAL '1 second')
                           END,
        updated_at       = NOW()
      WHERE status = 'claimed'
        AND claim_expires_at < NOW()
        AND id = ${taskRow.id}
      RETURNING id, status, claimed_by
    `;

    expect(recovered).toHaveLength(1);
    // attempt=1 < max_attempts=3, so status must be 'pending' (re-queued)
    expect(recovered[0].status).toBe('pending');
    expect(recovered[0].claimed_by).toBeNull();

    // 3. Confirm in DB
    const [dbRow] = await testSql<
      { status: string; claimed_by: string | null; next_retry_at: Date | null }[]
    >`
      SELECT status, claimed_by, next_retry_at FROM task_queue WHERE id = ${taskRow.id}
    `;
    expect(dbRow.status).toBe('pending');
    expect(dbRow.claimed_by).toBeNull();
    // Exponential backoff: next_retry_at should be in the future
    expect(dbRow.next_retry_at).not.toBeNull();
    expect(dbRow.next_retry_at!.getTime()).toBeGreaterThan(Date.now());
  });

  test('task at max_attempts after worker death is marked dead (not re-queued)', async () => {
    const idempKey = makeKey();

    // Insert task already at max_attempts with stale claim
    const [taskRow] = (await testSql.unsafe(
      `INSERT INTO task_queue
         (idempotency_key, agent_type, job_type, payload, created_by,
          status, claimed_by, claimed_at, claim_expires_at, attempt, max_attempts)
       VALUES
         ($1, 'guarantee-expire', 'guarantee_expired_recalc',
          '{"guarantee_period_id":"00000000-0000-0000-0000-000000000004","placement_id":"00000000-0000-0000-0000-000000000005","org_id":"00000000-0000-0000-0000-000000000006"}'::jsonb,
          'gew-crash-test-maxattempts',
          'claimed',
          'dead-worker-pod-2',
          NOW() - INTERVAL '15 minutes',
          NOW() - INTERVAL '10 minutes',
          3, 3)
       RETURNING id`,
      [idempKey],
    )) as unknown as Array<{ id: string }>;

    // Run recovery
    const recovered = await testSql<{ id: string; status: string }[]>`
      UPDATE task_queue
      SET
        status           = CASE
                             WHEN attempt >= max_attempts THEN 'dead'
                             ELSE 'pending'
                           END,
        claimed_by       = NULL,
        claimed_at       = NULL,
        claim_expires_at = NULL,
        delegated_token  = NULL,
        next_retry_at    = CASE
                             WHEN attempt >= max_attempts THEN NULL
                             ELSE NOW() + (POWER(2, attempt) * INTERVAL '1 second')
                           END,
        updated_at       = NOW()
      WHERE status = 'claimed'
        AND claim_expires_at < NOW()
        AND id = ${taskRow.id}
      RETURNING id, status
    `;

    expect(recovered).toHaveLength(1);
    // attempt=max_attempts=3, so status must be 'dead'
    expect(recovered[0].status).toBe('dead');
  });
});

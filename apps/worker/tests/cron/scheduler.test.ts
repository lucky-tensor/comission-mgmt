/**
 * Cron scheduler integration tests — scheduler wiring, job registration, and
 * guarantee-expiry dispatch against real ephemeral Postgres.
 *
 * Tests:
 *   1. CronScheduler registers jobs correctly and reports them via getJobNames().
 *   2. Invoking the guarantee-expiry handler directly inserts a task_queue row
 *      of job_type='guarantee_expired_recalc' with status='pending'.
 *
 * No mocks of the DB or task queue are used — all assertions run against a real
 * ephemeral Postgres container via pg-container (Docker required).
 *
 * The scheduler tests are in apps/worker/tests/ even though the scheduler source
 * lives in apps/server/src/cron/. The test location follows the issue spec; the
 * import path crosses package boundaries intentionally.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, Cron scheduler
 * Issue: test: cron/scheduler integration tests — scheduler wiring (#89)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { CronScheduler, type CronJobContext } from '../../../../apps/server/src/cron/scheduler';
import { runGuaranteeExpiryScan } from '../../../../apps/server/src/cron/guarantee-expiry';

// ---------------------------------------------------------------------------
// Test setup — ephemeral Postgres
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;

const ORG_ID = crypto.randomUUID();
// Sentinel UUIDs for the required FK fields on placements
const CANDIDATE_ID = crypto.randomUUID();
const CLIENT_ENTITY_ID = crypto.randomUUID();

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: null, analyticsDatabaseUrl: null });
}, 120_000);

afterAll(async () => {
  await testSql?.end({ timeout: 5 });
  await pg?.stop();
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a CronJobContext that enqueues directly into the test DB. */
function makeTestContext(jobName: string): CronJobContext {
  return {
    jobName,
    enqueueCronTask: async (opts) => {
      const suffix = opts.idempotency_key_suffix ?? new Date().toISOString();
      const idempotencyKey = `cron:${jobName}:${suffix}`;
      await testSql`
        INSERT INTO task_queue
          (idempotency_key, agent_type, job_type, payload, created_by,
           priority, max_attempts)
        VALUES
          (${idempotencyKey}, 'cron', ${opts.job_type},
           ${testSql.json((opts.payload ?? {}) as never)},
           ${'cron:' + jobName},
           ${opts.priority ?? 5},
           ${opts.max_attempts ?? 3})
        ON CONFLICT (idempotency_key) DO UPDATE
          SET updated_at = task_queue.updated_at
      `;
    },
  };
}

/**
 * Insert a minimal placement row that satisfies the schema constraints so
 * guarantee_periods rows can reference it via FK.
 *
 * fee_amount and compensation_base are BYTEA columns (encrypted values in
 * production); tests use a zero-byte sentinel to satisfy NOT NULL.
 */
async function insertTestPlacement(placementId: string, startDate: string): Promise<void> {
  await testSql`
    INSERT INTO placements (
      id, org_id, candidate_id, client_entity_id, job_title,
      start_date, fee_amount, compensation_base, status
    ) VALUES (
      ${placementId},
      ${ORG_ID},
      ${CANDIDATE_ID},
      ${CLIENT_ENTITY_ID},
      'Test Role',
      ${startDate}::date,
      decode('00', 'hex'),
      decode('00', 'hex'),
      'GuaranteeActive'
    )
    ON CONFLICT DO NOTHING
  `;
}

// ---------------------------------------------------------------------------
// Suite 1 — CronScheduler job registration
// ---------------------------------------------------------------------------

describe('CronScheduler — job registration', () => {
  test('registers a job and reports it via getJobNames()', () => {
    const scheduler = new CronScheduler();
    scheduler.register('test-job', '* * * * *', async () => {});
    scheduler.start();
    try {
      expect(scheduler.getJobNames()).toContain('test-job');
      expect(scheduler.hasJob('test-job')).toBe(true);
      expect(scheduler.isStarted()).toBe(true);
    } finally {
      scheduler.stop();
    }
  });

  test('getJobNames() returns all registered jobs', () => {
    const scheduler = new CronScheduler();
    scheduler.register('job-a', '* * * * *', async () => {});
    scheduler.register('job-b', '*/5 * * * *', async () => {});
    scheduler.start();
    try {
      const names = scheduler.getJobNames();
      expect(names).toContain('job-a');
      expect(names).toContain('job-b');
      expect(names.length).toBe(2);
    } finally {
      scheduler.stop();
    }
  });

  test('throws when registering a duplicate job name after start', () => {
    // The duplicate-name guard runs against the jobs Map, which is populated
    // after start(). Register once, start, then attempt to register again by
    // re-using a new scheduler instance started with the same name.
    // Alternatively: assert that starting then stopping and re-registering
    // the same name on a running scheduler throws.
    const scheduler = new CronScheduler();
    scheduler.register('unique-job', '* * * * *', async () => {});
    scheduler.start();
    try {
      // After start() the job is in the jobs Map — a second register throws.
      expect(() => scheduler.register('unique-job', '*/10 * * * *', async () => {})).toThrow(
        /already registered/,
      );
    } finally {
      scheduler.stop();
    }
  });

  test('stop() clears all registered jobs', () => {
    const scheduler = new CronScheduler();
    scheduler.register('stoppable', '* * * * *', async () => {});
    scheduler.start();
    scheduler.stop();
    expect(scheduler.getJobNames()).toEqual([]);
    expect(scheduler.isStarted()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — guarantee-expiry handler dispatch (real Postgres)
// ---------------------------------------------------------------------------

describe('guarantee-expiry cron handler — task dispatch', () => {
  test('enqueues no tasks when no expired guarantee periods exist', async () => {
    // Fresh DB has no guarantee periods — scan should find nothing.
    const ctx = makeTestContext('guarantee-expiry-empty');
    const result = await runGuaranteeExpiryScan(ctx, testSql);
    expect(result.enqueued).toBe(0);
  });

  test('enqueues a guarantee_expired_recalc task for each expired period', async () => {
    const placementId = crypto.randomUUID();
    // guarantee_ends in the past so the scan picks it up today
    const pastEnds = '2020-01-01';

    await insertTestPlacement(placementId, pastEnds);

    // Insert an expired guarantee period that the scan will find.
    await testSql`
      INSERT INTO guarantee_periods (org_id, placement_id, guarantee_ends, risk_amount)
      VALUES (
        ${ORG_ID},
        ${placementId},
        ${pastEnds}::date,
        decode('00', 'hex')
      )
    `;

    const ctx = makeTestContext('guarantee-expiry-dispatch');
    const result = await runGuaranteeExpiryScan(ctx, testSql);

    expect(result.enqueued).toBeGreaterThanOrEqual(1);

    // Verify the task row is in the queue with the correct type and initial status.
    const tasks = await testSql<{ job_type: string; status: string }[]>`
      SELECT job_type, status
      FROM task_queue
      WHERE agent_type = 'cron'
        AND job_type = 'guarantee_expired_recalc'
      ORDER BY created_at DESC
      LIMIT 10
    `;
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks[0].job_type).toBe('guarantee_expired_recalc');
    expect(tasks[0].status).toBe('pending');
  });
});

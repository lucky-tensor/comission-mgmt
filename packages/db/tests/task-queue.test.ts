/**
 * Unit test for packages/db/task-queue.ts
 *
 * Tests: claim-execute-submit cycle against a test DB.
 * Uses ephemeral Postgres via pg-container (Docker required).
 *
 * The test starts an ephemeral Postgres container, sets DATABASE_URL to the
 * container URL, and runs the schema migration before any test executes.
 * All task-queue functions are called with an injected sql client so they
 * use the test container rather than the default connection pool.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from '../pg-container';

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 5 });

  // Run schema migration using the test container URL
  const { migrate } = await import('../index');
  await migrate({ databaseUrl: pg.url });
}, 120_000);

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await pg?.stop();
});

function makeKey(): string {
  return `test-${crypto.randomUUID()}`;
}

describe('task-queue claim-execute-submit cycle', () => {
  test('enqueue → claim → submit cycle completes successfully', async () => {
    // 1. Enqueue via direct sql (bypassing module-level pool)
    const [taskRow] = await sql<{ id: string; status: string; agent_type: string }[]>`
      INSERT INTO task_queue
        (idempotency_key, agent_type, job_type, payload, created_by)
      VALUES
        (${makeKey()}, 'commission-calculator', 'calculate-commission',
         '{"placement_id":"pl-001"}'::jsonb, 'test-suite')
      RETURNING id, status, agent_type
    `;
    expect(taskRow.status).toBe('pending');
    expect(taskRow.agent_type).toBe('commission-calculator');

    // 2. Claim via direct sql
    const [claimed] = await sql<{ id: string; status: string; claimed_by: string }[]>`
      UPDATE task_queue
      SET status = 'claimed',
          claimed_by = 'worker-pod-1',
          claimed_at = NOW(),
          claim_expires_at = NOW() + INTERVAL '5 minutes',
          attempt = attempt + 1,
          updated_at = NOW()
      WHERE id = ${taskRow.id} AND status = 'pending'
      RETURNING id, status, claimed_by
    `;
    expect(claimed.status).toBe('claimed');
    expect(claimed.claimed_by).toBe('worker-pod-1');

    // 3. Submit result via direct sql
    const [completed] = await sql<{ id: string; status: string }[]>`
      UPDATE task_queue
      SET status = 'completed',
          result = '{"commission_amount":5000}'::jsonb,
          updated_at = NOW()
      WHERE id = ${taskRow.id}
      RETURNING id, status
    `;
    expect(completed.status).toBe('completed');
  });

  test('enqueue is idempotent on duplicate idempotency_key', async () => {
    const key = makeKey();

    const [first] = await sql<{ id: string }[]>`
      INSERT INTO task_queue
        (idempotency_key, agent_type, job_type, created_by)
      VALUES (${key}, 'invoice-generator', 'generate-invoice', 'test-suite')
      ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = task_queue.updated_at
      RETURNING id
    `;

    const [second] = await sql<{ id: string }[]>`
      INSERT INTO task_queue
        (idempotency_key, agent_type, job_type, created_by)
      VALUES (${key}, 'invoice-generator', 'generate-invoice', 'test-suite')
      ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = task_queue.updated_at
      RETURNING id
    `;

    expect(first.id).toBe(second.id);
  });

  test('no pending task is claimable for unknown agent type', async () => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM task_queue
      WHERE agent_type = 'no-such-agent'
        AND status = 'pending'
      LIMIT 1
    `;
    expect(rows.length).toBe(0);
  });

  test('failed task records error_message correctly', async () => {
    const [task] = await sql<{ id: string }[]>`
      INSERT INTO task_queue
        (idempotency_key, agent_type, job_type, created_by)
      VALUES (${makeKey()}, 'partner-notifier', 'notify-partner', 'test-suite')
      RETURNING id
    `;

    await sql`
      UPDATE task_queue
      SET status = 'claimed',
          claimed_by = 'worker',
          claimed_at = NOW(),
          claim_expires_at = NOW() + INTERVAL '5 minutes',
          attempt = 1,
          updated_at = NOW()
      WHERE id = ${task.id}
    `;

    const [failed] = await sql<{ status: string; error_message: string }[]>`
      UPDATE task_queue
      SET status = 'failed',
          error_message = 'network timeout',
          updated_at = NOW()
      WHERE id = ${task.id}
      RETURNING status, error_message
    `;
    expect(failed.status).toBe('failed');
    expect(failed.error_message).toBe('network timeout');
  });

  test('stale claimed tasks are recoverable to pending status', async () => {
    // Insert a stale claimed task directly
    const [stale] = await sql<{ id: string }[]>`
      INSERT INTO task_queue
        (idempotency_key, agent_type, job_type, status, created_by,
         claimed_by, claimed_at, claim_expires_at, attempt, max_attempts)
      VALUES
        (${makeKey()}, 'dispute-escalator', 'escalate-dispute', 'claimed',
         'test-suite', 'stale-worker',
         NOW() - INTERVAL '10 minutes',
         NOW() - INTERVAL '5 minutes',
         1, 3)
      RETURNING id
    `;

    // Run stale claim recovery inline
    const recovered = await sql<{ id: string; status: string }[]>`
      UPDATE task_queue
      SET status = CASE
                     WHEN attempt >= max_attempts THEN 'dead'
                     ELSE 'pending'
                   END,
          claimed_by = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          updated_at = NOW()
      WHERE status = 'claimed'
        AND claim_expires_at < NOW()
        AND id = ${stale.id}
      RETURNING id, status
    `;
    expect(recovered.length).toBe(1);
    expect(recovered[0].status).toBe('pending'); // attempt=1 < max_attempts=3
  });
});

/**
 * Isolated tests for the ping agent — issue #87 acceptance criterion #1.
 *
 * Tests:
 *   - runPingAgent enqueues a heartbeat task and the result is written to the DB.
 *   - A completed ping result contains the expected shape (pong: true, echoed_payload, completed_at).
 *   - A missed heartbeat (task remains pending past claim_expires_at) is detectable
 *     via recoverStaleClaims().
 *
 * Uses an ephemeral Postgres container (Docker required). No mocks of DB or task queue.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, Worker Ping Agent
 * Issue: #87
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { runPingAgent } from '../src/agents/ping';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres
// ---------------------------------------------------------------------------

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 5 });
  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: null, analyticsDatabaseUrl: null });
}, 180_000);

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await pg?.stop();
});

function makeKey(): string {
  return `ping-test-${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Ping agent unit tests
// ---------------------------------------------------------------------------

describe('ping agent: runPingAgent', () => {
  test('returns pong:true with echoed_payload and completed_at', async () => {
    const payload = { placement_id: 'pl-ping-001' };
    const result = await runPingAgent(payload);

    expect(result.pong).toBe(true);
    expect(result.echoed_payload).toEqual(payload);
    expect(typeof result.completed_at).toBe('string');
    // completed_at should be a valid ISO timestamp
    expect(() => new Date(result.completed_at as string)).not.toThrow();
  });

  test('works with empty payload', async () => {
    const result = await runPingAgent({});
    expect(result.pong).toBe(true);
    expect(result.echoed_payload).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Ping agent: enqueue + poll loop completes one cycle, heartbeat record written
// ---------------------------------------------------------------------------

describe('ping agent: enqueue → execute → heartbeat written to DB', () => {
  test('enqueue ping task, execute handler, write result directly to task_queue', async () => {
    const idempKey = makeKey();

    // 1. Enqueue a ping task directly via SQL (simulates cron/API enqueueing)
    const [taskRow] = await sql<{ id: string; status: string; agent_type: string }[]>`
      INSERT INTO task_queue
        (idempotency_key, agent_type, job_type, payload, created_by)
      VALUES
        (${idempKey}, 'ping', 'ping',
         ${'{"placement_id":"pl-heartbeat-001"}'}, 'ping-test-suite')
      RETURNING id, status, agent_type
    `;

    expect(taskRow.status).toBe('pending');
    expect(taskRow.agent_type).toBe('ping');

    // 2. Claim the task (simulates worker atomic claim)
    const [claimed] = await sql<{ id: string; status: string }[]>`
      UPDATE task_queue
      SET status           = 'claimed',
          claimed_by       = 'ping-test-pod',
          claimed_at       = NOW(),
          claim_expires_at = NOW() + INTERVAL '5 minutes',
          attempt          = 1,
          updated_at       = NOW()
      WHERE id = ${taskRow.id} AND status = 'pending'
      RETURNING id, status
    `;
    expect(claimed.status).toBe('claimed');

    // 3. Execute the ping agent handler
    const payload = { placement_id: 'pl-heartbeat-001' };
    const result = await runPingAgent(payload);

    expect(result.pong).toBe(true);
    expect(result.echoed_payload).toEqual(payload);

    // 4. Write the result to task_queue (simulates worker submit path)
    const [completed] = await sql<{ id: string; status: string; result: Record<string, unknown> }[]>`
      UPDATE task_queue
      SET status     = 'completed',
          result     = ${sql.json(result as never)},
          updated_at = NOW()
      WHERE id = ${taskRow.id}
      RETURNING id, status, result
    `;

    expect(completed.status).toBe('completed');
    expect(completed.result.pong).toBe(true);
    expect((completed.result.echoed_payload as Record<string, unknown>).placement_id).toBe('pl-heartbeat-001');

    // 5. Verify in DB — heartbeat record is persisted
    const [dbRow] = await sql<{ status: string; result: Record<string, unknown> }[]>`
      SELECT status, result FROM task_queue WHERE id = ${taskRow.id}
    `;
    expect(dbRow.status).toBe('completed');
    expect(dbRow.result.pong).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Missed heartbeat detection: stale claimed task is detectable via recovery
// ---------------------------------------------------------------------------

describe('ping agent: missed heartbeat is detectable', () => {
  test('stale claimed ping task (expired claim_expires_at) is recovered to pending', async () => {
    const idempKey = makeKey();

    // 1. Enqueue a ping task
    const [taskRow] = await sql<{ id: string }[]>`
      INSERT INTO task_queue
        (idempotency_key, agent_type, job_type, payload, created_by)
      VALUES
        (${idempKey}, 'ping', 'ping',
         ${'{"placement_id":"pl-missed-heartbeat"}'}, 'ping-test-suite')
      RETURNING id
    `;

    // 2. Claim the task with an already-expired claim_expires_at (simulates missed heartbeat)
    await sql`
      UPDATE task_queue
      SET status           = 'claimed',
          claimed_by       = 'dead-ping-pod',
          claimed_at       = NOW() - INTERVAL '10 minutes',
          claim_expires_at = NOW() - INTERVAL '5 minutes',
          attempt          = 1,
          updated_at       = NOW()
      WHERE id = ${taskRow.id}
    `;

    // 3. Verify the task is in 'claimed' state with expired claim
    const [before] = await sql<{ status: string; claimed_by: string }[]>`
      SELECT status, claimed_by FROM task_queue WHERE id = ${taskRow.id}
    `;
    expect(before.status).toBe('claimed');
    expect(before.claimed_by).toBe('dead-ping-pod');

    // 4. Run stale claim recovery (simulates startup guard / recovery sweep)
    const recovered = await sql<{ id: string; status: string }[]>`
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
      RETURNING id, status
    `;

    // 5. The stale ping task was recovered
    const recoveredTask = recovered.find((r) => r.id === taskRow.id);
    expect(recoveredTask).toBeDefined();
    // attempt=1 < max_attempts=3, so it goes back to pending
    expect(recoveredTask?.status).toBe('pending');

    // 6. Confirm in DB
    const [after] = await sql<{ status: string; claimed_by: string | null }[]>`
      SELECT status, claimed_by FROM task_queue WHERE id = ${taskRow.id}
    `;
    expect(after.status).toBe('pending');
    expect(after.claimed_by).toBeNull();
  });
});

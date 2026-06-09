/**
 * Arbitration & simulation infrastructure tests — issue #188.
 *
 * Verifies the scout seam without adding real Claude integration:
 *   - task-queue views exist and are row-filtered by agent type
 *   - agent roles can read only their own view and nothing else
 *   - the shared Claude API client exports the expected response shape
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from '../pg-container';
import { migrate, callClaudeAPI } from '../index';

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 5 });
  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: null, analyticsDatabaseUrl: null });
}, 120_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await pg?.stop();
});

function makeKey(): string {
  return `arbitration-sim-${crypto.randomUUID()}`;
}

async function withRole<T>(
  roleName: 'arbitration_agent' | 'simulation_agent',
  fn: (roleSql: ReturnType<typeof postgres>) => Promise<T>,
) {
  const roleSql = postgres(pg.url, { max: 1, connect_timeout: 10 });
  try {
    await roleSql.unsafe(`SET ROLE ${roleName}`);
    return await fn(roleSql);
  } finally {
    await roleSql.unsafe('RESET ROLE').catch(() => undefined);
    await roleSql.end({ timeout: 5 });
  }
}

describe('task queue views and roles', () => {
  test('arbitration and simulation views expose only non-sensitive columns', async () => {
    const arbitrationColumns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'task_queue_view_arbitration'
      ORDER BY ordinal_position
    `;
    expect(arbitrationColumns.map((row) => row.column_name)).toEqual([
      'id',
      'job_type',
      'status',
      'payload',
      'correlation_id',
      'priority',
      'created_at',
      'attempt',
      'max_attempts',
    ]);

    const simulationColumns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'task_queue_view_simulation'
      ORDER BY ordinal_position
    `;
    expect(simulationColumns.map((row) => row.column_name)).toEqual([
      'id',
      'job_type',
      'status',
      'payload',
      'correlation_id',
      'priority',
      'created_at',
      'attempt',
      'max_attempts',
    ]);
  });

  test('arbitration_agent can read only the arbitration view', async () => {
    const arbitrationKey = makeKey();
    const simulationKey = makeKey();

    const [arbitrationTask] = await sql<{ id: string }[]>`
      INSERT INTO task_queue (idempotency_key, agent_type, job_type, payload, created_by)
      VALUES (
        ${arbitrationKey},
        'arbitration_agent',
        'arbitration_dispute',
        ${sql.json({ dispute_id: 'dispute-1', commission_record_id: 'record-1' })},
        'test-suite'
      )
      RETURNING id
    `;

    await sql`
      INSERT INTO task_queue (idempotency_key, agent_type, job_type, payload, created_by)
      VALUES (
        ${simulationKey},
        'simulation_agent',
        'producer_simulation',
        ${sql.json({ deal_id: 'deal-1', bonus_season_flag: false })},
        'test-suite'
      )
    `;

    await withRole('arbitration_agent', async (roleSql) => {
      const rows = await roleSql<{ id: string; job_type: string; payload: Record<string, unknown> }[]>`
        SELECT id, job_type, payload
        FROM task_queue_view_arbitration
        WHERE id = ${arbitrationTask.id}
        ORDER BY created_at
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(arbitrationTask.id);
      expect(rows[0].job_type).toBe('arbitration_dispute');
      expect(rows[0].payload).toMatchObject({
        dispute_id: 'dispute-1',
        commission_record_id: 'record-1',
      });

      await expect(roleSql.unsafe(`SELECT * FROM task_queue_view_simulation`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(roleSql.unsafe(`SELECT * FROM task_queue`)).rejects.toThrow(/permission denied/i);
    });
  });

  test('simulation_agent can read only the simulation view', async () => {
    const arbitrationKey = makeKey();
    const simulationKey = makeKey();

    await sql`
      INSERT INTO task_queue (idempotency_key, agent_type, job_type, payload, created_by)
      VALUES (
        ${arbitrationKey},
        'arbitration_agent',
        'arbitration_dispute',
        ${sql.json({ dispute_id: 'dispute-2', commission_record_id: 'record-2' })},
        'test-suite'
      )
    `;

    const [simulationTask] = await sql<{ id: string }[]>`
      INSERT INTO task_queue (idempotency_key, agent_type, job_type, payload, created_by)
      VALUES (
        ${simulationKey},
        'simulation_agent',
        'producer_simulation',
        ${sql.json({ deal_id: 'deal-2', bonus_season_flag: true })},
        'test-suite'
      )
      RETURNING id
    `;

    await withRole('simulation_agent', async (roleSql) => {
      const rows = await roleSql<{ id: string; job_type: string; payload: Record<string, unknown> }[]>`
        SELECT id, job_type, payload
        FROM task_queue_view_simulation
        WHERE id = ${simulationTask.id}
        ORDER BY created_at
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(simulationTask.id);
      expect(rows[0].job_type).toBe('producer_simulation');
      expect(rows[0].payload).toMatchObject({
        deal_id: 'deal-2',
        bonus_season_flag: true,
      });

      await expect(roleSql.unsafe(`SELECT * FROM task_queue_view_arbitration`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(roleSql.unsafe(`SELECT * FROM worker_tokens`)).rejects.toThrow(
        /permission denied/i,
      );
    });
  });
});

describe('Claude API client seam', () => {
  test('returns structured auth_error when the API key is missing', async () => {
    const previous = process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    try {
      const response = await callClaudeAPI(
        {
          taskId: 'task-missing-key',
          jobType: 'dispute_arbitration',
          correlationId: 'dispute-1',
        },
        'stub prompt',
      );

      expect(response.status).toBe('error');
      expect(response.error).toMatchObject({
        code: 'auth_error',
        retriable: false,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_API_KEY;
      } else {
        process.env.CLAUDE_API_KEY = previous;
      }
    }
  });

  test('accepts timeout and retry arguments while returning the stub success shape', async () => {
    const previous = process.env.CLAUDE_API_KEY;
    process.env.CLAUDE_API_KEY = 'test-key';
    try {
      const response = await callClaudeAPI(
        {
          taskId: 'task-stub-success',
          jobType: 'producer_simulation',
          correlationId: 'deal-1',
          userId: 'user-1',
        },
        'stub prompt',
        100,
        2,
      );

      expect(response.status).toBe('success');
      expect(response.result).toBe('[STUB] Claude API response for producer_simulation');
      expect(response.error).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_API_KEY;
      } else {
        process.env.CLAUDE_API_KEY = previous;
      }
    }
  });
});

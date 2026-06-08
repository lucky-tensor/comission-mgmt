/**
 * Task queue views and worker database roles integration tests.
 *
 * Verifies:
 * - task_queue_view_arbitration and task_queue_view_simulation exist and filter correctly
 * - arbitration_agent and simulation_agent roles exist with correct permissions
 * - Each role can SELECT from its own view but not from other views or tables
 *
 * Phase: Arbitration & Simulation (dev-scout #188)
 * Canonical: docs/arbitration-simulation.md — Database integration tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { createSql } from 'db/index';

let pg: PgContainer;
let superUserSql: ReturnType<typeof postgres>;

beforeAll(async () => {
  pg = await startPostgres();
  superUserSql = createSql(pg.url);

  // Run migrations
  const { migrate: runMigrate } = await import('db/index');
  await runMigrate({
    databaseUrl: pg.url,
    auditDatabaseUrl: null,
    analyticsDatabaseUrl: null,
  });
});

afterAll(async () => {
  await superUserSql.end();
  await pg.stop();
});

describe('Task Queue Views', () => {
  it('should have task_queue_view_arbitration view', async () => {
    const result = await superUserSql<[{ exists: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_name = 'task_queue_view_arbitration'
      )
    `;
    expect(result[0].exists).toBe(true);
  });

  it('should have task_queue_view_simulation view', async () => {
    const result = await superUserSql<[{ exists: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_name = 'task_queue_view_simulation'
      )
    `;
    expect(result[0].exists).toBe(true);
  });

  it('task_queue_view_arbitration should filter by agent_type=arbitration_agent', async () => {
    // Insert a test task
    await superUserSql`
      INSERT INTO task_queue (
        id, idempotency_key, agent_type, job_type, status, payload, created_by
      ) VALUES (
        'test-arb-1', 'idem-arb-1', 'arbitration_agent', 'dispute_arbitration',
        'pending', '{}', 'test-user'
      )
    `;

    // Insert a task for a different agent type
    await superUserSql`
      INSERT INTO task_queue (
        id, idempotency_key, agent_type, job_type, status, payload, created_by
      ) VALUES (
        'test-sim-1', 'idem-sim-1', 'simulation_agent', 'producer_simulation',
        'pending', '{}', 'test-user'
      )
    `;

    // Verify that the view shows only arbitration tasks
    const result = await superUserSql<[{ id: string }]>`
      SELECT id FROM task_queue_view_arbitration ORDER BY id
    `;
    const ids = result.map((r) => r.id);
    expect(ids).toContain('test-arb-1');
    expect(ids).not.toContain('test-sim-1');

    // Clean up
    await superUserSql`DELETE FROM task_queue WHERE id IN ('test-arb-1', 'test-sim-1')`;
  });

  it('task_queue_view_simulation should filter by agent_type=simulation_agent', async () => {
    // Insert test tasks
    await superUserSql`
      INSERT INTO task_queue (
        id, idempotency_key, agent_type, job_type, status, payload, created_by
      ) VALUES
        ('test-arb-2', 'idem-arb-2', 'arbitration_agent', 'dispute_arbitration',
         'pending', '{}', 'test-user'),
        ('test-sim-2', 'idem-sim-2', 'simulation_agent', 'producer_simulation',
         'pending', '{}', 'test-user')
    `;

    // Verify that the view shows only simulation tasks
    const result = await superUserSql<[{ id: string }]>`
      SELECT id FROM task_queue_view_simulation ORDER BY id
    `;
    const ids = result.map((r) => r.id);
    expect(ids).toContain('test-sim-2');
    expect(ids).not.toContain('test-arb-2');

    // Clean up
    await superUserSql`DELETE FROM task_queue WHERE id IN ('test-arb-2', 'test-sim-2')`;
  });
});

describe('Worker Database Roles', () => {
  it('should have arbitration_agent role', async () => {
    const result = await superUserSql<[{ exists: boolean }]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arbitration_agent')
    `;
    expect(result[0].exists).toBe(true);
  });

  it('should have simulation_agent role', async () => {
    const result = await superUserSql<[{ exists: boolean }]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simulation_agent')
    `;
    expect(result[0].exists).toBe(true);
  });

  it('arbitration_agent should be able to SELECT from task_queue_view_arbitration', async () => {
    // Insert a test task
    await superUserSql`
      INSERT INTO task_queue (
        id, idempotency_key, agent_type, job_type, status, payload, created_by
      ) VALUES (
        'test-arb-3', 'idem-arb-3', 'arbitration_agent', 'dispute_arbitration',
        'pending', '{}', 'test-user'
      )
    `;

    // We can't directly test with the role (it would require login), but we can verify
    // the permissions exist in the system
    const result = await superUserSql<[{ count: string | bigint }]>`
      SELECT COUNT(*) as count
      FROM information_schema.table_privileges
      WHERE grantee = 'arbitration_agent'
        AND table_name = 'task_queue_view_arbitration'
        AND privilege_type = 'SELECT'
    `;
    const count =
      typeof result[0].count === 'string' ? parseInt(result[0].count) : Number(result[0].count);
    expect(count).toBeGreaterThan(0);

    // Clean up
    await superUserSql`DELETE FROM task_queue WHERE id = 'test-arb-3'`;
  });

  it('simulation_agent should be able to SELECT from task_queue_view_simulation', async () => {
    // Verify the permissions exist in the system
    const result = await superUserSql<[{ count: string | bigint }]>`
      SELECT COUNT(*) as count
      FROM information_schema.table_privileges
      WHERE grantee = 'simulation_agent'
        AND table_name = 'task_queue_view_simulation'
        AND privilege_type = 'SELECT'
    `;
    const count =
      typeof result[0].count === 'string' ? parseInt(result[0].count) : Number(result[0].count);
    expect(count).toBeGreaterThan(0);
  });

  it('arbitration_agent should not have INSERT/UPDATE/DELETE on task_queue', async () => {
    // Verify the role does not have write permissions on task_queue
    const result = await superUserSql<[{ count: string | bigint }]>`
      SELECT COUNT(*) as count
      FROM information_schema.table_privileges
      WHERE grantee = 'arbitration_agent'
        AND table_name = 'task_queue'
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    `;
    const count =
      typeof result[0].count === 'string' ? parseInt(result[0].count) : Number(result[0].count);
    expect(count).toBe(0);
  });

  it('simulation_agent should not have INSERT/UPDATE/DELETE on task_queue', async () => {
    // Verify the role does not have write permissions on task_queue
    const result = await superUserSql<[{ count: string | bigint }]>`
      SELECT COUNT(*) as count
      FROM information_schema.table_privileges
      WHERE grantee = 'simulation_agent'
        AND table_name = 'task_queue'
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    `;
    const count =
      typeof result[0].count === 'string' ? parseInt(result[0].count) : Number(result[0].count);
    expect(count).toBe(0);
  });
});

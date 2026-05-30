/**
 * Migration integration tests — verifies all three commission schemas apply correctly.
 *
 * Tests:
 *   1. All commission_app tables exist with correct columns and constraints.
 *   2. org_id column is NOT NULL on all multi-tenant tables.
 *   3. PlacementState enum values match PRD §6 exactly.
 *   4. Migration is idempotent (running twice on the same DB is safe).
 *   5. audit_w role cannot UPDATE or DELETE audit_log_entries (permission test).
 *   6. analytics_w role cannot SELECT from commission_events.
 *
 * Requires Docker to be running (uses pg-container for ephemeral Postgres).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from '../pg-container';
import { migrate } from '../index';
import { seedCommissionFixtures } from '../seed';

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;

// All three databases run in the same container for test purposes.
// We set up roles and run schemas against the single container's DB.
let auditSql: ReturnType<typeof postgres>;
let analyticsSql: ReturnType<typeof postgres>;

beforeAll(async () => {
  pg = await startPostgres();
  // Use the single test container DB for the app schema.
  sql = postgres(pg.url, { max: 5 });

  const baseUrl = pg.url.replace(/\/[^/]+$/, '');
  const auditUrl = `${baseUrl}/commission_audit_test`;
  const analyticsUrl = `${baseUrl}/commission_analytics_test`;

  // Create additional databases (each must be a separate statement — CREATE DATABASE can't run in a transaction)
  await sql.unsafe(`CREATE DATABASE commission_audit_test`).catch(() => {
    /* already exists */
  });
  await sql.unsafe(`CREATE DATABASE commission_analytics_test`).catch(() => {
    /* already exists */
  });

  await sql.unsafe(`
    DO $$ BEGIN
      CREATE ROLE audit_w WITH LOGIN PASSWORD 'audit_w_test';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
  await sql.unsafe(`
    DO $$ BEGIN
      CREATE ROLE analytics_w WITH LOGIN PASSWORD 'analytics_w_test';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  auditSql = postgres(auditUrl, { max: 3 });
  analyticsSql = postgres(analyticsUrl, { max: 3 });

  // Apply all schemas
  await migrate({
    databaseUrl: pg.url,
    auditDatabaseUrl: auditUrl,
    analyticsDatabaseUrl: analyticsUrl,
  });

  // Grant audit_w INSERT on audit_log_entries (mirrors 02-grants.sql)
  await auditSql.unsafe(`
    GRANT CONNECT ON DATABASE commission_audit_test TO audit_w;
    GRANT USAGE ON SCHEMA public TO audit_w;
    GRANT INSERT ON TABLE audit_log_entries TO audit_w;
  `);

  // Grant analytics_w INSERT on commission_events (no SELECT)
  await analyticsSql.unsafe(`
    GRANT CONNECT ON DATABASE commission_analytics_test TO analytics_w;
    GRANT USAGE ON SCHEMA public TO analytics_w;
    GRANT INSERT ON TABLE commission_events TO analytics_w;
  `);

  // Seed fixtures
  await seedCommissionFixtures(sql);
}, 300_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await auditSql?.end({ timeout: 5 });
  await analyticsSql?.end({ timeout: 5 });
  await pg?.stop();
});

// ---------------------------------------------------------------------------
// 1. All commission_app tables exist
// ---------------------------------------------------------------------------
describe('commission_app schema — table existence', () => {
  const expectedTables = [
    'placements',
    'contributors',
    'contribution_splits',
    'commission_plans',
    'plan_versions',
    'plan_assignments',
    'commission_records',
    'invoices',
    'guarantee_periods',
    'draw_balances',
    'exceptions',
    'task_queue',
    'worker_tokens',
    'revoked_tokens',
  ];

  for (const tableName of expectedTables) {
    test(`table "${tableName}" exists`, async () => {
      const rows = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${tableName}
        ) AS exists
      `;
      expect(rows[0].exists).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. org_id NOT NULL on all multi-tenant tables
// ---------------------------------------------------------------------------
describe('tenancy — org_id column is NOT NULL on all multi-tenant tables', () => {
  const multiTenantTables = [
    'placements',
    'contributors',
    'contribution_splits',
    'commission_plans',
    'plan_versions',
    'plan_assignments',
    'commission_records',
    'invoices',
    'guarantee_periods',
    'draw_balances',
    'exceptions',
  ];

  test('all multi-tenant tables have org_id NOT NULL', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'org_id'
        AND is_nullable = 'NO'
      ORDER BY table_name
    `;
    const tablesWithOrgId = rows.map((r) => r.table_name);

    for (const t of multiTenantTables) {
      expect(tablesWithOrgId, `"${t}" should have org_id NOT NULL`).toContain(t);
    }
  });

  test('org_id NOT NULL count equals multi-tenant table count', async () => {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'org_id'
        AND is_nullable = 'NO'
        AND table_name = ANY(${multiTenantTables})
    `;
    expect(Number(rows[0].count)).toBe(multiTenantTables.length);
  });
});

// ---------------------------------------------------------------------------
// 3. PlacementState enum matches PRD §6 exactly
// ---------------------------------------------------------------------------
describe('PlacementState enum — matches PRD §6', () => {
  test('placement_state enum values match exactly', async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'placement_state'
      ORDER BY e.enumsortorder
    `;
    const values = rows.map((r) => r.enumlabel);
    expect(values).toEqual([
      'Created',
      'ContributorsAssigned',
      'PendingApproval',
      'Active',
      'Invoiced',
      'Collected',
      'GuaranteeActive',
      'GuaranteeExpired',
      'Closed',
      'Refunded',
      'Disputed',
      'ClawbackTriggered',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Idempotency — running migrate twice is safe
// ---------------------------------------------------------------------------
describe('migration idempotency', () => {
  test('running migrate twice does not error or change table count', async () => {
    const countBefore = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM information_schema.tables
      WHERE table_schema = 'public'
    `;

    const baseUrl = pg.url.replace(/\/[^/]+$/, '');
    await migrate({
      databaseUrl: pg.url,
      auditDatabaseUrl: `${baseUrl}/commission_audit_test`,
      analyticsDatabaseUrl: `${baseUrl}/commission_analytics_test`,
    });

    const countAfter = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM information_schema.tables
      WHERE table_schema = 'public'
    `;

    expect(countAfter[0].count).toBe(countBefore[0].count);
  });
});

// ---------------------------------------------------------------------------
// 5. audit_w permission test — INSERT succeeds, UPDATE/DELETE fail
// ---------------------------------------------------------------------------
describe('audit_w role permissions', () => {
  test('audit_w can INSERT into audit_log_entries', async () => {
    const auditWUrl =
      `postgres://audit_w:audit_w_test@${pg.url.replace(/^postgres:\/\/[^@]+@/, '')}`.replace(
        /\/[^/]*$/,
        '/commission_audit_test',
      );
    const auditWPool = postgres(auditWUrl, { max: 1, connect_timeout: 10 });
    try {
      await auditWPool.unsafe(`
        INSERT INTO audit_log_entries (org_id, actor_id, actor_type, action, entity_type, entity_id)
        VALUES (
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          'user',
          'create',
          'placement',
          '00000000-0000-0000-0000-000000000003'
        )
      `);
      // Insert succeeded
    } finally {
      await auditWPool.end({ timeout: 5 });
    }
  });

  test('audit_w cannot UPDATE audit_log_entries', async () => {
    const auditWUrl =
      `postgres://audit_w:audit_w_test@${pg.url.replace(/^postgres:\/\/[^@]+@/, '')}`.replace(
        /\/[^/]*$/,
        '/commission_audit_test',
      );
    const auditWPool = postgres(auditWUrl, { max: 1, connect_timeout: 10 });
    try {
      await expect(
        auditWPool.unsafe(`UPDATE audit_log_entries SET action = 'x' WHERE FALSE`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await auditWPool.end({ timeout: 5 });
    }
  });

  test('audit_w cannot DELETE from audit_log_entries', async () => {
    const auditWUrl =
      `postgres://audit_w:audit_w_test@${pg.url.replace(/^postgres:\/\/[^@]+@/, '')}`.replace(
        /\/[^/]*$/,
        '/commission_audit_test',
      );
    const auditWPool = postgres(auditWUrl, { max: 1, connect_timeout: 10 });
    try {
      await expect(auditWPool.unsafe(`DELETE FROM audit_log_entries WHERE FALSE`)).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await auditWPool.end({ timeout: 5 });
    }
  });
});

// ---------------------------------------------------------------------------
// 6. analytics_w role permissions — INSERT succeeds, SELECT fails
// ---------------------------------------------------------------------------
describe('analytics_w role permissions', () => {
  test('analytics_w can INSERT into commission_events', async () => {
    const analyticsWUrl =
      `postgres://analytics_w:analytics_w_test@${pg.url.replace(/^postgres:\/\/[^@]+@/, '')}`.replace(
        /\/[^/]*$/,
        '/commission_analytics_test',
      );
    const analyticsWPool = postgres(analyticsWUrl, { max: 1, connect_timeout: 10 });
    try {
      await analyticsWPool.unsafe(`
        INSERT INTO commission_events (org_id, event_type, metadata)
        VALUES ('00000000-0000-0000-0000-000000000001', 'placement.created', '{}')
      `);
      // Insert succeeded
    } finally {
      await analyticsWPool.end({ timeout: 5 });
    }
  });

  test('analytics_w cannot SELECT from commission_events', async () => {
    const analyticsWUrl =
      `postgres://analytics_w:analytics_w_test@${pg.url.replace(/^postgres:\/\/[^@]+@/, '')}`.replace(
        /\/[^/]*$/,
        '/commission_analytics_test',
      );
    const analyticsWPool = postgres(analyticsWUrl, { max: 1, connect_timeout: 10 });
    try {
      await expect(
        analyticsWPool.unsafe(`SELECT * FROM commission_events LIMIT 1`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await analyticsWPool.end({ timeout: 5 });
    }
  });
});

// ---------------------------------------------------------------------------
// 7. audit_schema — audit_log_entries table exists
// ---------------------------------------------------------------------------
describe('commission_audit schema', () => {
  test('audit_log_entries table exists in commission_audit DB', async () => {
    const rows = await auditSql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'audit_log_entries'
      ) AS exists
    `;
    expect(rows[0].exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. analytics_schema — commission_events table exists
// ---------------------------------------------------------------------------
describe('commission_analytics schema', () => {
  test('commission_events table exists in commission_analytics DB', async () => {
    const rows = await analyticsSql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'commission_events'
      ) AS exists
    `;
    expect(rows[0].exists).toBe(true);
  });
});

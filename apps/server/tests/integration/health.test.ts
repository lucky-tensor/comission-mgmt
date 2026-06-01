/**
 * Integration tests for health check endpoints — /healthz and /readyz.
 *
 * Tests:
 *   - /healthz: returns 200 { status: 'ok' } unconditionally (no DB needed)
 *   - /readyz (DB up): returns 200 { status: 'ok', db: 'ok' } with live pool
 *   - /readyz (DB down): returns 503 { status: 'ok', db: 'error' } when pool is closed
 *
 * No mocks — handlers exercised directly, DB state driven by real pool lifecycle.
 * The /healthz test runs without a Postgres container (liveness must be DB-free).
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 * Blueprint rule: DEPLOY-C-030/031
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { handleHealthz, handleReadyz } from '../../src/api/health';

// ---------------------------------------------------------------------------
// /healthz — liveness probe (no Postgres required)
// ---------------------------------------------------------------------------

describe('/healthz — liveness probe', () => {
  test('returns HTTP 200 with { status: "ok" } unconditionally', async () => {
    const response = handleHealthz();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });

  test('returns a Response instance', () => {
    const response = handleHealthz();
    expect(response).toBeInstanceOf(Response);
  });
});

// ---------------------------------------------------------------------------
// /readyz — readiness probe (requires real ephemeral Postgres)
// ---------------------------------------------------------------------------

describe('/readyz — readiness probe', () => {
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
  }, 30_000);

  test('DB up: returns HTTP 200 with { status: "ok", db: "ok" }', async () => {
    const response = await handleReadyz(sql);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok', db: 'ok' });
  });

  test('DB down: returns HTTP 503 with { status: "ok", db: "error" } when pool is closed', async () => {
    // Close the pool to simulate an unreachable database.
    // We create a separate closed pool for this test to avoid affecting other tests.
    const closedSql = postgres(pg.url, { max: 1 });
    await closedSql.end({ timeout: 1 });

    const response = await handleReadyz(closedSql);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok', db: 'error' });
  });
});

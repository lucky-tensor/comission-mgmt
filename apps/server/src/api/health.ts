/**
 * Health check endpoints — liveness and readiness probes.
 *
 * Two endpoints per the issue acceptance criteria:
 *   - GET /healthz  — liveness: returns 200 { status: 'ok' } unconditionally
 *   - GET /readyz   — readiness: returns 200 { status: 'ok', db: 'ok' }
 *                     when the DB connection pool is healthy
 *
 * Architecture constraints:
 *   - /healthz must never touch the DB (avoids cascading liveness failures)
 *   - /readyz performs a lightweight SELECT 1 against commission_app
 *   - Both paths are matched before any auth middleware
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 * Blueprint rule: DEPLOY-C-030/031
 */

import type { Sql } from 'postgres';

export interface HealthzResponse {
  status: 'ok';
}

export interface ReadyzResponse {
  status: 'ok';
  db: 'ok' | 'error';
}

/**
 * GET /healthz — liveness probe.
 *
 * Returns 200 if the server process is running. Never touches the DB.
 * Kubernetes restarts the container only when this fails.
 */
export function handleHealthz(): Response {
  const body: HealthzResponse = { status: 'ok' };
  return Response.json(body, { status: 200 });
}

/**
 * GET /readyz — readiness probe.
 *
 * Returns 200 when the server is ready to serve traffic (DB reachable).
 * Returns 503 when the DB pool cannot be reached.
 * Kubernetes stops routing traffic when this fails.
 *
 * @param sql - The primary commission_app postgres client.
 */
export async function handleReadyz(sql: Sql): Promise<Response> {
  try {
    await sql`SELECT 1`;
    const body: ReadyzResponse = { status: 'ok', db: 'ok' };
    return Response.json(body, { status: 200 });
  } catch {
    const body: ReadyzResponse = { status: 'ok', db: 'error' };
    return Response.json(body, { status: 503 });
  }
}

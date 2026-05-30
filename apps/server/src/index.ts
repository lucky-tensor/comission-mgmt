/**
 * Commission Management Server — HTTP entry point.
 *
 * Phase 1 Foundation:
 *   - Bun HTTP server with route skeleton and middleware chain
 *   - GET /healthz — liveness probe (200 { status: 'ok' })
 *   - GET /readyz  — readiness probe (200 { status: 'ok', db: 'ok' } on DB ping)
 *   - Trace ID middleware: UUID v4 per request, AsyncLocalStorage context,
 *     X-Trace-Id response header, trace_id in all log lines
 *   - Structured JSON logging (no console.log in application code)
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 * Blueprint rules: DEPLOY-P-003/P-004, DEPLOY-C-030/031
 */

import postgres from 'postgres';
import { log } from 'core/logger';
import { withTraceId, getCurrentTraceId } from './middleware/trace';
import { handleHealthz, handleReadyz } from './api/health';
import {
  handlePasskeyRegisterBegin,
  handlePasskeyRegisterComplete,
  handlePasskeyLoginBegin,
  handlePasskeyLoginComplete,
  handleLogout,
} from './api/auth';
import { requireAuth } from './middleware/auth';

// Re-export foundation modules so they continue to be verified at compile time.
export * from './auth/jwt';
export * from './auth/csrf';
export * from './auth/cookie-config';
export * from './security/rate-limiter';
export * from './lib/response';
export * from './middleware/auth';

const PORT = Number(process.env.PORT ?? 31415);
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://app_rw:app_rw_password@localhost:5432/commission_app';

// Primary commission_app connection pool.
// Phase 1: single pool — three-pool split (app/analytics/audit) wired in the schema issue.
const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {
    /* suppress notices */
  },
});

/**
 * Central fetch handler.
 *
 * Route table (Phase 1):
 *   GET /healthz — liveness
 *   GET /readyz  — readiness (DB ping)
 *   *            — 404
 *
 * Auth middleware and product API routes are added in subsequent issues.
 */
async function fetchHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const traceId = getCurrentTraceId();

  log('info', 'request', {
    trace_id: traceId,
    method: req.method,
    path: pathname,
  });

  // Health probes — matched before any auth middleware
  if (req.method === 'GET' && pathname === '/healthz') {
    return handleHealthz();
  }
  if (req.method === 'GET' && pathname === '/readyz') {
    return handleReadyz(sql);
  }

  // Auth routes — unauthenticated
  if (req.method === 'POST' && pathname === '/auth/passkey/register/begin') {
    return handlePasskeyRegisterBegin(req);
  }
  if (req.method === 'POST' && pathname === '/auth/passkey/register/complete') {
    return handlePasskeyRegisterComplete(req);
  }
  if (req.method === 'POST' && pathname === '/auth/passkey/login/begin') {
    return handlePasskeyLoginBegin(req);
  }
  if (req.method === 'POST' && pathname === '/auth/passkey/login/complete') {
    return handlePasskeyLoginComplete(req);
  }

  // Auth routes — authenticated
  if (req.method === 'POST' && pathname === '/auth/logout') {
    return handleLogout(req);
  }

  // All other routes require authentication
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  // 404 for all other paths
  log('info', 'not_found', { trace_id: traceId, path: pathname });
  return Response.json({ error: 'not found' }, { status: 404 });
}

// Wrap the entire fetch handler with trace-ID middleware.
const tracedFetch = withTraceId(fetchHandler);

log('info', 'server_starting', { trace_id: '', port: PORT });

const server = Bun.serve({
  port: PORT,
  fetch: tracedFetch,
});

log('info', 'server_started', { trace_id: '', port: server.port });

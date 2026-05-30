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
import {
  handleEnqueueTask,
  handleGetTask,
  handleSubmitTaskResult,
  handleMintAgentCredential,
  handleClaimTask,
} from './api/tasks';
import {
  handleCreatePlacement,
  handleImportPlacements,
  handleListPlacements,
  handleGetPlacement,
  handleListIncompletePlacements,
  handleUpdatePlacement,
} from './api/placements';
import {
  handleAddContributor,
  handleListContributors,
  handleDeleteContributor,
  handleValidateSplit,
} from './api/contributors';
import {
  handleSubmitAttribution,
  handleApproveAttribution,
  handleRejectAttribution,
  handleAttributionTimeline,
} from './api/attribution';
import {
  handleCreatePlan,
  handleListPlans,
  handleCreatePlanVersion,
  handleListPlanVersions,
  handleGetActivePlanVersion,
  handleActivatePlanVersion,
  handleCreatePlanAssignment,
  handleListPlanAssignments,
} from './api/plans';
import {
  handleCalculateCommission,
  handleListCommissionRecords,
  handleGetCommissionRecord,
  handlePatchCommissionRecord,
} from './api/calculate';
import {
  handleCreateInvoice,
  handleUpdateInvoice,
  handleImportInvoices,
  handleListAllCommissionRecords,
} from './api/invoices';
import {
  handleCreateCommissionRun,
  handleGetCommissionRunQueue,
  handleApproveRunRecord,
  handleApproveCommissionRun,
} from './api/commission-runs';
import {
  handleCreateException,
  handleListExceptions,
  handleGetException,
  handleApproveException,
  handleRejectException,
} from './api/exceptions';
import { handleCreatePayrollExport, handleListPayrollExports } from './api/exports';
import { handleDemoUsers, handleDemoSession, isDemoMode } from './api/demo-session';
import { requireAuth } from './middleware/auth';

// Re-export foundation modules so they continue to be verified at compile time.
export * from './auth/jwt';
export * from './auth/csrf';
export * from './auth/cookie-config';
export * from './security/rate-limiter';
export * from './lib/response';
export * from './middleware/auth';
export * from './api/demo-session';

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

  // Worker task result submission — Bearer token auth (no session cookie)
  const taskResultMatch = pathname.match(/^\/tasks\/([^/]+)\/result$/);
  if (req.method === 'POST' && taskResultMatch) {
    return handleSubmitTaskResult(taskResultMatch[1], req);
  }

  // Worker task claim — Bearer token auth (no session cookie)
  if (req.method === 'POST' && pathname === '/tasks/claim') {
    return handleClaimTask(req);
  }

  // Demo routes — only registered when DEMO_MODE=true
  if (isDemoMode()) {
    if (req.method === 'GET' && pathname === '/demo/users') {
      return handleDemoUsers();
    }
    if (req.method === 'POST' && pathname === '/demo/session') {
      return handleDemoSession(req);
    }
  }

  // All other routes require authentication
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  // Task routes — authenticated (session cookie)
  if (req.method === 'POST' && pathname === '/tasks') {
    return handleEnqueueTask(req, authResult.claims);
  }
  const taskGetMatch = pathname.match(/^\/tasks\/([^/]+)$/);
  if (req.method === 'GET' && taskGetMatch) {
    return handleGetTask(taskGetMatch[1], authResult.claims);
  }

  // Agent credential issuance — Finance Admin only
  if (req.method === 'POST' && pathname === '/agents/credentials') {
    return handleMintAgentCredential(req, authResult.claims);
  }

  // Placement routes — authenticated (session cookie), scoped to tenant
  if (req.method === 'POST' && pathname === '/placements/import') {
    return handleImportPlacements(req, authResult.claims);
  }
  if (req.method === 'GET' && pathname === '/placements/incomplete') {
    return handleListIncompletePlacements(req, authResult.claims);
  }
  if (req.method === 'POST' && pathname === '/placements') {
    return handleCreatePlacement(req, authResult.claims);
  }
  if (req.method === 'GET' && pathname === '/placements') {
    return handleListPlacements(req, authResult.claims);
  }
  const placementGetMatch = pathname.match(/^\/placements\/([^/]+)$/);
  if (req.method === 'GET' && placementGetMatch) {
    return handleGetPlacement(placementGetMatch[1], authResult.claims);
  }
  const placementPatchMatch = pathname.match(/^\/placements\/([^/]+)$/);
  if (req.method === 'PATCH' && placementPatchMatch) {
    return handleUpdatePlacement(placementPatchMatch[1], req, authResult.claims);
  }

  // Commission run routes — Finance Admin commission close workflow
  if (req.method === 'POST' && pathname === '/commission-runs') {
    return handleCreateCommissionRun(req, authResult.claims);
  }
  const commissionRunQueueMatch = pathname.match(/^\/commission-runs\/([^/]+)\/queue$/);
  if (req.method === 'GET' && commissionRunQueueMatch) {
    return handleGetCommissionRunQueue(commissionRunQueueMatch[1], authResult.claims);
  }
  const commissionRunRecordApproveMatch = pathname.match(
    /^\/commission-runs\/([^/]+)\/records\/([^/]+)\/approve$/,
  );
  if (req.method === 'POST' && commissionRunRecordApproveMatch) {
    return handleApproveRunRecord(
      commissionRunRecordApproveMatch[1],
      commissionRunRecordApproveMatch[2],
      authResult.claims,
    );
  }
  const commissionRunApproveMatch = pathname.match(/^\/commission-runs\/([^/]+)\/approve$/);
  if (req.method === 'POST' && commissionRunApproveMatch) {
    return handleApproveCommissionRun(commissionRunApproveMatch[1], authResult.claims);
  }
  // POST /commission-runs/:id/export — generate payroll CSV export artifact
  const commissionRunExportMatch = pathname.match(/^\/commission-runs\/([^/]+)\/export$/);
  if (req.method === 'POST' && commissionRunExportMatch) {
    return handleCreatePayrollExport(commissionRunExportMatch[1], authResult.claims);
  }
  // GET /commission-runs/:id/exports — list export artifacts for a run
  const commissionRunExportsListMatch = pathname.match(/^\/commission-runs\/([^/]+)\/exports$/);
  if (req.method === 'GET' && commissionRunExportsListMatch) {
    return handleListPayrollExports(commissionRunExportsListMatch[1], authResult.claims);
  }

  // Contributor routes — authenticated (session cookie), scoped to tenant
  const contributorBaseMatch = pathname.match(/^\/placements\/([^/]+)\/contributors$/);
  if (req.method === 'POST' && contributorBaseMatch) {
    return handleAddContributor(contributorBaseMatch[1], req, authResult.claims);
  }
  if (req.method === 'GET' && contributorBaseMatch) {
    return handleListContributors(contributorBaseMatch[1], authResult.claims);
  }
  const validateSplitMatch = pathname.match(
    /^\/placements\/([^/]+)\/contributors\/validate-split$/,
  );
  if (req.method === 'POST' && validateSplitMatch) {
    return handleValidateSplit(validateSplitMatch[1], authResult.claims);
  }
  const contributorDeleteMatch = pathname.match(/^\/placements\/([^/]+)\/contributors\/([^/]+)$/);
  if (req.method === 'DELETE' && contributorDeleteMatch) {
    return handleDeleteContributor(
      contributorDeleteMatch[1],
      contributorDeleteMatch[2],
      authResult.claims,
    );
  }

  // Attribution routes — authenticated (session cookie), scoped to tenant
  const attributionSubmitMatch = pathname.match(/^\/placements\/([^/]+)\/attribution\/submit$/);
  if (req.method === 'POST' && attributionSubmitMatch) {
    return handleSubmitAttribution(attributionSubmitMatch[1], authResult.claims);
  }
  const attributionApproveMatch = pathname.match(/^\/placements\/([^/]+)\/attribution\/approve$/);
  if (req.method === 'POST' && attributionApproveMatch) {
    return handleApproveAttribution(attributionApproveMatch[1], authResult.claims);
  }
  const attributionRejectMatch = pathname.match(/^\/placements\/([^/]+)\/attribution\/reject$/);
  if (req.method === 'POST' && attributionRejectMatch) {
    return handleRejectAttribution(attributionRejectMatch[1], req, authResult.claims);
  }
  const attributionTimelineMatch = pathname.match(/^\/placements\/([^/]+)\/attribution\/timeline$/);
  if (req.method === 'GET' && attributionTimelineMatch) {
    return handleAttributionTimeline(attributionTimelineMatch[1], authResult.claims);
  }

  // Commission plan routes — authenticated (session cookie), scoped to tenant
  if (req.method === 'POST' && pathname === '/plans') {
    return handleCreatePlan(req, authResult.claims);
  }
  if (req.method === 'GET' && pathname === '/plans') {
    return handleListPlans(req, authResult.claims);
  }
  // /plans/:id/versions/:vid/activate — must match before generic version routes
  const planVersionActivateMatch = pathname.match(
    /^\/plans\/([^/]+)\/versions\/([^/]+)\/activate$/,
  );
  if (req.method === 'POST' && planVersionActivateMatch) {
    return handleActivatePlanVersion(
      planVersionActivateMatch[1],
      planVersionActivateMatch[2],
      authResult.claims,
    );
  }
  const planVersionsMatch = pathname.match(/^\/plans\/([^/]+)\/versions$/);
  if (req.method === 'POST' && planVersionsMatch) {
    return handleCreatePlanVersion(planVersionsMatch[1], req, authResult.claims);
  }
  if (req.method === 'GET' && planVersionsMatch) {
    return handleListPlanVersions(planVersionsMatch[1], authResult.claims);
  }
  const planActiveMatch = pathname.match(/^\/plans\/([^/]+)\/active$/);
  if (req.method === 'GET' && planActiveMatch) {
    return handleGetActivePlanVersion(planActiveMatch[1], authResult.claims);
  }
  const planAssignmentsMatch = pathname.match(/^\/plans\/([^/]+)\/assignments$/);
  if (req.method === 'POST' && planAssignmentsMatch) {
    return handleCreatePlanAssignment(planAssignmentsMatch[1], req, authResult.claims);
  }
  if (req.method === 'GET' && planAssignmentsMatch) {
    return handleListPlanAssignments(planAssignmentsMatch[1], authResult.claims);
  }

  // Commission calculation routes — POST /placements/:id/calculate
  const calculateMatch = pathname.match(/^\/placements\/([^/]+)\/calculate$/);
  if (req.method === 'POST' && calculateMatch) {
    return handleCalculateCommission(calculateMatch[1], req, authResult.claims);
  }

  // Commission records list — GET /placements/:id/commission-records
  const commissionRecordsMatch = pathname.match(/^\/placements\/([^/]+)\/commission-records$/);
  if (req.method === 'GET' && commissionRecordsMatch) {
    return handleListCommissionRecords(commissionRecordsMatch[1], authResult.claims);
  }

  // Commission record by ID — GET /commission-records/:id
  const commissionRecordGetMatch = pathname.match(/^\/commission-records\/([^/]+)$/);
  if (req.method === 'GET' && commissionRecordGetMatch) {
    return handleGetCommissionRecord(commissionRecordGetMatch[1], authResult.claims);
  }
  // PATCH /commission-records/:id — immutability guard (returns 409 if in an Approved run)
  const commissionRecordPatchMatch = pathname.match(/^\/commission-records\/([^/]+)$/);
  if (req.method === 'PATCH' && commissionRecordPatchMatch) {
    return handlePatchCommissionRecord(commissionRecordPatchMatch[1], authResult.claims);
  }

  // Commission records list (global) — GET /commission-records?reason=...
  if (req.method === 'GET' && pathname === '/commission-records') {
    return handleListAllCommissionRecords(req, authResult.claims);
  }

  // Invoice routes — authenticated (session cookie), scoped to tenant
  if (req.method === 'POST' && pathname === '/invoices/import') {
    return handleImportInvoices(req, authResult.claims);
  }
  if (req.method === 'POST' && pathname === '/invoices') {
    return handleCreateInvoice(req, authResult.claims);
  }
  const invoicePatchMatch = pathname.match(/^\/invoices\/([^/]+)$/);
  if (req.method === 'PATCH' && invoicePatchMatch) {
    return handleUpdateInvoice(invoicePatchMatch[1], req, authResult.claims);
  }

  // Exception workflow routes — authenticated (session cookie), scoped to tenant
  if (req.method === 'POST' && pathname === '/exceptions') {
    return handleCreateException(req, authResult.claims);
  }
  if (req.method === 'GET' && pathname === '/exceptions') {
    return handleListExceptions(req, authResult.claims);
  }
  const exceptionApproveMatch = pathname.match(/^\/exceptions\/([^/]+)\/approve$/);
  if (req.method === 'POST' && exceptionApproveMatch) {
    return handleApproveException(exceptionApproveMatch[1], authResult.claims);
  }
  const exceptionRejectMatch = pathname.match(/^\/exceptions\/([^/]+)\/reject$/);
  if (req.method === 'POST' && exceptionRejectMatch) {
    return handleRejectException(exceptionRejectMatch[1], req, authResult.claims);
  }
  const exceptionGetMatch = pathname.match(/^\/exceptions\/([^/]+)$/);
  if (req.method === 'GET' && exceptionGetMatch) {
    return handleGetException(exceptionGetMatch[1], authResult.claims);
  }

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

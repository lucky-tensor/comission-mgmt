/**
 * Payout dispute and question submission API routes.
 *
 * Routes:
 *   POST /disputes                  — Producer submits a dispute against a CommissionRecord
 *   GET  /disputes                  — Finance Admin: all tenant disputes; Producer: own only
 *   POST /disputes/:id/resolve      — Finance Admin: resolve with resolution_note
 *
 * Dispute state lifecycle: Submitted → UnderReview → Resolved
 *
 * RBAC:
 *   POST /disputes          — Producer (and FinanceAdmin) may create disputes.
 *   GET  /disputes          — Producers see only their own; FinanceAdmin sees all tenant disputes.
 *   POST /disputes/:id/resolve — Finance Admin only; Producer returns 403.
 *
 * Audit: resolving a dispute writes an AuditLogEntry to the audit DB.
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 *
 * Injectable sql (for testing): all handler functions accept optional SqlClient args.
 *
 * Canonical docs: docs/prd.md §5.8, §4
 * Issue: feat: payout dispute and question submission (#18)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import {
  createDispute,
  getDispute,
  listDisputes,
  listDisputesByProducer,
  resolveDispute,
} from 'db/index';
import type { SessionClaims } from 'core/auth';
import { sensitiveRead } from '../audit/sensitive-read';

type SqlClient = Sql;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number, fields?: Record<string, string>): Response {
  return jsonResponse({ error: message, ...(fields ? { fields } : {}) }, status);
}

function formatDispute(row: {
  id: string;
  orgId: string;
  commissionRecordId: string;
  submittedBy: string;
  description: string;
  state: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  exceptionId: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    org_id: row.orgId,
    commission_record_id: row.commissionRecordId,
    submitted_by: row.submittedBy,
    description: row.description,
    state: row.state,
    resolved_by: row.resolvedBy,
    resolved_at: row.resolvedAt,
    resolution_note: row.resolutionNote,
    exception_id: row.exceptionId,
    created_at: row.createdAt,
  };
}

/**
 * Write an AuditLogEntry for a dispute state transition.
 * Failures are logged but do not propagate (audit writes are best-effort).
 */
async function writeDisputeAuditLog(
  auditSql: SqlClient,
  opts: {
    orgId: string;
    actorId: string;
    action: string;
    entityId: string;
    beforeJson?: unknown;
    afterJson: unknown;
  },
): Promise<void> {
  try {
    await auditSql.unsafe(
      `
      INSERT INTO audit_log_entries (
        org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        opts.orgId,
        opts.actorId,
        'User',
        opts.action,
        'dispute',
        opts.entityId,
        opts.beforeJson ?? null,
        opts.afterJson,
      ],
    );
  } catch (err: unknown) {
    console.error('[disputes] audit log write error (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// POST /disputes — Producer submits a dispute
// ---------------------------------------------------------------------------

export interface CreateDisputeBody {
  commission_record_id: string;
  description: string;
}

/**
 * POST /disputes — submits a new dispute with state=Submitted.
 *
 * Required fields: commission_record_id, description.
 *
 * Returns 201 with the created dispute.
 * Returns 422 if required fields are missing.
 *
 * @param req            - HTTP request with JSON body
 * @param claims         - Session claims (org_id, user_id, role)
 * @param sqlClient      - Optional injectable SQL client (for testing)
 * @param auditSqlClient - Optional injectable audit SQL client (for testing)
 */
export async function handleCreateDispute(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<CreateDisputeBody>;
  try {
    body = (await req.json()) as Partial<CreateDisputeBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const errors: Record<string, string> = {};
  if (!body.commission_record_id)
    errors['commission_record_id'] = 'commission_record_id is required';
  if (!body.description || String(body.description).trim() === '')
    errors['description'] = 'description is required';

  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  try {
    const dispute = await createDispute(db, {
      orgId: claims.org_id,
      commissionRecordId: body.commission_record_id!,
      submittedBy: claims.user_id,
      description: body.description!,
    });

    await writeDisputeAuditLog(adb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      action: 'dispute.submitted',
      entityId: dispute.id,
      afterJson: { state: dispute.state, commission_record_id: dispute.commissionRecordId },
    });

    return jsonResponse(formatDispute(dispute), 201);
  } catch (err: unknown) {
    console.error('[disputes] create error:', err);
    return errorResponse('Failed to create dispute', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /disputes — list disputes (role-scoped)
// ---------------------------------------------------------------------------

/**
 * GET /disputes — lists disputes for the tenant.
 *
 * - Finance Admin: sees all disputes for the org.
 * - Producer: sees only their own disputes (submitted_by = claims.user_id).
 *
 * Returns 200 with { disputes: [...] }.
 *
 * @param claims    - Session claims (role determines scope)
 * @param sqlClient - Optional injectable SQL client (for testing)
 */
export async function handleListDisputes(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  try {
    // Audit-before-read: a failed audit write denies the read (DATA-D-010).
    const rows = await sensitiveRead(
      adb,
      {
        orgId: claims.org_id,
        actorId: claims.user_id,
        action: 'dispute.list',
        entityType: 'dispute',
        entityId: claims.org_id,
      },
      () =>
        claims.role === 'FinanceAdmin'
          ? listDisputes(db, claims.org_id)
          : // All non-admin roles (including Producer) see only their own disputes
            listDisputesByProducer(db, claims.org_id, claims.user_id),
    );

    return jsonResponse({ disputes: rows.map(formatDispute) });
  } catch (err: unknown) {
    console.error('[disputes] list error:', err);
    return errorResponse('Failed to list disputes', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /disputes/:id/resolve — Finance Admin resolves a dispute
// ---------------------------------------------------------------------------

export interface ResolveDisputeBody {
  resolution_note: string;
  exception_id?: string | null;
}

/**
 * POST /disputes/:id/resolve — Finance Admin resolves a dispute.
 *
 * Requires a `resolution_note` field in the request body.
 * Optionally links to an `exception_id` if an exception was created.
 * An AuditLogEntry is written for the state transition.
 *
 * RBAC: Finance Admin only. Producer returns 403.
 *
 * Returns 200 with the updated dispute.
 * Returns 403 for non-Finance Admin.
 * Returns 404 if dispute not found.
 * Returns 409 if already Resolved.
 *
 * @param disputeId      - Dispute UUID from the route
 * @param req            - HTTP request with JSON body
 * @param claims         - Session claims
 * @param sqlClient      - Optional injectable SQL client (for testing)
 * @param auditSqlClient - Optional injectable audit SQL client (for testing)
 */
export async function handleResolveDispute(
  disputeId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  if (claims.role !== 'FinanceAdmin') {
    return errorResponse('Forbidden: Finance Admin role required', 403);
  }

  let body: Partial<ResolveDisputeBody>;
  try {
    body = (await req.json()) as Partial<ResolveDisputeBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.resolution_note || String(body.resolution_note).trim() === '') {
    return errorResponse('Validation failed', 422, {
      resolution_note: 'resolution_note is required',
    });
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Fetch first to check state
  let existing;
  try {
    existing = await getDispute(db, claims.org_id, disputeId);
  } catch (err: unknown) {
    console.error('[disputes] get dispute error:', err);
    return errorResponse('Failed to retrieve dispute', 500);
  }

  if (!existing) {
    return errorResponse('Dispute not found', 404);
  }

  if (existing.state === 'Resolved') {
    return errorResponse('Dispute is already Resolved', 409);
  }

  let resolved;
  try {
    resolved = await resolveDispute(
      db,
      claims.org_id,
      disputeId,
      claims.user_id,
      body.resolution_note,
      body.exception_id ?? null,
    );
  } catch (err: unknown) {
    console.error('[disputes] resolve error:', err);
    return errorResponse('Failed to resolve dispute', 500);
  }

  if (!resolved) {
    return errorResponse('Dispute not found or already resolved', 404);
  }

  await writeDisputeAuditLog(adb, {
    orgId: claims.org_id,
    actorId: claims.user_id,
    action: 'dispute.resolved',
    entityId: resolved.id,
    beforeJson: { state: existing.state },
    afterJson: { state: resolved.state, resolution_note: resolved.resolutionNote },
  });

  return jsonResponse(formatDispute(resolved));
}

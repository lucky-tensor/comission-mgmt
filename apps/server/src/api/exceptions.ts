/**
 * Exception request and approval workflow API routes.
 *
 * Routes:
 *   POST   /exceptions                     — submit an exception request
 *   GET    /exceptions                     — Finance Admin: list exceptions, optional ?state=
 *   GET    /exceptions/:id                 — fetch a single exception
 *   POST   /exceptions/:id/approve         — Finance Admin: approve and post ledger adjustment
 *   POST   /exceptions/:id/reject          — Finance Admin: reject with reason
 *
 * Exception types: custom_split, fee_discount, accelerated_payout, manual_override,
 *   draw_forgiveness, clawback_waiver, special_partner_agreement, post_termination_payout
 *
 * State lifecycle: Requested → UnderReview → Approved / Rejected
 *
 * RBAC: POST /exceptions is open to any authenticated user.
 *   POST /exceptions/:id/approve and POST /exceptions/:id/reject are Finance Admin only.
 *
 * Audit: every state transition writes an AuditLogEntry to the audit DB.
 *
 * Ledger adjustment: on Approved, if impact_amount and commission_record_id are set,
 *   net_payable on the linked CommissionRecord is incremented by impact_amount.
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 *
 * Injectable sql (for testing): all handler functions accept optional SqlClient args.
 *
 * Canonical docs: docs/prd.md §5.4, §7.5
 * Issue: feat: exception request and approval workflow (#14)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import {
  createException,
  getException,
  listExceptions,
  approveException,
  rejectException,
  EXCEPTION_TYPES,
} from 'db/exceptions';
import { adjustNetPayable } from 'db/commission-records';
import type { SessionClaims } from 'core/auth';

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

function formatException(row: {
  id: string;
  orgId: string;
  placementId: string;
  commissionRecordId: string | null;
  requestedBy: string;
  exceptionType: string;
  justification: string;
  impactAmount: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  attachmentUrl: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    org_id: row.orgId,
    placement_id: row.placementId,
    commission_record_id: row.commissionRecordId,
    requested_by: row.requestedBy,
    exception_type: row.exceptionType,
    justification: row.justification,
    impact_amount: row.impactAmount,
    status: row.status,
    reviewed_by: row.reviewedBy,
    reviewed_at: row.reviewedAt,
    rejection_reason: row.rejectionReason,
    attachment_url: row.attachmentUrl,
    created_at: row.createdAt,
  };
}

/**
 * Write an AuditLogEntry for an exception state transition.
 * Failures are logged but do not propagate (audit writes are best-effort).
 */
async function writeExceptionAuditLog(
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
    const beforeJsonStr = opts.beforeJson != null ? JSON.stringify(opts.beforeJson) : null;
    const afterJsonStr = JSON.stringify(opts.afterJson);

    await auditSql.unsafe(
      `
      INSERT INTO audit_log_entries (
        org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      `,
      [
        opts.orgId,
        opts.actorId,
        'User',
        opts.action,
        'exception',
        opts.entityId,
        beforeJsonStr,
        afterJsonStr,
      ],
    );
  } catch (err: unknown) {
    console.error('[exceptions] audit log write error (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// POST /exceptions — submit an exception request
// ---------------------------------------------------------------------------

export interface CreateExceptionBody {
  placement_id: string;
  commission_record_id?: string | null;
  exception_type: string;
  reason: string;
  impact_amount?: string | null;
  attachment_url?: string | null;
}

/**
 * POST /exceptions — submits a new exception request with state=Requested.
 *
 * Required fields: placement_id, exception_type, reason.
 * Optional: commission_record_id, impact_amount, attachment_url.
 *
 * Returns 201 with the created exception.
 * Returns 422 if required fields are missing or exception_type is invalid.
 *
 * @param sqlClient      - Optional injectable SQL client (for testing).
 * @param auditSqlClient - Optional injectable audit SQL client (for testing).
 */
export async function handleCreateException(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  // Handle multipart/form-data (attachment upload) or JSON
  const contentType = req.headers.get('content-type') ?? '';
  let body: Partial<CreateExceptionBody>;
  let attachmentUrl: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return errorResponse('Failed to parse multipart form data', 400);
    }

    body = {
      placement_id: (formData.get('placement_id') as string) ?? undefined,
      commission_record_id: (formData.get('commission_record_id') as string) ?? null,
      exception_type: (formData.get('exception_type') as string) ?? undefined,
      reason: (formData.get('reason') as string) ?? undefined,
      impact_amount: (formData.get('impact_amount') as string) ?? null,
    };

    // Store a synthetic attachment URL representing the uploaded file name
    const file = formData.get('attachment');
    if (file && typeof file !== 'string') {
      const f = file as File;
      attachmentUrl = `uploads/${Date.now()}-${f.name}`;
    }
  } else {
    try {
      body = (await req.json()) as Partial<CreateExceptionBody>;
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }
    attachmentUrl = body.attachment_url ?? null;
  }

  const errors: Record<string, string> = {};
  if (!body.placement_id) errors['placement_id'] = 'placement_id is required';
  if (!body.exception_type) errors['exception_type'] = 'exception_type is required';
  if (!body.reason || String(body.reason).trim() === '') errors['reason'] = 'reason is required';

  if (body.exception_type && !(EXCEPTION_TYPES as string[]).includes(body.exception_type)) {
    errors['exception_type'] = `exception_type must be one of: ${EXCEPTION_TYPES.join(', ')}`;
  }

  if (body.impact_amount !== undefined && body.impact_amount !== null) {
    if (isNaN(Number(body.impact_amount))) {
      errors['impact_amount'] = 'impact_amount must be a numeric string';
    }
  }

  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  try {
    const exception = await createException(db, {
      orgId: claims.org_id,
      placementId: body.placement_id!,
      commissionRecordId: body.commission_record_id ?? null,
      requestedBy: claims.user_id,
      exceptionType: body.exception_type!,
      justification: body.reason!,
      impactAmount: body.impact_amount ?? null,
      attachmentUrl,
    });

    await writeExceptionAuditLog(adb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      action: 'exception.requested',
      entityId: exception.id,
      afterJson: { status: exception.status, exception_type: exception.exceptionType },
    });

    return jsonResponse(formatException(exception), 201);
  } catch (err: unknown) {
    console.error('[exceptions] create error:', err);
    return errorResponse('Failed to create exception request', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /exceptions — list exceptions (Finance Admin), optional ?state= filter
// ---------------------------------------------------------------------------

/**
 * GET /exceptions — lists exceptions for the tenant.
 *
 * Query params:
 *   ?state=Requested — filter by exception_state enum value
 *
 * Returns 200 with { exceptions: [...] }.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleListExceptions(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const url = new URL(req.url);
  const state = url.searchParams.get('state');

  try {
    const rows = await listExceptions(db, claims.org_id, state ?? null);
    return jsonResponse({ exceptions: rows.map(formatException) });
  } catch (err: unknown) {
    console.error('[exceptions] list error:', err);
    return errorResponse('Failed to list exceptions', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /exceptions/:id — fetch a single exception
// ---------------------------------------------------------------------------

/**
 * GET /exceptions/:id — returns a single exception by ID.
 *
 * Returns 404 if not found or belongs to a different tenant.
 *
 * @param exceptionId - Exception UUID from the route.
 * @param sqlClient   - Optional injectable SQL client (for testing).
 */
export async function handleGetException(
  exceptionId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  try {
    const exception = await getException(db, claims.org_id, exceptionId);
    if (!exception) {
      return errorResponse('Exception not found', 404);
    }
    return jsonResponse(formatException(exception));
  } catch (err: unknown) {
    console.error('[exceptions] get error:', err);
    return errorResponse('Failed to retrieve exception', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /exceptions/:id/approve — Finance Admin approves and posts ledger adjustment
// ---------------------------------------------------------------------------

/**
 * POST /exceptions/:id/approve — Finance Admin approves the exception.
 *
 * If the exception has impact_amount and commission_record_id set, the
 * net_payable on the linked CommissionRecord is incremented by impact_amount.
 * An AuditLogEntry is written for the state transition.
 *
 * RBAC: Finance Admin only. Returns 403 for Producer or other non-admin roles.
 *
 * Returns 200 with the updated exception.
 * Returns 404 if exception not found.
 * Returns 409 if already Approved or Rejected.
 *
 * @param exceptionId    - Exception UUID.
 * @param sqlClient      - Optional injectable SQL client (for testing).
 * @param auditSqlClient - Optional injectable audit SQL client (for testing).
 */
export async function handleApproveException(
  exceptionId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  if (claims.role !== 'FinanceAdmin') {
    return errorResponse('Forbidden: Finance Admin role required', 403);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Fetch the exception first (to check state and get adjustment params)
  let existing;
  try {
    existing = await getException(db, claims.org_id, exceptionId);
  } catch (err: unknown) {
    console.error('[exceptions] get exception error:', err);
    return errorResponse('Failed to retrieve exception', 500);
  }

  if (!existing) {
    return errorResponse('Exception not found', 404);
  }

  if (existing.status === 'Approved' || existing.status === 'Rejected') {
    return errorResponse(`Exception is already ${existing.status}`, 409);
  }

  // Approve the exception
  let approved;
  try {
    approved = await approveException(db, claims.org_id, exceptionId, claims.user_id);
  } catch (err: unknown) {
    console.error('[exceptions] approve error:', err);
    return errorResponse('Failed to approve exception', 500);
  }

  if (!approved) {
    return errorResponse('Exception not found or already reviewed', 404);
  }

  // Apply ledger adjustment when both impact_amount and commission_record_id are present
  let ledgerAdjusted = false;
  if (approved.impactAmount !== null && approved.commissionRecordId !== null) {
    try {
      const newNetPayable = await adjustNetPayable(
        db,
        claims.org_id,
        approved.commissionRecordId,
        parseFloat(approved.impactAmount),
      );
      if (newNetPayable !== null) {
        ledgerAdjusted = true;
      }
    } catch (err: unknown) {
      console.error('[exceptions] ledger adjustment error:', err);
      // Non-fatal — log but continue; the exception is still approved
    }
  }

  await writeExceptionAuditLog(adb, {
    orgId: claims.org_id,
    actorId: claims.user_id,
    action: 'exception.approved',
    entityId: approved.id,
    beforeJson: { status: existing.status },
    afterJson: {
      status: approved.status,
      impact_amount: approved.impactAmount,
      ledger_adjusted: ledgerAdjusted,
    },
  });

  return jsonResponse({
    ...formatException(approved),
    ledger_adjusted: ledgerAdjusted,
  });
}

// ---------------------------------------------------------------------------
// POST /exceptions/:id/reject — Finance Admin rejects with reason
// ---------------------------------------------------------------------------

/**
 * POST /exceptions/:id/reject — Finance Admin rejects the exception.
 *
 * Requires a `reason` field in the request body.
 * An AuditLogEntry is written for the state transition.
 *
 * RBAC: Finance Admin only. Returns 403 for Producer or other non-admin roles.
 *
 * Returns 200 with the updated exception.
 * Returns 404 if exception not found.
 * Returns 409 if already Approved or Rejected.
 *
 * @param exceptionId    - Exception UUID.
 * @param sqlClient      - Optional injectable SQL client (for testing).
 * @param auditSqlClient - Optional injectable audit SQL client (for testing).
 */
export async function handleRejectException(
  exceptionId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  if (claims.role !== 'FinanceAdmin') {
    return errorResponse('Forbidden: Finance Admin role required', 403);
  }

  let body: { reason?: string };
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.reason || String(body.reason).trim() === '') {
    return errorResponse('Validation failed', 422, { reason: 'reason is required' });
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Fetch first to check state
  let existing;
  try {
    existing = await getException(db, claims.org_id, exceptionId);
  } catch (err: unknown) {
    console.error('[exceptions] get exception error:', err);
    return errorResponse('Failed to retrieve exception', 500);
  }

  if (!existing) {
    return errorResponse('Exception not found', 404);
  }

  if (existing.status === 'Approved' || existing.status === 'Rejected') {
    return errorResponse(`Exception is already ${existing.status}`, 409);
  }

  let rejected;
  try {
    rejected = await rejectException(db, claims.org_id, exceptionId, claims.user_id, body.reason);
  } catch (err: unknown) {
    console.error('[exceptions] reject error:', err);
    return errorResponse('Failed to reject exception', 500);
  }

  if (!rejected) {
    return errorResponse('Exception not found or already reviewed', 404);
  }

  await writeExceptionAuditLog(adb, {
    orgId: claims.org_id,
    actorId: claims.user_id,
    action: 'exception.rejected',
    entityId: rejected.id,
    beforeJson: { status: existing.status },
    afterJson: { status: rejected.status, rejection_reason: rejected.rejectionReason },
  });

  return jsonResponse(formatException(rejected));
}

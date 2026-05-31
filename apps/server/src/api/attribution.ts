/**
 * Attribution API routes — manager split approval workflow and attribution timeline.
 *
 * Routes:
 *   POST  /placements/:id/attribution/submit   — submit for manager approval
 *   POST  /placements/:id/attribution/approve  — Manager approves (role-gated)
 *   POST  /placements/:id/attribution/reject   — Manager rejects with reason (role-gated)
 *   GET   /placements/:id/attribution/timeline — ordered attribution event history
 *
 * State transitions:
 *   submit:  ContributorsAssigned → PendingApproval
 *   approve: PendingApproval      → Active
 *   reject:  PendingApproval      → ContributorsAssigned
 *
 * RBAC:
 *   approve and reject are restricted to the Manager role (returns 403 otherwise).
 *   submit is available to any authenticated user with access to the placement.
 *
 * Audit:
 *   Each submit/approve/reject writes an AuditLogEntry via the audit SQL pool.
 *   Attribution events are also persisted in attribution_events for the timeline.
 *
 * Injectable sql / auditSql (for testing):
 *   All handler functions accept optional sql clients.
 *
 * Canonical docs: docs/prd.md §5.2
 * Issue: feat: manager split approval workflow and attribution timeline (#8)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import { getPlacement, updatePlacement } from 'db/placements';
import { createAttributionEvent, listAttributionEvents } from 'db/attribution';
import type { SessionClaims } from 'core/auth';
import type { PlacementStatus } from 'db/placements';

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

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Writes an AuditLogEntry for an attribution action.
 * Failures are logged but do not propagate.
 */
async function writeAuditLog(
  auditSql: SqlClient,
  opts: {
    orgId: string;
    actorId: string;
    action: string;
    entityId: string;
    afterJson: unknown;
  },
): Promise<void> {
  try {
    await auditSql.unsafe(
      `
      INSERT INTO audit_log_entries (
        org_id, actor_id, actor_type, action, entity_type, entity_id, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        opts.orgId,
        opts.actorId,
        'User',
        opts.action,
        'Placement',
        opts.entityId,
        opts.afterJson,
      ],
    );
  } catch (err) {
    console.error('[attribution] audit write error:', err);
  }
}

// ---------------------------------------------------------------------------
// POST /placements/:id/attribution/submit
// ---------------------------------------------------------------------------

/**
 * Submit placement attribution for manager approval.
 *
 * Requires placement to be in ContributorsAssigned state.
 * Transitions placement to PendingApproval.
 * Records a Submitted attribution event.
 *
 * Returns 422 when the placement is not in a valid state for submission.
 * Returns 404 when the placement does not exist or belongs to a different tenant.
 */
export async function handleSubmitAttribution(
  placementId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const auditDb = auditSqlClient ?? defaultAuditSql;

  try {
    const placement = await getPlacement(db, placementId);
    if (!placement) return errorResponse('Placement not found', 404);
    if (placement.orgId !== claims.org_id) return errorResponse('Placement not found', 404);

    if (placement.status !== 'ContributorsAssigned') {
      return errorResponse(
        `Invalid state transition: placement is in '${placement.status}', expected 'ContributorsAssigned'`,
        422,
      );
    }

    const updated = await updatePlacement(
      db,
      placementId,
      {
        status: 'PendingApproval' as PlacementStatus,
      },
      claims.org_id,
    );

    if (!updated) return errorResponse('Placement not found', 404);

    await createAttributionEvent(db, {
      orgId: claims.org_id,
      placementId,
      eventType: 'Submitted',
      actorId: claims.user_id,
    });

    await writeAuditLog(auditDb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      action: 'AttributionSubmitted',
      entityId: placementId,
      afterJson: { placement_id: placementId, status: 'PendingApproval' },
    });

    return jsonResponse({
      placement_id: updated.id,
      status: updated.status,
    });
  } catch (err: unknown) {
    console.error('[attribution] submit error:', err);
    return errorResponse('Failed to submit attribution', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /placements/:id/attribution/approve
// ---------------------------------------------------------------------------

/**
 * Approve placement attribution splits (Manager role only).
 *
 * Requires placement to be in PendingApproval state.
 * Transitions placement to Active.
 * Records an Approved attribution event.
 *
 * Returns 403 when caller is not a Manager.
 * Returns 422 when the placement is not in a valid state for approval.
 */
export async function handleApproveAttribution(
  placementId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  if (claims.role !== 'Manager') {
    return errorResponse('Forbidden', 403);
  }

  const db = sqlClient ?? defaultSql;
  const auditDb = auditSqlClient ?? defaultAuditSql;

  try {
    const placement = await getPlacement(db, placementId);
    if (!placement) return errorResponse('Placement not found', 404);
    if (placement.orgId !== claims.org_id) return errorResponse('Placement not found', 404);

    if (placement.status !== 'PendingApproval') {
      return errorResponse(
        `Invalid state transition: placement is in '${placement.status}', expected 'PendingApproval'`,
        422,
      );
    }

    const updated = await updatePlacement(
      db,
      placementId,
      {
        status: 'Active' as PlacementStatus,
      },
      claims.org_id,
    );

    if (!updated) return errorResponse('Placement not found', 404);

    await createAttributionEvent(db, {
      orgId: claims.org_id,
      placementId,
      eventType: 'Approved',
      actorId: claims.user_id,
    });

    await writeAuditLog(auditDb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      action: 'AttributionApproved',
      entityId: placementId,
      afterJson: { placement_id: placementId, status: 'Active', approved_by: claims.user_id },
    });

    return jsonResponse({
      placement_id: updated.id,
      status: updated.status,
    });
  } catch (err: unknown) {
    console.error('[attribution] approve error:', err);
    return errorResponse('Failed to approve attribution', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /placements/:id/attribution/reject
// ---------------------------------------------------------------------------

export interface RejectAttributionBody {
  reason: string;
}

/**
 * Reject placement attribution splits (Manager role only).
 *
 * Requires placement to be in PendingApproval state.
 * Transitions placement back to ContributorsAssigned.
 * Records a Rejected attribution event with the rejection reason.
 *
 * Returns 403 when caller is not a Manager.
 * Returns 422 when the placement is not in a valid state for rejection.
 * Returns 422 when reason is missing.
 */
export async function handleRejectAttribution(
  placementId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  if (claims.role !== 'Manager') {
    return errorResponse('Forbidden', 403);
  }

  let body: Partial<RejectAttributionBody>;
  try {
    body = (await req.json()) as Partial<RejectAttributionBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.reason || body.reason.trim() === '') {
    return errorResponse('reason is required', 422);
  }

  const db = sqlClient ?? defaultSql;
  const auditDb = auditSqlClient ?? defaultAuditSql;

  try {
    const placement = await getPlacement(db, placementId);
    if (!placement) return errorResponse('Placement not found', 404);
    if (placement.orgId !== claims.org_id) return errorResponse('Placement not found', 404);

    if (placement.status !== 'PendingApproval') {
      return errorResponse(
        `Invalid state transition: placement is in '${placement.status}', expected 'PendingApproval'`,
        422,
      );
    }

    const updated = await updatePlacement(
      db,
      placementId,
      {
        status: 'ContributorsAssigned' as PlacementStatus,
      },
      claims.org_id,
    );

    if (!updated) return errorResponse('Placement not found', 404);

    await createAttributionEvent(db, {
      orgId: claims.org_id,
      placementId,
      eventType: 'Rejected',
      actorId: claims.user_id,
      reason: body.reason,
    });

    await writeAuditLog(auditDb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      action: 'AttributionRejected',
      entityId: placementId,
      afterJson: {
        placement_id: placementId,
        status: 'ContributorsAssigned',
        rejected_by: claims.user_id,
        reason: body.reason,
      },
    });

    return jsonResponse({
      placement_id: updated.id,
      status: updated.status,
      reason: body.reason,
    });
  } catch (err: unknown) {
    console.error('[attribution] reject error:', err);
    return errorResponse('Failed to reject attribution', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /placements/:id/attribution/timeline
// ---------------------------------------------------------------------------

/**
 * Return the ordered attribution event history for a placement.
 *
 * Events are returned in chronological order (oldest first).
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 */
export async function handleAttributionTimeline(
  placementId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  try {
    const placement = await getPlacement(db, placementId);
    if (!placement) return errorResponse('Placement not found', 404);
    if (placement.orgId !== claims.org_id) return errorResponse('Placement not found', 404);

    const events = await listAttributionEvents(db, claims.org_id, placementId);

    return jsonResponse(
      events.map((e) => ({
        id: e.id,
        placement_id: e.placementId,
        event_type: e.eventType,
        actor_id: e.actorId,
        reason: e.reason,
        created_at: e.createdAt,
      })),
    );
  } catch (err: unknown) {
    console.error('[attribution] timeline error:', err);
    return errorResponse('Failed to fetch attribution timeline', 500);
  }
}

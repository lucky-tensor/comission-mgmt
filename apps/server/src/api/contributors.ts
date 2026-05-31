/**
 * Contributors API routes.
 *
 * Routes:
 *   POST   /placements/:id/contributors          — assign a contributor with role and split_pct
 *   DELETE /placements/:id/contributors/:cid     — remove a contributor
 *   GET    /placements/:id/contributors          — list all contributors for a placement
 *
 * Validation:
 *   - role must be one of the 8 PRD contributor roles
 *   - split_pct must be a positive number in range (0, 1]
 *   - Placement must exist and belong to the session org
 *
 * Finalization guard:
 *   - When a caller includes { finalize: true } in the POST body, split_pct values
 *     across all contributors are checked to sum to 1.0 (100%). Returns 422 if not.
 *
 * Audit:
 *   - Each add/remove operation writes an AuditLogEntry via the audit SQL pool.
 *
 * Injectable sql / auditSql (for testing):
 *   All handler functions accept optional sql clients so tests can inject
 *   an ephemeral Postgres connection.
 *
 * Canonical docs: docs/prd.md §5.2
 * Issue: feat: contribution assignment — contributor roles and split credit
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import {
  createContributor,
  listContributors,
  deleteContributor,
  getSplitTotal,
} from 'db/contributors';
import { getPlacement } from 'db/placements';
import { isContributorRole } from 'core/contributor-role';
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

/**
 * Writes an AuditLogEntry row for a contributor assignment or removal.
 * Failures are logged but do not propagate — the main operation is already committed.
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
        'Contributor',
        opts.entityId,
        opts.afterJson as never,
      ],
    );
  } catch (err) {
    console.error('[contributors] audit write error:', err);
  }
}

// ---------------------------------------------------------------------------
// POST /placements/:id/contributors
// ---------------------------------------------------------------------------

export interface AddContributorBody {
  producer_id: string;
  role: string;
  /** Split percentage expressed as a decimal fraction, e.g. 0.25 = 25%. */
  split_pct: number;
  split_override?: boolean;
  /** When true, validates that all split_pct values sum to 1.0 before committing. */
  finalize?: boolean;
}

/**
 * POST /placements/:id/contributors
 *
 * Assigns a contributor to a placement with a role and split percentage.
 * If finalize=true, also validates that the total split across all contributors sums to 1.0.
 *
 * Returns 201 with the new contributor record on success.
 * Returns 422 if validation fails (unknown role, invalid split_pct, split sum ≠ 1.0).
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 */
export async function handleAddContributor(
  placementId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Verify placement exists and belongs to this org
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[contributors] get placement error:', err);
    return errorResponse('Failed to verify placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  // Parse body
  let body: Partial<AddContributorBody>;
  try {
    body = (await req.json()) as Partial<AddContributorBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Validate role
  if (!body.role || !isContributorRole(body.role)) {
    return errorResponse('Validation failed', 422, {
      role: `role must be one of the 8 PRD contributor roles`,
    });
  }

  // Validate split_pct
  if (body.split_pct === undefined || body.split_pct === null) {
    return errorResponse('Validation failed', 422, { split_pct: 'split_pct is required' });
  }

  const splitPct = Number(body.split_pct);
  if (isNaN(splitPct) || splitPct <= 0 || splitPct > 1) {
    return errorResponse('Validation failed', 422, {
      split_pct:
        'split_pct must be a positive decimal fraction between 0 (exclusive) and 1 (inclusive)',
    });
  }

  // Validate producer_id
  if (!body.producer_id || String(body.producer_id).trim() === '') {
    return errorResponse('Validation failed', 422, { producer_id: 'producer_id is required' });
  }

  try {
    const contributor = await createContributor(db, {
      orgId: claims.org_id,
      placementId,
      producerId: body.producer_id,
      roleCode: body.role,
      splitPct,
      splitOverride: body.split_override ?? false,
    });

    // Check finalization: validate split sum = 1.0
    if (body.finalize === true) {
      const total = await getSplitTotal(db, placementId);
      const rounded = Math.round(total * 10000) / 10000;
      if (Math.abs(rounded - 1.0) > 0.0001) {
        // Roll back by deleting the just-inserted contributor
        await deleteContributor(db, claims.org_id, contributor.id);
        return errorResponse(
          `Split percentages must sum to 100% before finalization (current total: ${Math.round(rounded * 10000) / 100}%)`,
          422,
          { split_pct: 'split percentages do not sum to 100%' },
        );
      }
    }

    // Write audit log
    await writeAuditLog(adb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      action: 'ContributorAdded',
      entityId: contributor.id,
      afterJson: {
        placement_id: contributor.placementId,
        producer_id: contributor.producerId,
        role_code: contributor.roleCode,
        split_pct: contributor.splitPct,
      },
    });

    return jsonResponse(
      {
        id: contributor.id,
        org_id: contributor.orgId,
        placement_id: contributor.placementId,
        producer_id: contributor.producerId,
        role: contributor.roleCode,
        split_pct: contributor.splitPct,
        split_override: contributor.splitOverride,
        approved_by: contributor.approvedBy,
        approved_at: contributor.approvedAt,
        created_at: contributor.createdAt,
      },
      201,
    );
  } catch (err: unknown) {
    console.error('[contributors] add error:', err);
    return errorResponse('Failed to add contributor', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /placements/:id/contributors
// ---------------------------------------------------------------------------

/**
 * GET /placements/:id/contributors
 *
 * Lists all contributors for the given placement, scoped to the session org.
 *
 * Returns 200 with an array of contributor records.
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 */
export async function handleListContributors(
  placementId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // Verify placement exists and belongs to this org
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[contributors] get placement error:', err);
    return errorResponse('Failed to verify placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  try {
    const contributors = await listContributors(db, placementId);

    return jsonResponse(
      contributors.map((c) => ({
        id: c.id,
        org_id: c.orgId,
        placement_id: c.placementId,
        producer_id: c.producerId,
        role: c.roleCode,
        split_pct: c.splitPct,
        split_override: c.splitOverride,
        approved_by: c.approvedBy,
        approved_at: c.approvedAt,
        created_at: c.createdAt,
      })),
    );
  } catch (err: unknown) {
    console.error('[contributors] list error:', err);
    return errorResponse('Failed to list contributors', 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /placements/:id/contributors/:contributorId
// ---------------------------------------------------------------------------

/**
 * DELETE /placements/:id/contributors/:contributorId
 *
 * Removes a contributor from a placement, scoped to the session org.
 *
 * Returns 204 on success.
 * Returns 404 if the placement or contributor does not exist or belongs to a different tenant.
 */
export async function handleDeleteContributor(
  placementId: string,
  contributorId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Verify placement exists and belongs to this org
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[contributors] get placement error:', err);
    return errorResponse('Failed to verify placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  try {
    const deleted = await deleteContributor(db, claims.org_id, contributorId);

    if (!deleted) {
      return errorResponse('Contributor not found', 404);
    }

    // Write audit log
    await writeAuditLog(adb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      action: 'ContributorRemoved',
      entityId: contributorId,
      afterJson: {
        placement_id: placementId,
        contributor_id: contributorId,
      },
    });

    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    console.error('[contributors] delete error:', err);
    return errorResponse('Failed to delete contributor', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /placements/:id/contributors/validate-split
// ---------------------------------------------------------------------------

/**
 * POST /placements/:id/contributors/validate-split
 *
 * Validates that split_pct values for all contributors on a placement sum to 1.0 (100%).
 * Used as a pre-finalization check without actually changing placement state.
 *
 * Returns 200 with { valid: true, total: number } if split sums to 1.0.
 * Returns 422 with { valid: false, total: number } if split does not sum to 1.0.
 */
export async function handleValidateSplit(
  placementId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // Verify placement exists and belongs to this org
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[contributors] get placement error:', err);
    return errorResponse('Failed to verify placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  try {
    const total = await getSplitTotal(db, placementId);
    const rounded = Math.round(total * 10000) / 10000;
    const valid = Math.abs(rounded - 1.0) <= 0.0001;

    return jsonResponse({ valid, total: rounded }, valid ? 200 : 422);
  } catch (err: unknown) {
    console.error('[contributors] validate split error:', err);
    return errorResponse('Failed to validate split', 500);
  }
}

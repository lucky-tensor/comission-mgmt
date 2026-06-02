/**
 * Commission Plan API routes.
 *
 * Routes:
 *   POST   /plans                                    — create a plan with initial rules
 *   GET    /plans                                    — list all plans for the tenant
 *   POST   /plans/:id/versions                       — create a new plan version
 *   GET    /plans/:id/versions                       — list all versions for a plan
 *   GET    /plans/:id/active                         — get the currently active version
 *   POST   /plans/:id/versions/:vid/activate         — activate a draft version
 *   POST   /plans/:id/versions/:vid/acknowledge      — producer acknowledges a plan version
 *   POST   /plans/:id/assignments                    — assign a producer to a plan
 *   GET    /plans/:id/assignments                    — list producer assignments (with ack status)
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 * Tier validation: overlapping thresholds return 422.
 *
 * Injectable sql (for testing):
 *   All handler functions accept an optional SqlClient so tests can inject
 *   an ephemeral Postgres connection without touching the module-level pool.
 *
 * Canonical docs: docs/prd.md §5.3, §8.3, §4 (HR / People Ops)
 * Issue: feat: commission plan configuration and versioning (#9)
 * Issue: feat: commission plan acknowledgment (#123)
 */

import {
  createPlan,
  createPlanVersion,
  activatePlanVersion,
  listPlanVersions,
  listPlans,
  getPlan,
  getActivePlanVersion,
  createPlanAssignment,
  listPlanAssignmentsWithAck,
  acknowledgePlanVersion,
  getPlanVersionAcknowledgment,
  validateTiers,
} from 'db/plans';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import type { SessionClaims } from 'core/auth';
import type { Sql } from 'postgres';
import type { PlanRules, TierRule } from 'db/plans';

type SqlClient = Sql;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number, fields?: Record<string, string>): Response {
  return jsonResponse({ error: message, ...(fields ? { fields } : {}) }, status);
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

function validatePlanRules(rules: Partial<PlanRules>): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!rules.rate_type) {
    errors['rate_type'] = 'rate_type is required (gross_fee or net_fee_income)';
  } else if (rules.rate_type !== 'gross_fee' && rules.rate_type !== 'net_fee_income') {
    errors['rate_type'] = 'rate_type must be gross_fee or net_fee_income';
  }

  if (rules.base_rate === undefined || rules.base_rate === null) {
    errors['base_rate'] = 'base_rate is required';
  } else if (typeof rules.base_rate !== 'number' || isNaN(rules.base_rate)) {
    errors['base_rate'] = 'base_rate must be a number';
  } else if (rules.base_rate < 0 || rules.base_rate > 1) {
    errors['base_rate'] = 'base_rate must be between 0 and 1';
  }

  if (rules.tiers !== undefined) {
    if (!Array.isArray(rules.tiers)) {
      errors['tiers'] = 'tiers must be an array';
    } else {
      try {
        validateTiers(rules.tiers as TierRule[]);
      } catch (err: unknown) {
        errors['tiers'] = (err as Error).message;
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// POST /plans — create a plan
// ---------------------------------------------------------------------------

export interface CreatePlanBody {
  name: string;
  effective_from: string;
  effective_to?: string | null;
  rules: PlanRules;
}

/**
 * POST /plans — creates a commission plan with an initial Draft version.
 *
 * Returns 201 with { plan, version } on success.
 * Returns 422 with field errors on validation failure.
 */
export async function handleCreatePlan(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<CreatePlanBody>;
  try {
    body = (await req.json()) as Partial<CreatePlanBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const errors: Record<string, string> = {};

  if (!body.name || String(body.name).trim() === '') {
    errors['name'] = 'name is required';
  }
  if (!body.effective_from || String(body.effective_from).trim() === '') {
    errors['effective_from'] = 'effective_from is required';
  }

  if (!body.rules || typeof body.rules !== 'object') {
    errors['rules'] = 'rules is required';
  } else {
    const ruleErrors = validatePlanRules(body.rules);
    Object.assign(errors, ruleErrors);
  }

  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  const db = sqlClient ?? defaultSql;

  try {
    const { plan, version } = await createPlan(db, {
      orgId: claims.org_id,
      name: body.name!,
      effectiveFrom: body.effective_from!,
      effectiveTo: body.effective_to ?? null,
      createdBy: claims.user_id,
      rules: body.rules!,
    });

    return jsonResponse(
      {
        plan: {
          id: plan.id,
          org_id: plan.orgId,
          name: plan.name,
          effective_from: plan.effectiveFrom,
          effective_to: plan.effectiveTo,
          created_by: plan.createdBy,
          created_at: plan.createdAt,
        },
        version: {
          id: version.id,
          plan_id: version.planId,
          version_num: version.versionNum,
          status: version.status,
          rules: version.rulesSnapshot,
          effective_at: version.effectiveAt,
          created_at: version.createdAt,
        },
      },
      201,
    );
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    // Tier validation errors from the DB layer surface as 422
    if (msg.includes('Tier thresholds')) {
      return errorResponse('Validation failed', 422, { tiers: msg });
    }
    console.error('[plans] create error:', err);
    return errorResponse('Failed to create plan', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /plans — list plans for the tenant
// ---------------------------------------------------------------------------

/**
 * GET /plans — lists all commission plans for the authenticated tenant.
 */
export async function handleListPlans(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  try {
    const plans = await listPlans(db, claims.org_id);
    return jsonResponse(
      plans.map((p) => ({
        id: p.id,
        org_id: p.orgId,
        name: p.name,
        effective_from: p.effectiveFrom,
        effective_to: p.effectiveTo,
        created_by: p.createdBy,
        created_at: p.createdAt,
      })),
    );
  } catch (err: unknown) {
    console.error('[plans] list error:', err);
    return errorResponse('Failed to list plans', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /plans/:id/versions — create a new version
// ---------------------------------------------------------------------------

export interface CreatePlanVersionBody {
  rules: PlanRules;
  effective_at?: string;
}

/**
 * POST /plans/:id/versions — creates a new Draft version for an existing plan.
 *
 * Returns 201 with the new version on success.
 * Returns 404 if the plan does not exist or belongs to a different tenant.
 * Returns 422 on rule validation errors.
 */
export async function handleCreatePlanVersion(
  planId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<CreatePlanVersionBody>;
  try {
    body = (await req.json()) as Partial<CreatePlanVersionBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const errors: Record<string, string> = {};

  if (!body.rules || typeof body.rules !== 'object') {
    errors['rules'] = 'rules is required';
  } else {
    const ruleErrors = validatePlanRules(body.rules);
    Object.assign(errors, ruleErrors);
  }

  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  const db = sqlClient ?? defaultSql;

  // Verify plan exists and belongs to this tenant
  const plan = await getPlan(db, claims.org_id, planId);
  if (!plan) {
    return errorResponse('Plan not found', 404);
  }

  try {
    const version = await createPlanVersion(db, {
      orgId: claims.org_id,
      planId,
      rules: body.rules!,
      effectiveAt: body.effective_at ? new Date(body.effective_at) : undefined,
    });

    return jsonResponse(
      {
        id: version.id,
        plan_id: version.planId,
        version_num: version.versionNum,
        status: version.status,
        rules: version.rulesSnapshot,
        effective_at: version.effectiveAt,
        created_at: version.createdAt,
      },
      201,
    );
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('Tier thresholds')) {
      return errorResponse('Validation failed', 422, { tiers: msg });
    }
    console.error('[plans] create version error:', err);
    return errorResponse('Failed to create plan version', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /plans/:id/versions — list all versions for a plan
// ---------------------------------------------------------------------------

/**
 * GET /plans/:id/versions — returns all versions for the plan, newest first.
 */
export async function handleListPlanVersions(
  planId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  const plan = await getPlan(db, claims.org_id, planId);
  if (!plan) {
    return errorResponse('Plan not found', 404);
  }

  try {
    const versions = await listPlanVersions(db, claims.org_id, planId);
    return jsonResponse(
      versions.map((v) => ({
        id: v.id,
        plan_id: v.planId,
        version_num: v.versionNum,
        status: v.status,
        rules: v.rulesSnapshot,
        effective_at: v.effectiveAt,
        created_at: v.createdAt,
      })),
    );
  } catch (err: unknown) {
    console.error('[plans] list versions error:', err);
    return errorResponse('Failed to list plan versions', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /plans/:id/active — get the active version
// ---------------------------------------------------------------------------

/**
 * GET /plans/:id/active — returns the currently Active plan version, or 404.
 */
export async function handleGetActivePlanVersion(
  planId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  const plan = await getPlan(db, claims.org_id, planId);
  if (!plan) {
    return errorResponse('Plan not found', 404);
  }

  try {
    const version = await getActivePlanVersion(db, claims.org_id, planId);
    if (!version) {
      return errorResponse('No active version found', 404);
    }

    return jsonResponse({
      id: version.id,
      plan_id: version.planId,
      version_num: version.versionNum,
      status: version.status,
      rules: version.rulesSnapshot,
      effective_at: version.effectiveAt,
      created_at: version.createdAt,
    });
  } catch (err: unknown) {
    console.error('[plans] get active version error:', err);
    return errorResponse('Failed to get active plan version', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /plans/:id/versions/:vid/activate — activate a draft version
// ---------------------------------------------------------------------------

/**
 * POST /plans/:id/versions/:vid/activate — transitions a Draft version to Active.
 * The previously Active version (if any) is moved to Superseded.
 *
 * Returns 200 with the newly activated version on success.
 * Returns 404 if the plan or version is not found.
 * Returns 422 if the version is not in Draft state.
 */
export async function handleActivatePlanVersion(
  planId: string,
  versionId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  const plan = await getPlan(db, claims.org_id, planId);
  if (!plan) {
    return errorResponse('Plan not found', 404);
  }

  try {
    const version = await activatePlanVersion(db, claims.org_id, planId, versionId);

    return jsonResponse({
      id: version.id,
      plan_id: version.planId,
      version_num: version.versionNum,
      status: version.status,
      rules: version.rulesSnapshot,
      effective_at: version.effectiveAt,
      created_at: version.createdAt,
    });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('not found') || msg.includes('not in Draft')) {
      return errorResponse('Version not found or not in Draft state', 404);
    }
    console.error('[plans] activate version error:', err);
    return errorResponse('Failed to activate plan version', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /plans/:id/assignments — assign a producer to a plan
// ---------------------------------------------------------------------------

export interface CreateAssignmentBody {
  producer_id: string;
  plan_version_id: string;
  expires_at?: string | null;
}

/**
 * POST /plans/:id/assignments — assigns a producer to a specific plan version.
 *
 * Returns 201 with the assignment on success.
 * Returns 422 on validation errors.
 */
export async function handleCreatePlanAssignment(
  planId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<CreateAssignmentBody>;
  try {
    body = (await req.json()) as Partial<CreateAssignmentBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const errors: Record<string, string> = {};
  if (!body.producer_id || String(body.producer_id).trim() === '') {
    errors['producer_id'] = 'producer_id is required';
  }
  if (!body.plan_version_id || String(body.plan_version_id).trim() === '') {
    errors['plan_version_id'] = 'plan_version_id is required';
  }

  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  const db = sqlClient ?? defaultSql;

  const plan = await getPlan(db, claims.org_id, planId);
  if (!plan) {
    return errorResponse('Plan not found', 404);
  }

  try {
    const assignment = await createPlanAssignment(db, {
      orgId: claims.org_id,
      planVersionId: body.plan_version_id!,
      producerId: body.producer_id!,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
    });

    return jsonResponse(
      {
        id: assignment.id,
        org_id: assignment.orgId,
        plan_version_id: assignment.planVersionId,
        producer_id: assignment.producerId,
        assigned_at: assignment.assignedAt,
        expires_at: assignment.expiresAt,
      },
      201,
    );
  } catch (err: unknown) {
    console.error('[plans] create assignment error:', err);
    return errorResponse('Failed to create plan assignment', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /plans/:id/assignments — list producer assignments for a plan
// ---------------------------------------------------------------------------

/**
 * GET /plans/:id/assignments — lists all producer assignments for a plan,
 * enriched with acknowledgment status (acknowledgedAt / acknowledgedBy).
 *
 * Role access: HR (FinanceAdmin / HrAdmin) may read all assignments.
 * A Producer may read their own assignment (producer_id == claims.user_id).
 */
export async function handleListPlanAssignments(
  planId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  const plan = await getPlan(db, claims.org_id, planId);
  if (!plan) {
    return errorResponse('Plan not found', 404);
  }

  try {
    const assignments = await listPlanAssignmentsWithAck(db, claims.org_id, planId);

    // Producers may only see their own assignment row.
    const filtered =
      claims.role === 'Producer'
        ? assignments.filter((a) => a.producerId === claims.user_id)
        : assignments;

    return jsonResponse(
      filtered.map((a) => ({
        id: a.id,
        org_id: a.orgId,
        plan_version_id: a.planVersionId,
        producer_id: a.producerId,
        assigned_at: a.assignedAt,
        expires_at: a.expiresAt,
        acknowledged_at: a.acknowledgedAt ?? null,
        acknowledged_by: a.acknowledgedBy ?? null,
      })),
    );
  } catch (err: unknown) {
    console.error('[plans] list assignments error:', err);
    return errorResponse('Failed to list plan assignments', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /plans/:id/versions/:vid/acknowledge — producer acknowledges a plan version
// ---------------------------------------------------------------------------

/**
 * POST /plans/:id/versions/:vid/acknowledge
 *
 * A Producer acknowledges their active assigned plan version. Creates a durable
 * acceptance record (actor + plan version + timestamp). Idempotent: re-acknowledging
 * the same version returns the existing record unchanged.
 *
 * Role gating:
 *   - A Producer may acknowledge only a plan version they are currently assigned to.
 *   - Non-Producer roles (HR/Admin) are not permitted to acknowledge on behalf of a producer.
 *
 * Writes an AuditLogEntry to commission_audit on first acknowledgment.
 *
 * Returns 200 with the acknowledgment record.
 * Returns 403 if the producer is not assigned to this version.
 * Returns 404 if the plan or version does not exist in the tenant.
 *
 * Canonical docs: docs/prd.md §4 (HR / People Ops)
 * Issue: feat: commission plan acknowledgment (#123)
 */
export async function handleAcknowledgePlanVersion(
  planId: string,
  versionId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  // Only Producers may acknowledge; HR can read status but not write on behalf of a producer.
  if (claims.role !== 'Producer') {
    return errorResponse('Forbidden: only Producers may acknowledge a plan', 403);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Verify plan exists in tenant
  const plan = await getPlan(db, claims.org_id, planId);
  if (!plan) {
    return errorResponse('Plan not found', 404);
  }

  // Verify the producer has an assignment for this specific version
  const assignmentRows = await db.unsafe(
    `
    SELECT pa.id
    FROM plan_assignments pa
    WHERE pa.org_id = $1
      AND pa.plan_version_id = $2
      AND pa.producer_id = $3
    LIMIT 1
    `,
    [claims.org_id, versionId, claims.user_id],
  );

  if (!assignmentRows || assignmentRows.length === 0) {
    return errorResponse('Forbidden: producer is not assigned to this plan version', 403);
  }

  // Check whether this is a new acknowledgment (for audit log)
  const existing = await getPlanVersionAcknowledgment(
    db,
    claims.org_id,
    versionId,
    claims.user_id,
  );
  const isNew = existing === null;

  const ack = await acknowledgePlanVersion(db, {
    orgId: claims.org_id,
    planVersionId: versionId,
    producerId: claims.user_id,
    acknowledgedBy: claims.user_id,
  });

  // Write audit log entry only on first acknowledgment (idempotent calls skip)
  if (isNew) {
    try {
      await adb.unsafe(
        `
        INSERT INTO audit_log_entries (
          org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
        ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
        `,
        [
          claims.org_id,
          claims.user_id,
          'User',
          'plan_version.acknowledged',
          'plan_version',
          versionId,
          {
            plan_id: planId,
            plan_version_id: versionId,
            producer_id: claims.user_id,
            acknowledged_at: ack.acknowledgedAt,
          } as never,
        ],
      );
    } catch (err: unknown) {
      console.error('[plans] acknowledge audit log write error (non-fatal):', err);
    }
  }

  return jsonResponse({
    id: ack.id,
    org_id: ack.orgId,
    plan_version_id: ack.planVersionId,
    producer_id: ack.producerId,
    acknowledged_by: ack.acknowledgedBy,
    acknowledged_at: ack.acknowledgedAt,
  });
}

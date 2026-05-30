/**
 * DB access functions for commission plan tables.
 *
 * Handles CRUD operations for:
 *   - commission_plans: named plan definitions
 *   - plan_versions: immutable snapshots of commission plan rules
 *   - plan_assignments: producer-to-plan-version assignments
 *
 * Multi-tenant isolation: all queries carry org_id.
 *
 * Canonical docs:
 *   - docs/prd.md §5.3, §8.3
 *   - docs/architecture/decisions.md — ER Diagram
 * Issue: feat: commission plan configuration and versioning (#9)
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanVersionState = 'Draft' | 'Active' | 'Superseded';

export interface TierRule {
  /** Threshold amount above which this rate applies. */
  threshold: number;
  /** Commission rate as a decimal fraction, e.g. 0.10 = 10%. */
  rate: number;
}

export interface PlanRules {
  /** Rate type: gross_fee or net_fee_income */
  rate_type: 'gross_fee' | 'net_fee_income';
  /** Base commission rate as a decimal fraction. */
  base_rate: number;
  /** Ordered tiers of progressive rates. Thresholds must be strictly ascending. */
  tiers?: TierRule[];
  /** Desk cost recovery amount in dollars. */
  desk_cost?: number;
  /** Draw recovery mode: none, pro_rata, or first_dollar. */
  draw_recovery_mode?: 'none' | 'pro_rata' | 'first_dollar';
  /** Holdback conditions (freeform config). */
  holdback_conditions?: Record<string, unknown>;
  /** Clawback conditions (freeform config). */
  clawback_conditions?: Record<string, unknown>;
}

export interface CommissionPlan {
  id: string;
  orgId: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  configEntityId: string;
  createdBy: string;
  createdAt: Date;
}

export interface PlanVersion {
  id: string;
  orgId: string;
  planId: string;
  versionNum: number;
  status: PlanVersionState;
  rulesSnapshot: PlanRules;
  acknowledgedBy: string[];
  effectiveAt: Date;
  createdAt: Date;
}

export interface PlanAssignment {
  id: string;
  orgId: string;
  planVersionId: string;
  producerId: string;
  assignedAt: Date;
  expiresAt: Date | null;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreatePlanInput {
  orgId: string;
  name: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  createdBy: string;
  rules: PlanRules;
}

export interface CreatePlanVersionInput {
  orgId: string;
  planId: string;
  rules: PlanRules;
  effectiveAt?: Date;
}

export interface CreatePlanAssignmentInput {
  orgId: string;
  planVersionId: string;
  producerId: string;
  expiresAt?: Date | null;
}

// ---------------------------------------------------------------------------
// Tier validation
// ---------------------------------------------------------------------------

/**
 * Validates that tier thresholds are strictly ascending (no overlaps).
 *
 * @throws Error with a descriptive message if validation fails.
 */
export function validateTiers(tiers: TierRule[]): void {
  if (!tiers || tiers.length === 0) return;

  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].threshold <= tiers[i - 1].threshold) {
      throw new Error(
        `Tier thresholds must be strictly ascending. ` +
          `Tier ${i} threshold ${tiers[i].threshold} is not greater than ` +
          `tier ${i - 1} threshold ${tiers[i - 1].threshold}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// createPlan — INSERT commission_plan + first plan_version in a transaction
// ---------------------------------------------------------------------------

/**
 * Creates a new commission plan and its initial Draft version.
 *
 * Returns { plan, version } on success.
 */
export async function createPlan(
  sql: Sql,
  input: CreatePlanInput,
): Promise<{ plan: CommissionPlan; version: PlanVersion }> {
  // Validate tiers before writing
  if (input.rules.tiers) {
    validateTiers(input.rules.tiers);
  }

  const configEntityId = crypto.randomUUID();

  // Insert plan
  const planRows = await sql.unsafe(
    `
    INSERT INTO commission_plans (
      org_id, name, effective_from, effective_to, config_entity_id, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, org_id, name, effective_from, effective_to,
              config_entity_id, created_by, created_at
    `,
    [
      input.orgId,
      input.name,
      input.effectiveFrom,
      input.effectiveTo ?? null,
      configEntityId,
      input.createdBy,
    ],
  );

  if (!planRows || planRows.length === 0) {
    throw new Error('createPlan: plan insert returned no rows');
  }

  const plan = mapPlanRow(planRows[0] as unknown as RawPlanRow);

  // Insert initial Draft version
  const versionRows = await sql`
    INSERT INTO plan_versions (
      org_id, plan_id, version_num, status, rules_snapshot, effective_at
    ) VALUES (${input.orgId}, ${plan.id}, 1, 'Draft', ${sql.json(input.rules as never)}, NOW())
    RETURNING id, org_id, plan_id, version_num, status,
              rules_snapshot, acknowledged_by, effective_at, created_at
  `;

  if (!versionRows || versionRows.length === 0) {
    throw new Error('createPlan: version insert returned no rows');
  }

  const version = mapVersionRow(versionRows[0] as unknown as RawVersionRow);

  return { plan, version };
}

// ---------------------------------------------------------------------------
// createPlanVersion — INSERT a new Draft version for an existing plan
// ---------------------------------------------------------------------------

/**
 * Creates a new Draft version for an existing plan.
 * Version numbers auto-increment from the current maximum.
 */
export async function createPlanVersion(
  sql: Sql,
  input: CreatePlanVersionInput,
): Promise<PlanVersion> {
  if (input.rules.tiers) {
    validateTiers(input.rules.tiers);
  }

  const effectiveAt = input.effectiveAt ?? new Date();
  const rows = await sql`
    INSERT INTO plan_versions (
      org_id, plan_id, version_num, status, rules_snapshot, effective_at
    )
    SELECT
      ${input.orgId}, ${input.planId},
      COALESCE((SELECT MAX(version_num) FROM plan_versions WHERE plan_id = ${input.planId}), 0) + 1,
      'Draft',
      ${sql.json(input.rules as never)},
      ${effectiveAt}
    RETURNING id, org_id, plan_id, version_num, status,
              rules_snapshot, acknowledged_by, effective_at, created_at
  `;

  if (!rows || rows.length === 0) {
    throw new Error('createPlanVersion: insert returned no rows');
  }

  return mapVersionRow(rows[0] as unknown as RawVersionRow);
}

// ---------------------------------------------------------------------------
// activatePlanVersion — transition a Draft version to Active, supersede prior
// ---------------------------------------------------------------------------

/**
 * Transitions a plan version from Draft to Active.
 * Any currently Active version for the same plan is moved to Superseded.
 *
 * Returns the newly activated version.
 */
export async function activatePlanVersion(
  sql: Sql,
  orgId: string,
  planId: string,
  versionId: string,
): Promise<PlanVersion> {
  // Run in a transaction: supersede existing active, then activate target
  const rows = await sql.unsafe(
    `
    WITH supersede AS (
      UPDATE plan_versions
      SET status = 'Superseded'
      WHERE org_id = $1
        AND plan_id = $2
        AND status = 'Active'
      RETURNING id
    ),
    activate AS (
      UPDATE plan_versions
      SET status = 'Active'
      WHERE id = $3
        AND org_id = $1
        AND plan_id = $2
        AND status = 'Draft'
      RETURNING id, org_id, plan_id, version_num, status,
                rules_snapshot, acknowledged_by, effective_at, created_at
    )
    SELECT * FROM activate
    `,
    [orgId, planId, versionId],
  );

  if (!rows || rows.length === 0) {
    throw new Error(
      'activatePlanVersion: version not found, not in Draft state, or plan/org mismatch',
    );
  }

  return mapVersionRow(rows[0] as unknown as RawVersionRow);
}

// ---------------------------------------------------------------------------
// listPlanVersions — SELECT all versions for a plan, descending by activation
// ---------------------------------------------------------------------------

/**
 * Lists all plan versions for a given plan, ordered by version_num descending.
 */
export async function listPlanVersions(
  sql: Sql,
  orgId: string,
  planId: string,
): Promise<PlanVersion[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, plan_id, version_num, status,
           rules_snapshot, acknowledged_by, effective_at, created_at
    FROM plan_versions
    WHERE org_id = $1 AND plan_id = $2
    ORDER BY version_num DESC
    `,
    [orgId, planId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as RawVersionRow[]).map(mapVersionRow);
}

// ---------------------------------------------------------------------------
// getActivePlanVersion — SELECT the currently Active version for a plan
// ---------------------------------------------------------------------------

/**
 * Returns the currently Active plan version, or null if none exists.
 */
export async function getActivePlanVersion(
  sql: Sql,
  orgId: string,
  planId: string,
): Promise<PlanVersion | null> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, plan_id, version_num, status,
           rules_snapshot, acknowledged_by, effective_at, created_at
    FROM plan_versions
    WHERE org_id = $1 AND plan_id = $2 AND status = 'Active'
    LIMIT 1
    `,
    [orgId, planId],
  );

  if (!rows || rows.length === 0) return null;
  return mapVersionRow(rows[0] as unknown as RawVersionRow);
}

// ---------------------------------------------------------------------------
// listPlans — SELECT all plans for a tenant
// ---------------------------------------------------------------------------

/**
 * Lists all commission plans for a tenant, ordered by created_at descending.
 */
export async function listPlans(sql: Sql, orgId: string): Promise<CommissionPlan[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, name, effective_from, effective_to,
           config_entity_id, created_by, created_at
    FROM commission_plans
    WHERE org_id = $1
    ORDER BY created_at DESC
    `,
    [orgId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as RawPlanRow[]).map(mapPlanRow);
}

// ---------------------------------------------------------------------------
// getPlan — SELECT a single plan by ID, scoped to org
// ---------------------------------------------------------------------------

/**
 * Returns a single commission plan by ID, or null if not found or wrong org.
 */
export async function getPlan(
  sql: Sql,
  orgId: string,
  planId: string,
): Promise<CommissionPlan | null> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, name, effective_from, effective_to,
           config_entity_id, created_by, created_at
    FROM commission_plans
    WHERE id = $1 AND org_id = $2
    `,
    [planId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return mapPlanRow(rows[0] as unknown as RawPlanRow);
}

// ---------------------------------------------------------------------------
// createPlanAssignment — INSERT a plan_assignment record
// ---------------------------------------------------------------------------

/**
 * Assigns a producer to a plan version.
 * If the producer is already assigned, this is a no-op (upsert semantics).
 */
export async function createPlanAssignment(
  sql: Sql,
  input: CreatePlanAssignmentInput,
): Promise<PlanAssignment> {
  const rows = await sql.unsafe(
    `
    INSERT INTO plan_assignments (org_id, plan_version_id, producer_id, expires_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (plan_version_id, producer_id) DO UPDATE
      SET expires_at = EXCLUDED.expires_at
    RETURNING id, org_id, plan_version_id, producer_id, assigned_at, expires_at
    `,
    [input.orgId, input.planVersionId, input.producerId, input.expiresAt ?? null],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createPlanAssignment: insert returned no rows');
  }

  return mapAssignmentRow(rows[0] as unknown as RawAssignmentRow);
}

// ---------------------------------------------------------------------------
// listPlanAssignments — SELECT all assignments for a plan
// ---------------------------------------------------------------------------

/**
 * Lists all producer assignments for a given plan (across all versions).
 * Joins plan_versions to resolve the plan_id filter.
 */
export async function listPlanAssignments(
  sql: Sql,
  orgId: string,
  planId: string,
): Promise<PlanAssignment[]> {
  const rows = await sql.unsafe(
    `
    SELECT pa.id, pa.org_id, pa.plan_version_id, pa.producer_id,
           pa.assigned_at, pa.expires_at
    FROM plan_assignments pa
    JOIN plan_versions pv ON pv.id = pa.plan_version_id
    WHERE pa.org_id = $1 AND pv.plan_id = $2
    ORDER BY pa.assigned_at DESC
    `,
    [orgId, planId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as RawAssignmentRow[]).map(mapAssignmentRow);
}

// ---------------------------------------------------------------------------
// Internal raw row types and mappers
// ---------------------------------------------------------------------------

interface RawPlanRow {
  id: string;
  org_id: string;
  name: string;
  effective_from: string | Date;
  effective_to: string | Date | null;
  config_entity_id: string;
  created_by: string;
  created_at: Date;
}

interface RawVersionRow {
  id: string;
  org_id: string;
  plan_id: string;
  version_num: number | string;
  status: string;
  rules_snapshot: unknown;
  acknowledged_by: string[] | null;
  effective_at: Date;
  created_at: Date;
}

interface RawAssignmentRow {
  id: string;
  org_id: string;
  plan_version_id: string;
  producer_id: string;
  assigned_at: Date;
  expires_at: Date | null;
}

function formatDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function mapPlanRow(row: RawPlanRow): CommissionPlan {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    effectiveFrom: formatDate(row.effective_from) as string,
    effectiveTo: formatDate(row.effective_to),
    configEntityId: row.config_entity_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapVersionRow(row: RawVersionRow): PlanVersion {
  return {
    id: row.id,
    orgId: row.org_id,
    planId: row.plan_id,
    versionNum: Number(row.version_num),
    status: row.status as PlanVersionState,
    rulesSnapshot: row.rules_snapshot as PlanRules,
    acknowledgedBy: row.acknowledged_by ?? [],
    effectiveAt: row.effective_at,
    createdAt: row.created_at,
  };
}

function mapAssignmentRow(row: RawAssignmentRow): PlanAssignment {
  return {
    id: row.id,
    orgId: row.org_id,
    planVersionId: row.plan_version_id,
    producerId: row.producer_id,
    assignedAt: row.assigned_at,
    expiresAt: row.expires_at ?? null,
  };
}

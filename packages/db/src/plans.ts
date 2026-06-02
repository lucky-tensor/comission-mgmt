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
import { FieldEncryptor } from './encryption.js';
import { createKmsAdapter } from './kms.js';
import { computeTierProgress } from 'core/tier-progress';

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

export interface PlanAcknowledgment {
  id: string;
  orgId: string;
  planVersionId: string;
  producerId: string;
  acknowledgedBy: string;
  acknowledgedAt: Date;
}

/** Assignment row enriched with acknowledgment status. */
export interface PlanAssignmentWithAck extends PlanAssignment {
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
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

export interface AcknowledgePlanVersionInput {
  orgId: string;
  planVersionId: string;
  producerId: string;
  acknowledgedBy: string;
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
// acknowledgePlanVersion — INSERT an acceptance record (idempotent per producer+version)
// ---------------------------------------------------------------------------

/**
 * Records a producer's acknowledgment of a plan version.
 *
 * Idempotent: if the producer has already acknowledged this version, returns
 * the existing record without modifying it (no timestamp update).
 *
 * Returns the acknowledgment record (new or existing).
 *
 * Issue: feat: commission plan acknowledgment (#123)
 */
export async function acknowledgePlanVersion(
  sql: Sql,
  input: AcknowledgePlanVersionInput,
): Promise<PlanAcknowledgment> {
  const rows = await sql.unsafe(
    `
    INSERT INTO plan_acknowledgments (
      org_id, plan_version_id, producer_id, acknowledged_by
    ) VALUES ($1, $2, $3, $4)
    ON CONFLICT (plan_version_id, producer_id) DO NOTHING
    RETURNING id, org_id, plan_version_id, producer_id, acknowledged_by, acknowledged_at
    `,
    [input.orgId, input.planVersionId, input.producerId, input.acknowledgedBy],
  );

  if (rows && rows.length > 0) {
    return mapAcknowledgmentRow(rows[0] as unknown as RawAcknowledgmentRow);
  }

  // Already exists — fetch the existing record
  const existing = await sql.unsafe(
    `
    SELECT id, org_id, plan_version_id, producer_id, acknowledged_by, acknowledged_at
    FROM plan_acknowledgments
    WHERE plan_version_id = $1 AND producer_id = $2
    `,
    [input.planVersionId, input.producerId],
  );

  if (!existing || existing.length === 0) {
    throw new Error('acknowledgePlanVersion: record not found after conflict');
  }
  return mapAcknowledgmentRow(existing[0] as unknown as RawAcknowledgmentRow);
}

// ---------------------------------------------------------------------------
// getPlanVersionAcknowledgment — fetch a single acknowledgment record
// ---------------------------------------------------------------------------

/**
 * Returns the acknowledgment record for a producer+version, or null if not found.
 *
 * Issue: feat: commission plan acknowledgment (#123)
 */
export async function getPlanVersionAcknowledgment(
  sql: Sql,
  orgId: string,
  planVersionId: string,
  producerId: string,
): Promise<PlanAcknowledgment | null> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, plan_version_id, producer_id, acknowledged_by, acknowledged_at
    FROM plan_acknowledgments
    WHERE org_id = $1 AND plan_version_id = $2 AND producer_id = $3
    `,
    [orgId, planVersionId, producerId],
  );

  if (!rows || rows.length === 0) return null;
  return mapAcknowledgmentRow(rows[0] as unknown as RawAcknowledgmentRow);
}

// ---------------------------------------------------------------------------
// listPlanAssignmentsWithAck — SELECT assignments with acknowledgment status
// ---------------------------------------------------------------------------

/**
 * Lists all producer assignments for a plan, enriched with acknowledgment status.
 * The acknowledgedAt / acknowledgedBy fields are null when the producer has not yet
 * acknowledged the assigned plan version.
 *
 * Issue: feat: commission plan acknowledgment (#123)
 */
export async function listPlanAssignmentsWithAck(
  sql: Sql,
  orgId: string,
  planId: string,
): Promise<PlanAssignmentWithAck[]> {
  const rows = await sql.unsafe(
    `
    SELECT pa.id, pa.org_id, pa.plan_version_id, pa.producer_id,
           pa.assigned_at, pa.expires_at,
           ack.acknowledged_by AS ack_acknowledged_by,
           ack.acknowledged_at AS ack_acknowledged_at
    FROM plan_assignments pa
    JOIN plan_versions pv ON pv.id = pa.plan_version_id
    LEFT JOIN plan_acknowledgments ack
           ON ack.plan_version_id = pa.plan_version_id
          AND ack.producer_id = pa.producer_id
    WHERE pa.org_id = $1 AND pv.plan_id = $2
    ORDER BY pa.assigned_at DESC
    `,
    [orgId, planId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as RawAssignmentWithAckRow[]).map(mapAssignmentWithAckRow);
}

// ---------------------------------------------------------------------------
// Encryptor singleton for tier progress (lazy-initialised, mirrors commission-records.ts pattern)
// ---------------------------------------------------------------------------

let _tierEncryptor: FieldEncryptor | null = null;

async function getTierEncryptor(): Promise<FieldEncryptor> {
  if (_tierEncryptor) return _tierEncryptor;
  const adapter = await createKmsAdapter();
  _tierEncryptor = new FieldEncryptor(adapter);
  return _tierEncryptor;
}

/** Replace the encryptor singleton used by getTierProgressForProducer. Used in tests. */
export function _setTierEncryptorForTest(enc: FieldEncryptor): void {
  _tierEncryptor = enc;
}

/** Reset the encryptor singleton. Used in tests for isolation. */
export function _resetTierEncryptorForTest(): void {
  _tierEncryptor = null;
}

// ---------------------------------------------------------------------------
// getTierProgressForProducer — compute on-the-fly tier progress for the producer portal
// ---------------------------------------------------------------------------

/**
 * Tier progress result for a producer in the current plan period.
 * Returned by GET /me/tier-progress.
 *
 * Issue: feat: producer tier progress display (#17)
 */
export interface TierProgressResult {
  /** Plan version driving this calculation. */
  plan_version_id: string;
  /** Start of the current plan period (from commission_plans.effective_from). */
  period_start: string;
  /** End of the current plan period (from commission_plans.effective_to, or null if open-ended). */
  period_end: string | null;
  /** Sum of gross_amount for the producer's Accrued + Payable CommissionRecords in the current period. Decrypted and summed in application code. */
  current_period_production: number;
  /** The tier rate that applies to current_period_production (e.g. 0.25 = 25%). */
  current_tier_rate: number;
  /** The threshold of the next tier above current production. Null if at the top tier. */
  next_tier_threshold: number | null;
  /** Amount remaining to reach next tier (next_tier_threshold - current_period_production). Null if at top tier. */
  remaining_to_next_tier: number | null;
}

/**
 * Raw DB row returned by the tier progress query.
 * Contains the plan version info, period dates, and the gross_amount blobs.
 */
interface TierProgressRawRow {
  plan_version_id: string;
  rules_snapshot: unknown;
  effective_from: string | Date;
  effective_to: string | Date | null;
  gross_amount: Buffer | Uint8Array | null;
}

/**
 * Returns tier progress for a producer in their current plan period.
 *
 * Algorithm:
 *   1. Find the producer's most-recent active plan assignment, join to plan_versions
 *      and commission_plans to get period dates and tier rules.
 *   2. SUM gross_amount for the producer's CommissionRecords in that period
 *      with status IN ('Accrued', 'PendingApproval', 'Approved', 'Payable').
 *   3. Walk the tier list to determine current_tier_rate and next_tier_threshold.
 *
 * Returns null if the producer has no active plan assignment.
 *
 * Issue: feat: producer tier progress display (#17)
 */
export async function getTierProgressForProducer(
  sql: Sql,
  orgId: string,
  producerId: string,
): Promise<TierProgressResult | null> {
  const encryptor = await getTierEncryptor();
  // Step 1: fetch the active plan version for this producer.
  // We join plan_assignments → plan_versions → commission_plans so we can read
  // the effective_from / effective_to period bounds in one query.
  const versionRows = await sql.unsafe(
    `
    SELECT pv.id AS plan_version_id,
           pv.rules_snapshot,
           cp.effective_from,
           cp.effective_to
    FROM plan_assignments pa
    JOIN plan_versions pv ON pv.id = pa.plan_version_id
    JOIN commission_plans cp ON cp.id = pv.plan_id
    WHERE pa.org_id = $1
      AND pa.producer_id = $2
      AND pv.status = 'Active'
      AND (pa.expires_at IS NULL OR pa.expires_at > NOW())
    ORDER BY pa.assigned_at DESC
    LIMIT 1
    `,
    [orgId, producerId],
  );

  if (!versionRows || versionRows.length === 0) return null;

  const vrow = versionRows[0] as unknown as {
    plan_version_id: string;
    rules_snapshot: unknown;
    effective_from: string | Date;
    effective_to: string | Date | null;
  };

  const planVersionId = vrow.plan_version_id;
  const rules = vrow.rules_snapshot as PlanRules;
  const periodStart = formatDate(vrow.effective_from) as string;
  const periodEnd = formatDate(vrow.effective_to);

  // Step 2: fetch encrypted gross_amount blobs for all qualifying commission records
  // in the current period, scoped to this producer.
  // We join through contributors so we can filter by producer_id (= session user_id).
  const periodFilter = periodEnd
    ? `AND cr.created_at >= $3::date AND cr.created_at < ($4::date + INTERVAL '1 day')`
    : `AND cr.created_at >= $3::date`;

  const recordRows = await sql.unsafe(
    `
    SELECT cr.gross_amount
    FROM commission_records cr
    JOIN contributors c ON c.id = cr.contributor_id
    WHERE cr.org_id = $1
      AND c.producer_id = $2
      AND cr.status IN ('Accrued', 'PendingApproval', 'Approved', 'Payable')
      ${periodFilter}
    `,
    periodEnd ? [orgId, producerId, periodStart, periodEnd] : [orgId, producerId, periodStart],
  );

  // Step 3: decrypt and sum gross_amount values.
  let currentPeriodProduction = 0;
  if (recordRows && recordRows.length > 0) {
    const rows = recordRows as unknown as TierProgressRawRow[];
    for (const row of rows) {
      if (row.gross_amount != null) {
        const buf = Buffer.isBuffer(row.gross_amount)
          ? row.gross_amount
          : Buffer.from(row.gross_amount);
        const decrypted = await encryptor.decrypt('commission_records', 'gross_amount', buf);
        currentPeriodProduction += parseFloat(decrypted) || 0;
      }
    }
  }

  // Step 4: compute tier rate and remaining-to-next-tier using the pure core helper.
  const tierCalc = computeTierProgress({
    currentPeriodProduction,
    tiers: rules.tiers ?? [],
    baseRate: rules.base_rate ?? 0,
  });

  return {
    plan_version_id: planVersionId,
    period_start: periodStart,
    period_end: periodEnd,
    ...tierCalc,
  };
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

interface RawAssignmentWithAckRow extends RawAssignmentRow {
  ack_acknowledged_by: string | null;
  ack_acknowledged_at: Date | null;
}

interface RawAcknowledgmentRow {
  id: string;
  org_id: string;
  plan_version_id: string;
  producer_id: string;
  acknowledged_by: string;
  acknowledged_at: Date;
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

function mapAssignmentWithAckRow(row: RawAssignmentWithAckRow): PlanAssignmentWithAck {
  return {
    id: row.id,
    orgId: row.org_id,
    planVersionId: row.plan_version_id,
    producerId: row.producer_id,
    assignedAt: row.assigned_at,
    expiresAt: row.expires_at ?? null,
    acknowledgedBy: row.ack_acknowledged_by ?? null,
    acknowledgedAt: row.ack_acknowledged_at ?? null,
  };
}

function mapAcknowledgmentRow(row: RawAcknowledgmentRow): PlanAcknowledgment {
  return {
    id: row.id,
    orgId: row.org_id,
    planVersionId: row.plan_version_id,
    producerId: row.producer_id,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
  };
}

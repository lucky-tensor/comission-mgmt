/**
 * DB access functions for the guarantee_periods table.
 *
 * Guarantee periods track the risk window after a placement start date.
 * When a guarantee period expires cleanly (no candidate departure), the
 * background job transitions state to ExpiredClean and releases held
 * commission records to Payable.
 *
 * Canonical docs:
 *   - docs/prd.md §5.6 — Guarantee Period and Clawback Rules
 *   - docs/architecture/phase-post-placement-risk.md — scout decision record
 *
 * Issue: feat: guarantee period tracking and monitoring (#19)
 */

import type { Sql, TransactionSql } from 'postgres';
import type { GuaranteeState } from 'core/guarantee-state';

/** Accepts either a regular pool connection or a transaction connection. */
type SqlOrTx = Sql | TransactionSql;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuaranteePeriodRow {
  id: string;
  orgId: string;
  placementId: string;
  /** ISO date string: YYYY-MM-DD */
  guaranteeEnds: string;
  status: GuaranteeState;
  triggeredAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  expiredAt: Date | null;
  createdAt?: Date;
}

export interface CreateGuaranteePeriodInput {
  orgId: string;
  placementId: string;
  /** ISO date string: YYYY-MM-DD */
  guaranteeEnds: string;
  /** risk_amount is required by the schema (BYTEA) — pass an empty buffer sentinel when unknown */
  riskAmountBuffer: Buffer;
}

// ---------------------------------------------------------------------------
// createGuaranteePeriod — INSERT a new guarantee period row
// ---------------------------------------------------------------------------

/**
 * Creates a guarantee_periods row for a placement.
 * Called when a placement enters GuaranteeActive status (calculate endpoint).
 */
export async function createGuaranteePeriod(
  sql: SqlOrTx,
  input: CreateGuaranteePeriodInput,
): Promise<GuaranteePeriodRow> {
  const rows = await sql.unsafe(
    `
    INSERT INTO guarantee_periods (
      org_id, placement_id, guarantee_ends, risk_amount
    ) VALUES (
      $1, $2, $3, $4
    )
    RETURNING id, org_id, placement_id, guarantee_ends, status,
              triggered_at, resolved_at, resolution, expired_at
    `,
    [input.orgId, input.placementId, input.guaranteeEnds, input.riskAmountBuffer],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createGuaranteePeriod: insert returned no rows');
  }

  return mapRow(rows[0] as unknown as GuaranteePeriodRawRow);
}

// ---------------------------------------------------------------------------
// getGuaranteePeriodForPlacement — SELECT the active (or latest) guarantee period
// ---------------------------------------------------------------------------

/**
 * Returns the guarantee period for a placement, preferring the Active row.
 * Returns null when no guarantee period exists.
 */
export async function getGuaranteePeriodForPlacement(
  sql: SqlOrTx,
  orgId: string,
  placementId: string,
): Promise<GuaranteePeriodRow | null> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, guarantee_ends, status,
           triggered_at, resolved_at, resolution, expired_at
    FROM guarantee_periods
    WHERE org_id = $1 AND placement_id = $2
    ORDER BY
      CASE WHEN status = 'Active' THEN 0 ELSE 1 END,
      guarantee_ends DESC
    LIMIT 1
    `,
    [orgId, placementId],
  );

  if (!rows || rows.length === 0) return null;
  return mapRow(rows[0] as unknown as GuaranteePeriodRawRow);
}

// ---------------------------------------------------------------------------
// listActiveExpiredGuaranteePeriods — cron scan for expired windows
// ---------------------------------------------------------------------------

/**
 * Returns all guarantee_periods that are Active but whose guarantee_ends date
 * is strictly before the given cutoffDate (typically NOW()).
 *
 * Used by the guarantee-expiry cron to find rows that should be transitioned
 * to ExpiredClean.
 *
 * @param cutoffDate - ISO date string (YYYY-MM-DD). Rows with guarantee_ends < cutoffDate are returned.
 */
export async function listActiveExpiredGuaranteePeriods(
  sql: SqlOrTx,
  cutoffDate: string,
): Promise<GuaranteePeriodRow[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, guarantee_ends, status,
           triggered_at, resolved_at, resolution, expired_at
    FROM guarantee_periods
    WHERE status = 'Active'
      AND guarantee_ends < $1
    ORDER BY guarantee_ends ASC
    `,
    [cutoffDate],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as GuaranteePeriodRawRow[]).map(mapRow);
}

// ---------------------------------------------------------------------------
// expireGuaranteePeriodClean — transition Active → ExpiredClean
// ---------------------------------------------------------------------------

/**
 * Transitions a guarantee period to ExpiredClean in the same transaction
 * that releases held commission records and advances the placement state.
 *
 * This must be called inside an explicit Postgres transaction (sql.begin).
 * Returns null if the row is not found or is no longer Active.
 */
export async function expireGuaranteePeriodClean(
  sql: SqlOrTx,
  guaranteePeriodId: string,
): Promise<GuaranteePeriodRow | null> {
  const rows = await sql.unsafe(
    `
    UPDATE guarantee_periods
    SET status      = 'ExpiredClean',
        expired_at  = NOW(),
        resolved_at = NOW(),
        resolution  = 'clean_expiry'
    WHERE id = $1 AND status = 'Active'
    RETURNING id, org_id, placement_id, guarantee_ends, status,
              triggered_at, resolved_at, resolution, expired_at
    `,
    [guaranteePeriodId],
  );

  if (!rows || rows.length === 0) return null;
  return mapRow(rows[0] as unknown as GuaranteePeriodRawRow);
}

// ---------------------------------------------------------------------------
// listActivePlacementsInsideGuaranteeWindow — GET /placements?guarantee=active
// ---------------------------------------------------------------------------

/**
 * Returns placement IDs for placements inside an active guarantee window.
 * today < guarantee_ends AND guarantee_periods.status = 'Active'.
 *
 * Used by the GET /placements?guarantee=active filter.
 */
export async function listPlacementIdsInsideGuaranteeWindow(
  sql: SqlOrTx,
  orgId: string,
): Promise<Set<string>> {
  const rows = await sql.unsafe(
    `
    SELECT DISTINCT placement_id
    FROM guarantee_periods
    WHERE org_id = $1
      AND status = 'Active'
      AND guarantee_ends > CURRENT_DATE
    `,
    [orgId],
  );

  const ids = new Set<string>();
  for (const row of rows as unknown as { placement_id: string }[]) {
    ids.add(row.placement_id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// releaseHeldCommissionRecordsForPlacement — release guarantee_hold → Payable
// ---------------------------------------------------------------------------

/**
 * Releases all commission_records for a placement that are Held for
 * the guarantee window (hold_reason = 'guarantee_hold') to Payable.
 *
 * Must be called inside a transaction alongside expireGuaranteePeriodClean.
 * Returns the number of records released.
 */
export async function releaseHeldCommissionRecordsForPlacement(
  sql: SqlOrTx,
  orgId: string,
  placementId: string,
): Promise<number> {
  const rows = await sql.unsafe(
    `
    UPDATE commission_records
    SET status      = 'Payable',
        hold_reason = NULL
    WHERE org_id       = $1
      AND placement_id = $2
      AND status       = 'Held'
      AND hold_reason  = 'guarantee_hold'
    RETURNING id
    `,
    [orgId, placementId],
  );

  return rows ? rows.length : 0;
}

// ---------------------------------------------------------------------------
// advancePlacementToGuaranteeExpired — update placement status atomically
// ---------------------------------------------------------------------------

/**
 * Transitions a placement from GuaranteeActive → GuaranteeExpired.
 * Must be called inside the same transaction as expireGuaranteePeriodClean
 * (Seam 1 — atomicity requirement).
 *
 * Returns false if the placement was not found or not in GuaranteeActive state.
 */
export async function advancePlacementToGuaranteeExpired(
  sql: SqlOrTx,
  orgId: string,
  placementId: string,
): Promise<boolean> {
  const rows = await sql.unsafe(
    `
    UPDATE placements
    SET status     = 'GuaranteeExpired',
        updated_at = NOW()
    WHERE id     = $1
      AND org_id = $2
      AND status = 'GuaranteeActive'
    RETURNING id
    `,
    [placementId, orgId],
  );

  return !!(rows && rows.length > 0);
}

// ---------------------------------------------------------------------------
// Internal helper — map raw DB row to GuaranteePeriodRow
// ---------------------------------------------------------------------------

interface GuaranteePeriodRawRow {
  id: string;
  org_id: string;
  placement_id: string;
  guarantee_ends: Date | string;
  status: string;
  triggered_at: Date | null;
  resolved_at: Date | null;
  resolution: string | null;
  expired_at: Date | null;
}

function mapRow(row: GuaranteePeriodRawRow): GuaranteePeriodRow {
  const endsRaw = row.guarantee_ends;
  const guaranteeEnds =
    endsRaw instanceof Date ? endsRaw.toISOString().slice(0, 10) : String(endsRaw).slice(0, 10);

  return {
    id: row.id,
    orgId: row.org_id,
    placementId: row.placement_id,
    guaranteeEnds,
    status: row.status as GuaranteeState,
    triggeredAt: row.triggered_at ?? null,
    resolvedAt: row.resolved_at ?? null,
    resolution: row.resolution ?? null,
    expiredAt: row.expired_at ?? null,
  };
}

/**
 * DB access functions for the contributors table.
 *
 * Handles CRUD operations for contributor assignments on placements, plus
 * split-percentage validation and audit log writes.
 *
 * Canonical docs:
 *   - docs/prd.md §5.2 Contribution Assignment
 *   - docs/architecture/decisions.md — contributors table ER schema
 */

import type { Sql } from 'postgres';
import type { ContributorRole } from '../../core/contributor-role.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateContributorInput {
  orgId: string;
  placementId: string;
  producerId: string;
  roleCode: ContributorRole;
  /** Split percentage expressed as a decimal fraction, e.g. 0.2500 = 25%. */
  splitPct: number;
  splitOverride?: boolean;
}

export interface Contributor {
  id: string;
  orgId: string;
  placementId: string;
  producerId: string;
  roleCode: ContributorRole;
  /** Split percentage as a decimal fraction, e.g. 0.2500 = 25%. */
  splitPct: number;
  splitOverride: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// createContributor — INSERT a new contributor row
// ---------------------------------------------------------------------------

/**
 * Inserts a new contributor assignment for a placement.
 *
 * @returns The newly created contributor record.
 */
export async function createContributor(
  sql: Sql,
  input: CreateContributorInput,
): Promise<Contributor> {
  const rows = await sql.unsafe(
    `
    INSERT INTO contributors (
      org_id, placement_id, producer_id, role_code, split_pct, split_override
    ) VALUES (
      $1, $2, $3, $4, $5, $6
    )
    RETURNING id, org_id, placement_id, producer_id, role_code,
              split_pct, split_override, approved_by, approved_at, created_at
    `,
    [
      input.orgId,
      input.placementId,
      input.producerId,
      input.roleCode,
      String(input.splitPct),
      String(input.splitOverride ?? false),
    ],
  );

  return mapContributorRow(rows[0] as unknown as ContributorRawRow);
}

// ---------------------------------------------------------------------------
// listContributors — SELECT all contributors for a placement
// ---------------------------------------------------------------------------

/**
 * Lists all contributors for a given placement, ordered by created_at ascending.
 *
 * @returns Array of contributor records (may be empty).
 */
export async function listContributors(
  sql: Sql,
  placementId: string,
): Promise<Contributor[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, producer_id, role_code,
           split_pct, split_override, approved_by, approved_at, created_at
    FROM contributors
    WHERE placement_id = $1
    ORDER BY created_at ASC
    `,
    [placementId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as ContributorRawRow[]).map(mapContributorRow);
}

// ---------------------------------------------------------------------------
// deleteContributor — DELETE a contributor by ID, scoped to org
// ---------------------------------------------------------------------------

/**
 * Deletes a contributor assignment. Returns true if a row was deleted, false otherwise.
 *
 * @param orgId   - Tenant isolation: only deletes contributors belonging to this org.
 * @param contributorId - The contributor UUID to delete.
 * @returns true if deleted, false if not found.
 */
export async function deleteContributor(
  sql: Sql,
  orgId: string,
  contributorId: string,
): Promise<boolean> {
  const rows = await sql.unsafe(
    `
    DELETE FROM contributors
    WHERE id = $1 AND org_id = $2
    RETURNING id
    `,
    [contributorId, orgId],
  );

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// getSplitTotal — compute total split_pct for a placement
// ---------------------------------------------------------------------------

/**
 * Returns the sum of split_pct values for all contributors on a placement.
 *
 * A placement is "balanced" when this sum equals 1.0000 (100%).
 */
export async function getSplitTotal(sql: Sql, placementId: string): Promise<number> {
  const rows = await sql.unsafe(
    `
    SELECT COALESCE(SUM(split_pct), 0) AS total
    FROM contributors
    WHERE placement_id = $1
    `,
    [placementId],
  );

  const raw = rows[0] as unknown as { total: string | number };
  return Number(raw.total);
}

// ---------------------------------------------------------------------------
// Internal row type and mapper
// ---------------------------------------------------------------------------

interface ContributorRawRow {
  id: string;
  org_id: string;
  placement_id: string;
  producer_id: string;
  role_code: string;
  split_pct: string | number;
  split_override: boolean;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
}

function mapContributorRow(row: ContributorRawRow): Contributor {
  return {
    id: row.id,
    orgId: row.org_id,
    placementId: row.placement_id,
    producerId: row.producer_id,
    roleCode: row.role_code as ContributorRole,
    splitPct: Number(row.split_pct),
    splitOverride: row.split_override,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at,
  };
}

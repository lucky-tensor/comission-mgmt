/**
 * DB access functions for the payroll_export_artifacts table.
 *
 * Payroll exports are immutable CSV artifacts generated from Approved commission runs.
 * Calling createPayrollExport twice for the same run_id returns the existing artifact
 * (upsert with ON CONFLICT DO NOTHING + a subsequent SELECT).
 *
 * Canonical docs:
 *   - docs/prd.md §5.7 — Commission Close and Payroll Export
 *   - packages/db/schema.sql — payroll_export_artifacts DDL
 *
 * Issue: feat: payroll-ready export from approved commission run (#15)
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PayrollExportArtifactRow {
  id: string;
  orgId: string;
  runId: string;
  format: 'csv';
  content: string;
  rowCount: number;
  createdBy: string;
  createdAt: Date;
}

export interface CreatePayrollExportInput {
  orgId: string;
  runId: string;
  content: string;
  rowCount: number;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// createOrGetPayrollExport — INSERT ON CONFLICT DO NOTHING; return existing
// ---------------------------------------------------------------------------

/**
 * Creates a payroll export artifact for the given run.
 * If an artifact already exists for this run_id, returns the existing row
 * (idempotent — no duplicate file is created).
 *
 * Returns the artifact row (new or existing).
 */
export async function createOrGetPayrollExport(
  sql: Sql,
  input: CreatePayrollExportInput,
): Promise<PayrollExportArtifactRow> {
  // Attempt insert; do nothing on conflict so the existing row survives.
  await sql.unsafe(
    `
    INSERT INTO payroll_export_artifacts (org_id, run_id, format, content, row_count, created_by)
    VALUES ($1, $2, 'csv', $3, $4, $5)
    ON CONFLICT (run_id) DO NOTHING
    `,
    [input.orgId, input.runId, input.content, input.rowCount, input.createdBy],
  );

  // Always SELECT so we return the canonical row (new or pre-existing).
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, run_id, format, content, row_count, created_by, created_at
    FROM payroll_export_artifacts
    WHERE run_id = $1 AND org_id = $2
    LIMIT 1
    `,
    [input.runId, input.orgId],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createOrGetPayrollExport: no row found after upsert');
  }

  return mapArtifactRow(rows[0] as unknown as PayrollExportArtifactRawRow);
}

// ---------------------------------------------------------------------------
// listPayrollExports — SELECT all artifacts for a run
// ---------------------------------------------------------------------------

/**
 * Returns all payroll export artifacts for the given run, ordered by created_at.
 * In the current schema there is at most one artifact per run (UNIQUE constraint),
 * but this function is structured as a list for forward-compatibility.
 */
export async function listPayrollExports(
  sql: Sql,
  orgId: string,
  runId: string,
): Promise<PayrollExportArtifactRow[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, run_id, format, content, row_count, created_by, created_at
    FROM payroll_export_artifacts
    WHERE run_id = $1 AND org_id = $2
    ORDER BY created_at ASC
    `,
    [runId, orgId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as PayrollExportArtifactRawRow[]).map(mapArtifactRow);
}

// ---------------------------------------------------------------------------
// Internal types and mapper
// ---------------------------------------------------------------------------

interface PayrollExportArtifactRawRow {
  id: string;
  org_id: string;
  run_id: string;
  format: string;
  content: string;
  row_count: number | string;
  created_by: string;
  created_at: Date;
}

function mapArtifactRow(row: PayrollExportArtifactRawRow): PayrollExportArtifactRow {
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    format: row.format as 'csv',
    content: row.content,
    rowCount: Number(row.row_count),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

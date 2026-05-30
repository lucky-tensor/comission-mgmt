/**
 * DB access functions for the commission_runs and commission_run_records tables.
 *
 * commission_runs groups placements for a pay period. Finance Admins create a run,
 * individually approve each commission record, then approve the entire run.
 * An approved run is immutable — no further edits to included CommissionRecords.
 *
 * Canonical docs:
 *   - docs/prd.md §5.4, §9 — Finance Close Workflow
 *   - packages/db/schema.sql — commission_runs DDL
 *
 * Issue: feat: finance admin commission run and review queue (#13)
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommissionRunStatus = 'Open' | 'Approved' | 'Cancelled';

export interface CommissionRunRow {
  id: string;
  orgId: string;
  periodStart: string;
  periodEnd: string;
  status: CommissionRunStatus;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface CommissionRunRecordRow {
  id: string;
  orgId: string;
  runId: string;
  commissionRecordId: string;
  individuallyApproved: boolean;
  individuallyApprovedBy: string | null;
  individuallyApprovedAt: Date | null;
}

export interface CreateCommissionRunInput {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  createdBy: string;
  /** Commission record IDs to include in this run */
  commissionRecordIds: string[];
}

// ---------------------------------------------------------------------------
// createCommissionRun — INSERT run + link records
// ---------------------------------------------------------------------------

/**
 * Creates a new commission run and links the provided commission record IDs.
 *
 * Returns the newly created run row.
 */
export async function createCommissionRun(
  sql: Sql,
  input: CreateCommissionRunInput,
): Promise<CommissionRunRow> {
  const rows = await sql.unsafe(
    `
    INSERT INTO commission_runs (org_id, period_start, period_end, created_by)
    VALUES ($1, $2, $3, $4)
    RETURNING id, org_id, period_start, period_end, status,
              created_by, approved_by, approved_at, created_at
    `,
    [input.orgId, input.periodStart, input.periodEnd, input.createdBy],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createCommissionRun: insert returned no rows');
  }

  const run = mapRunRow(rows[0] as unknown as CommissionRunRawRow);

  // Link each commission record
  if (input.commissionRecordIds.length > 0) {
    for (const recordId of input.commissionRecordIds) {
      await sql.unsafe(
        `
        INSERT INTO commission_run_records (org_id, run_id, commission_record_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (run_id, commission_record_id) DO NOTHING
        `,
        [input.orgId, run.id, recordId],
      );
    }
  }

  return run;
}

// ---------------------------------------------------------------------------
// getCommissionRun — SELECT by ID scoped to org
// ---------------------------------------------------------------------------

/**
 * Fetches a single commission run by ID, scoped to org.
 * Returns null if not found.
 */
export async function getCommissionRun(
  sql: Sql,
  orgId: string,
  runId: string,
): Promise<CommissionRunRow | null> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, period_start, period_end, status,
           created_by, approved_by, approved_at, created_at
    FROM commission_runs
    WHERE id = $1 AND org_id = $2
    LIMIT 1
    `,
    [runId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return mapRunRow(rows[0] as unknown as CommissionRunRawRow);
}

// ---------------------------------------------------------------------------
// getCommissionRunRecords — SELECT all linked records for a run
// ---------------------------------------------------------------------------

/**
 * Returns all commission_run_records rows for the given run.
 */
export async function getCommissionRunRecords(
  sql: Sql,
  orgId: string,
  runId: string,
): Promise<CommissionRunRecordRow[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, run_id, commission_record_id,
           individually_approved, individually_approved_by, individually_approved_at
    FROM commission_run_records
    WHERE run_id = $1 AND org_id = $2
    ORDER BY id
    `,
    [runId, orgId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as CommissionRunRecordRawRow[]).map(mapRunRecordRow);
}

// ---------------------------------------------------------------------------
// approveRunRecord — mark a single commission_run_record as individually approved
// ---------------------------------------------------------------------------

/**
 * Marks a single commission_run_records row as individually approved.
 * Also updates the parent commission_records row to status='PendingApproval' (if still Accrued).
 *
 * Returns the updated run record row, or null if not found.
 */
export async function approveRunRecord(
  sql: Sql,
  orgId: string,
  runId: string,
  commissionRecordId: string,
  actorId: string,
): Promise<CommissionRunRecordRow | null> {
  // Update the junction row
  const rows = await sql.unsafe(
    `
    UPDATE commission_run_records
    SET individually_approved = true,
        individually_approved_by = $1,
        individually_approved_at = NOW()
    WHERE run_id = $2
      AND commission_record_id = $3
      AND org_id = $4
    RETURNING id, org_id, run_id, commission_record_id,
              individually_approved, individually_approved_by, individually_approved_at
    `,
    [actorId, runId, commissionRecordId, orgId],
  );

  if (!rows || rows.length === 0) return null;

  // Also transition commission_record to PendingApproval if still Accrued
  await sql.unsafe(
    `
    UPDATE commission_records
    SET status = 'PendingApproval',
        approval_actor = $1,
        approval_at = NOW()
    WHERE id = $2 AND org_id = $3 AND status = 'Accrued'
    `,
    [actorId, commissionRecordId, orgId],
  );

  return mapRunRecordRow(rows[0] as unknown as CommissionRunRecordRawRow);
}

// ---------------------------------------------------------------------------
// approveCommissionRun — transition run to Approved; requires all records approved
// ---------------------------------------------------------------------------

/**
 * Transitions a commission run to Approved status.
 * Returns the updated run, or null if not found.
 * Does NOT enforce the all-records-approved constraint here — the caller (handler)
 * is responsible for checking that before calling this.
 */
export async function approveCommissionRun(
  sql: Sql,
  orgId: string,
  runId: string,
  actorId: string,
): Promise<CommissionRunRow | null> {
  const rows = await sql.unsafe(
    `
    UPDATE commission_runs
    SET status = 'Approved',
        approved_by = $1,
        approved_at = NOW()
    WHERE id = $2 AND org_id = $3 AND status = 'Open'
    RETURNING id, org_id, period_start, period_end, status,
              created_by, approved_by, approved_at, created_at
    `,
    [actorId, runId, orgId],
  );

  if (!rows || rows.length === 0) return null;

  // Transition all included commission_records to Approved
  await sql.unsafe(
    `
    UPDATE commission_records cr
    SET status = 'Approved',
        approval_actor = $1,
        approval_at = NOW()
    FROM commission_run_records crr
    WHERE crr.run_id = $2
      AND crr.commission_record_id = cr.id
      AND cr.org_id = $3
      AND cr.status IN ('Accrued', 'PendingApproval')
    `,
    [actorId, runId, orgId],
  );

  return mapRunRow(rows[0] as unknown as CommissionRunRawRow);
}

// ---------------------------------------------------------------------------
// isCommissionRecordInApprovedRun — check immutability gate
// ---------------------------------------------------------------------------

/**
 * Returns true if the given commission record is included in any Approved run
 * for the org. Used to enforce immutability (409 Conflict) on PATCH attempts.
 */
export async function isCommissionRecordInApprovedRun(
  sql: Sql,
  orgId: string,
  commissionRecordId: string,
): Promise<boolean> {
  const rows = await sql.unsafe(
    `
    SELECT 1
    FROM commission_run_records crr
    JOIN commission_runs cr ON cr.id = crr.run_id
    WHERE crr.commission_record_id = $1
      AND crr.org_id = $2
      AND cr.status = 'Approved'
    LIMIT 1
    `,
    [commissionRecordId, orgId],
  );

  return !!(rows && rows.length > 0);
}

// ---------------------------------------------------------------------------
// Internal types and mappers
// ---------------------------------------------------------------------------

interface CommissionRunRawRow {
  id: string;
  org_id: string;
  period_start: Date | string;
  period_end: Date | string;
  status: string;
  created_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
}

interface CommissionRunRecordRawRow {
  id: string;
  org_id: string;
  run_id: string;
  commission_record_id: string;
  individually_approved: boolean;
  individually_approved_by: string | null;
  individually_approved_at: Date | null;
}

function formatDateString(value: Date | string | null | undefined): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // Postgres DATE columns come back as strings like "2025-03-01" or ISO strings
  return String(value).slice(0, 10);
}

function mapRunRow(row: CommissionRunRawRow): CommissionRunRow {
  return {
    id: row.id,
    orgId: row.org_id,
    periodStart: formatDateString(row.period_start),
    periodEnd: formatDateString(row.period_end),
    status: row.status as CommissionRunStatus,
    createdBy: row.created_by,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at,
  };
}

function mapRunRecordRow(row: CommissionRunRecordRawRow): CommissionRunRecordRow {
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    commissionRecordId: row.commission_record_id,
    individuallyApproved: row.individually_approved,
    individuallyApprovedBy: row.individually_approved_by ?? null,
    individuallyApprovedAt: row.individually_approved_at ?? null,
  };
}

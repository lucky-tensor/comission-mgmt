/**
 * DB access functions for the Manager Team View (issue #21).
 *
 * A manager's "team" is defined as the set of placements where the manager
 * appears as a contributor with role_code = 'ManagerOverride'.  All queries
 * are scoped to (org_id, manager_id) so a manager token cannot read another
 * manager's team data.
 *
 * Functions:
 *   listTeamPlacements          — placements the manager oversees
 *   getTeamCommissionSummary    — accruals / payables / holds grouped by producer
 *   listTeamPendingApprovals    — attribution requests in PendingApproval state
 *   listTeamDisputes            — open disputes for the manager's team placements
 *
 * Aggregation strategy: on-the-fly SQL aggregation (see
 * docs/architecture/phase-leadership-visibility.md for the decision record).
 *
 * Canonical docs: docs/prd.md §8.10, docs/architecture/phase-leadership-visibility.md
 * Issue: feat: manager team commission view (#21)
 */

import type { Sql } from 'postgres';
import { FieldEncryptor } from './encryption.js';
import { createKmsAdapter } from './kms.js';

// ---------------------------------------------------------------------------
// Encryptor singleton (lazy-initialised, same pattern as commission-records.ts)
// ---------------------------------------------------------------------------

let _encryptor: FieldEncryptor | null = null;

async function getEncryptor(): Promise<FieldEncryptor> {
  if (_encryptor) return _encryptor;
  const adapter = await createKmsAdapter();
  _encryptor = new FieldEncryptor(adapter);
  return _encryptor;
}

/** Replace the encryptor singleton. Used in tests to inject a test adapter. */
export function _setManagerTeamEncryptorForTest(enc: FieldEncryptor): void {
  _encryptor = enc;
}

/** Reset the encryptor singleton. Used in tests for isolation. */
export function _resetManagerTeamEncryptorForTest(): void {
  _encryptor = null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamPlacement {
  id: string;
  orgId: string;
  jobTitle: string;
  status: string;
  startDate: string | null;
  createdAt: Date;
}

export interface ProducerCommissionSummary {
  producerId: string;
  totalAccrued: string;
  totalPayable: string;
  totalHeld: string;
  recordCount: number;
}

export interface PendingApprovalItem {
  placementId: string;
  jobTitle: string;
  submittedAt: Date;
}

export interface TeamDisputeItem {
  id: string;
  orgId: string;
  commissionRecordId: string;
  submittedBy: string;
  description: string;
  state: string;
  createdAt: Date;
  placementId: string;
}

// ---------------------------------------------------------------------------
// listTeamPlacements
// ---------------------------------------------------------------------------

/**
 * Lists all placements where the manager (identified by managerId = producer_id) is
 * a contributor with role_code = 'ManagerOverride', scoped to org.
 *
 * Returns id, job_title, status, start_date, and created_at — no encrypted columns.
 */
export async function listTeamPlacements(
  sql: Sql,
  orgId: string,
  managerId: string,
): Promise<TeamPlacement[]> {
  const rows = await sql.unsafe(
    `
    SELECT DISTINCT p.id, p.org_id, p.job_title, p.status, p.start_date, p.created_at
    FROM placements p
    JOIN contributors c ON c.placement_id = p.id
    WHERE p.org_id = $1
      AND c.org_id = $1
      AND c.producer_id = $2
      AND c.role_code = 'ManagerOverride'
    ORDER BY p.created_at DESC
    `,
    [orgId, managerId],
  );

  if (!rows || rows.length === 0) return [];

  return (rows as unknown as TeamPlacementRawRow[]).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    jobTitle: row.job_title,
    status: row.status,
    startDate: row.start_date ?? null,
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// getTeamCommissionSummary
// ---------------------------------------------------------------------------

/**
 * Returns commission accruals, payables, and holds grouped by producer (contributor)
 * for all placements in the manager's team.
 *
 * Joins commission_records through contributors to get producer_id.
 * gross_amount and net_payable are encrypted BYTEA — we decrypt each row.
 *
 * Aggregation: sums net_payable per producer per status bucket.
 *
 * NOTE: Because gross_amount / net_payable are encrypted at rest (BYTEA), we
 * cannot do a SQL-level SUM. We fetch the raw rows and sum in application code.
 * This is consistent with the codebase-wide pattern for encrypted numeric columns.
 */
export async function getTeamCommissionSummary(
  sql: Sql,
  orgId: string,
  managerId: string,
): Promise<ProducerCommissionSummary[]> {
  const enc = await getEncryptor();

  // Fetch all commission records for the manager's team placements,
  // including producer_id so we can group client-side after decryption.
  const rows = await sql.unsafe(
    `
    SELECT cr.id,
           cr.net_payable,
           cr.status,
           c2.producer_id
    FROM commission_records cr
    -- join to contributor row that owns this commission record
    JOIN contributors c2 ON c2.id = cr.contributor_id
    -- restrict to placements where the manager is a ManagerOverride contributor
    WHERE cr.org_id = $1
      AND cr.placement_id IN (
        SELECT DISTINCT p.id
        FROM placements p
        JOIN contributors cm ON cm.placement_id = p.id
        WHERE p.org_id = $1
          AND cm.org_id = $1
          AND cm.producer_id = $2
          AND cm.role_code = 'ManagerOverride'
      )
    `,
    [orgId, managerId],
  );

  if (!rows || rows.length === 0) return [];

  // Decrypt net_payable for each row, then aggregate by producer_id.
  type RawRow = {
    id: string;
    net_payable: Buffer | Uint8Array;
    status: string;
    producer_id: string;
  };

  const accumulator = new Map<
    string,
    { accrued: number; payable: number; held: number; count: number }
  >();

  for (const rawRow of rows as unknown as RawRow[]) {
    const netPayableStr = await enc.decrypt(
      'commission_records',
      'net_payable',
      rawRow.net_payable as Buffer,
    );
    const amount = parseFloat(netPayableStr) || 0;
    const producerId = rawRow.producer_id;
    const status = rawRow.status as string;

    if (!accumulator.has(producerId)) {
      accumulator.set(producerId, { accrued: 0, payable: 0, held: 0, count: 0 });
    }
    const entry = accumulator.get(producerId)!;
    entry.count += 1;

    if (status === 'Accrued' || status === 'PendingApproval' || status === 'Approved') {
      entry.accrued += amount;
    } else if (status === 'Payable' || status === 'Paid') {
      entry.payable += amount;
    } else if (status === 'Held') {
      entry.held += amount;
    }
  }

  const result: ProducerCommissionSummary[] = [];
  for (const [producerId, sums] of accumulator.entries()) {
    result.push({
      producerId,
      totalAccrued: sums.accrued.toFixed(2),
      totalPayable: sums.payable.toFixed(2),
      totalHeld: sums.held.toFixed(2),
      recordCount: sums.count,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// listTeamPendingApprovals
// ---------------------------------------------------------------------------

/**
 * Returns placements in PendingApproval state for the manager's team.
 *
 * "Pending approvals" are placements that have been submitted for attribution
 * approval (status = 'PendingApproval') and belong to the manager's team.
 *
 * Returns placement_id, job_title, and the timestamp of the most recent
 * 'Submitted' attribution event (submitted_at).
 */
export async function listTeamPendingApprovals(
  sql: Sql,
  orgId: string,
  managerId: string,
): Promise<PendingApprovalItem[]> {
  const rows = await sql.unsafe(
    `
    SELECT p.id AS placement_id,
           p.job_title,
           ae.created_at AS submitted_at
    FROM placements p
    JOIN contributors c ON c.placement_id = p.id
    -- find the most recent Submitted attribution event per placement
    JOIN LATERAL (
      SELECT created_at
      FROM attribution_events
      WHERE placement_id = p.id
        AND event_type = 'Submitted'
      ORDER BY created_at DESC
      LIMIT 1
    ) ae ON true
    WHERE p.org_id = $1
      AND c.org_id = $1
      AND c.producer_id = $2
      AND c.role_code = 'ManagerOverride'
      AND p.status = 'PendingApproval'
    ORDER BY ae.created_at DESC
    `,
    [orgId, managerId],
  );

  if (!rows || rows.length === 0) return [];

  return (rows as unknown as PendingApprovalRawRow[]).map((row) => ({
    placementId: row.placement_id,
    jobTitle: row.job_title,
    submittedAt: row.submitted_at,
  }));
}

// ---------------------------------------------------------------------------
// listTeamDisputes
// ---------------------------------------------------------------------------

/**
 * Returns open (Submitted or UnderReview) disputes against commission records
 * that belong to the manager's team placements.
 *
 * "Open" = state IN ('Submitted', 'UnderReview').
 */
export async function listTeamDisputes(
  sql: Sql,
  orgId: string,
  managerId: string,
): Promise<TeamDisputeItem[]> {
  const rows = await sql.unsafe(
    `
    SELECT d.id,
           d.org_id,
           d.commission_record_id,
           d.submitted_by,
           d.description,
           d.state,
           d.created_at,
           cr.placement_id
    FROM disputes d
    JOIN commission_records cr ON cr.id = d.commission_record_id
    WHERE d.org_id = $1
      AND d.state IN ('Submitted', 'UnderReview')
      AND cr.placement_id IN (
        SELECT DISTINCT p.id
        FROM placements p
        JOIN contributors cm ON cm.placement_id = p.id
        WHERE p.org_id = $1
          AND cm.org_id = $1
          AND cm.producer_id = $2
          AND cm.role_code = 'ManagerOverride'
      )
    ORDER BY d.created_at DESC
    `,
    [orgId, managerId],
  );

  if (!rows || rows.length === 0) return [];

  return (rows as unknown as TeamDisputeRawRow[]).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    commissionRecordId: row.commission_record_id,
    submittedBy: row.submitted_by,
    description: row.description,
    state: row.state,
    createdAt: row.created_at,
    placementId: row.placement_id,
  }));
}

// ---------------------------------------------------------------------------
// Internal raw row types
// ---------------------------------------------------------------------------

interface TeamPlacementRawRow {
  id: string;
  org_id: string;
  job_title: string;
  status: string;
  start_date: string | null;
  created_at: Date;
}

interface PendingApprovalRawRow {
  placement_id: string;
  job_title: string;
  submitted_at: Date;
}

interface TeamDisputeRawRow {
  id: string;
  org_id: string;
  commission_record_id: string;
  submitted_by: string;
  description: string;
  state: string;
  created_at: Date;
  placement_id: string;
}

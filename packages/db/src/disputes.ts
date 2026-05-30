/**
 * DB access functions for the disputes table.
 *
 * Disputes are Producer-submitted questions or disputes about a specific
 * CommissionRecord. Finance Admins review and resolve them, optionally
 * linking to an exception or adjustment.
 *
 * State lifecycle: Submitted → UnderReview → Resolved
 *
 * Canonical docs: docs/prd.md §5.8, §4
 * Issue: feat: payout dispute and question submission (#18)
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DisputeState = 'Submitted' | 'UnderReview' | 'Resolved';

export interface DisputeRow {
  id: string;
  orgId: string;
  commissionRecordId: string;
  submittedBy: string;
  description: string;
  state: DisputeState;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  exceptionId: string | null;
  createdAt: Date;
}

export interface CreateDisputeInput {
  orgId: string;
  commissionRecordId: string;
  submittedBy: string;
  description: string;
}

// ---------------------------------------------------------------------------
// createDispute — INSERT a new dispute with state=Submitted
// ---------------------------------------------------------------------------

/**
 * Creates a new dispute with state=Submitted.
 * Returns the newly created row.
 */
export async function createDispute(sql: Sql, input: CreateDisputeInput): Promise<DisputeRow> {
  const rows = await sql.unsafe(
    `
    INSERT INTO disputes (org_id, commission_record_id, submitted_by, description)
    VALUES ($1, $2, $3, $4)
    RETURNING id, org_id, commission_record_id, submitted_by, description,
              state, resolved_by, resolved_at, resolution_note, exception_id, created_at
    `,
    [input.orgId, input.commissionRecordId, input.submittedBy, input.description],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createDispute: insert returned no rows');
  }

  return mapDisputeRow(rows[0] as unknown as DisputeRawRow);
}

// ---------------------------------------------------------------------------
// getDispute — SELECT by ID scoped to org
// ---------------------------------------------------------------------------

/**
 * Fetches a single dispute by ID, scoped to org.
 * Returns null if not found.
 */
export async function getDispute(
  sql: Sql,
  orgId: string,
  disputeId: string,
): Promise<DisputeRow | null> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, commission_record_id, submitted_by, description,
           state, resolved_by, resolved_at, resolution_note, exception_id, created_at
    FROM disputes
    WHERE id = $1 AND org_id = $2
    LIMIT 1
    `,
    [disputeId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return mapDisputeRow(rows[0] as unknown as DisputeRawRow);
}

// ---------------------------------------------------------------------------
// listDisputes — SELECT all disputes for org (Finance Admin)
// ---------------------------------------------------------------------------

/**
 * Lists all disputes for the org, ordered by created_at DESC.
 * Finance Admin view — sees all disputes.
 */
export async function listDisputes(sql: Sql, orgId: string): Promise<DisputeRow[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, commission_record_id, submitted_by, description,
           state, resolved_by, resolved_at, resolution_note, exception_id, created_at
    FROM disputes
    WHERE org_id = $1
    ORDER BY created_at DESC
    `,
    [orgId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as DisputeRawRow[]).map(mapDisputeRow);
}

// ---------------------------------------------------------------------------
// listDisputesByProducer — SELECT disputes for a specific producer within org
// ---------------------------------------------------------------------------

/**
 * Lists disputes submitted by a specific producer within the org.
 * Producer view — sees only their own disputes.
 */
export async function listDisputesByProducer(
  sql: Sql,
  orgId: string,
  submittedBy: string,
): Promise<DisputeRow[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, commission_record_id, submitted_by, description,
           state, resolved_by, resolved_at, resolution_note, exception_id, created_at
    FROM disputes
    WHERE org_id = $1 AND submitted_by = $2
    ORDER BY created_at DESC
    `,
    [orgId, submittedBy],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as DisputeRawRow[]).map(mapDisputeRow);
}

// ---------------------------------------------------------------------------
// resolveDispute — transition to Resolved with resolution_note
// ---------------------------------------------------------------------------

/**
 * Transitions a dispute to Resolved status and records the resolution_note.
 * Returns the updated row, or null if not found / already resolved.
 *
 * Optionally links to an exception_id if an exception was created to address it.
 */
export async function resolveDispute(
  sql: Sql,
  orgId: string,
  disputeId: string,
  actorId: string,
  resolutionNote: string,
  exceptionId?: string | null,
): Promise<DisputeRow | null> {
  const rows = await sql.unsafe(
    `
    UPDATE disputes
    SET state = 'Resolved',
        resolved_by = $1,
        resolved_at = NOW(),
        resolution_note = $2,
        exception_id = COALESCE($3, exception_id)
    WHERE id = $4 AND org_id = $5 AND state IN ('Submitted', 'UnderReview')
    RETURNING id, org_id, commission_record_id, submitted_by, description,
              state, resolved_by, resolved_at, resolution_note, exception_id, created_at
    `,
    [actorId, resolutionNote, exceptionId ?? null, disputeId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return mapDisputeRow(rows[0] as unknown as DisputeRawRow);
}

// ---------------------------------------------------------------------------
// Internal types and mappers
// ---------------------------------------------------------------------------

interface DisputeRawRow {
  id: string;
  org_id: string;
  commission_record_id: string;
  submitted_by: string;
  description: string;
  state: string;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_note: string | null;
  exception_id: string | null;
  created_at: Date;
}

function mapDisputeRow(row: DisputeRawRow): DisputeRow {
  return {
    id: row.id,
    orgId: row.org_id,
    commissionRecordId: row.commission_record_id,
    submittedBy: row.submitted_by,
    description: row.description,
    state: row.state as DisputeState,
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ?? null,
    resolutionNote: row.resolution_note ?? null,
    exceptionId: row.exception_id ?? null,
    createdAt: row.created_at,
  };
}

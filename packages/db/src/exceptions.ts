/**
 * DB access functions for the exceptions table.
 *
 * Exceptions capture nonstandard situations (custom splits, fee discounts,
 * accelerated payouts, draw forgiveness, clawback waivers) that require
 * explicit documentation and Finance Admin approval before posting a ledger
 * adjustment to the linked CommissionRecord.
 *
 * State lifecycle: Requested → UnderReview → Approved / Rejected
 *
 * Canonical docs: docs/prd.md §5.4
 * Issue: feat: exception request and approval workflow (#14)
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExceptionState = 'Requested' | 'UnderReview' | 'Approved' | 'Rejected';

export type ExceptionType =
  | 'custom_split'
  | 'fee_discount'
  | 'accelerated_payout'
  | 'manual_override'
  | 'draw_forgiveness'
  | 'clawback_waiver'
  | 'special_partner_agreement'
  | 'post_termination_payout';

export const EXCEPTION_TYPES: ExceptionType[] = [
  'custom_split',
  'fee_discount',
  'accelerated_payout',
  'manual_override',
  'draw_forgiveness',
  'clawback_waiver',
  'special_partner_agreement',
  'post_termination_payout',
];

export interface ExceptionRow {
  id: string;
  orgId: string;
  placementId: string;
  commissionRecordId: string | null;
  requestedBy: string;
  exceptionType: string;
  justification: string;
  impactAmount: string | null;
  status: ExceptionState;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  attachmentUrl: string | null;
  createdAt: Date;
}

export interface CreateExceptionInput {
  orgId: string;
  placementId: string;
  commissionRecordId?: string | null;
  requestedBy: string;
  exceptionType: string;
  justification: string;
  impactAmount?: string | null;
  attachmentUrl?: string | null;
}

// ---------------------------------------------------------------------------
// createException — INSERT a new exception request
// ---------------------------------------------------------------------------

/**
 * Creates a new exception request with status=Requested.
 * Returns the newly created row.
 */
export async function createException(
  sql: Sql,
  input: CreateExceptionInput,
): Promise<ExceptionRow> {
  const rows = await sql.unsafe(
    `
    INSERT INTO exceptions (
      org_id, placement_id, commission_record_id, requested_by,
      exception_type, justification, impact_amount, attachment_url
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, org_id, placement_id, commission_record_id,
              requested_by, exception_type, justification, impact_amount,
              status, reviewed_by, reviewed_at, rejection_reason,
              attachment_url, created_at
    `,
    [
      input.orgId,
      input.placementId,
      input.commissionRecordId ?? null,
      input.requestedBy,
      input.exceptionType,
      input.justification,
      input.impactAmount ?? null,
      input.attachmentUrl ?? null,
    ],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createException: insert returned no rows');
  }

  return mapExceptionRow(rows[0] as unknown as ExceptionRawRow);
}

// ---------------------------------------------------------------------------
// getException — SELECT by ID scoped to org
// ---------------------------------------------------------------------------

/**
 * Fetches a single exception by ID, scoped to org.
 * Returns null if not found.
 */
export async function getException(
  sql: Sql,
  orgId: string,
  exceptionId: string,
): Promise<ExceptionRow | null> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, commission_record_id,
           requested_by, exception_type, justification, impact_amount,
           status, reviewed_by, reviewed_at, rejection_reason,
           attachment_url, created_at
    FROM exceptions
    WHERE id = $1 AND org_id = $2
    LIMIT 1
    `,
    [exceptionId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return mapExceptionRow(rows[0] as unknown as ExceptionRawRow);
}

// ---------------------------------------------------------------------------
// listExceptions — SELECT with optional state filter
// ---------------------------------------------------------------------------

/**
 * Lists exceptions for the org, optionally filtered by state.
 * Returns rows ordered by created_at DESC.
 */
export async function listExceptions(
  sql: Sql,
  orgId: string,
  state?: string | null,
): Promise<ExceptionRow[]> {
  let rows;
  if (state) {
    rows = await sql.unsafe(
      `
      SELECT id, org_id, placement_id, commission_record_id,
             requested_by, exception_type, justification, impact_amount,
             status, reviewed_by, reviewed_at, rejection_reason,
             attachment_url, created_at
      FROM exceptions
      WHERE org_id = $1 AND status = $2::exception_state
      ORDER BY created_at DESC
      `,
      [orgId, state],
    );
  } else {
    rows = await sql.unsafe(
      `
      SELECT id, org_id, placement_id, commission_record_id,
             requested_by, exception_type, justification, impact_amount,
             status, reviewed_by, reviewed_at, rejection_reason,
             attachment_url, created_at
      FROM exceptions
      WHERE org_id = $1
      ORDER BY created_at DESC
      `,
      [orgId],
    );
  }

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as ExceptionRawRow[]).map(mapExceptionRow);
}

// ---------------------------------------------------------------------------
// approveException — transition to Approved
// ---------------------------------------------------------------------------

/**
 * Transitions an exception to Approved status and applies the ledger adjustment.
 *
 * When impact_amount is set, increments net_payable on the linked CommissionRecord
 * by re-encrypting the value. Since net_payable is encrypted BYTEA, the caller
 * (handler layer) is responsible for performing the adjustment via the calculate
 * module. This function only updates the exception state.
 *
 * Returns the updated exception row, or null if not found / already reviewed.
 */
export async function approveException(
  sql: Sql,
  orgId: string,
  exceptionId: string,
  actorId: string,
): Promise<ExceptionRow | null> {
  const rows = await sql.unsafe(
    `
    UPDATE exceptions
    SET status = 'Approved',
        reviewed_by = $1,
        reviewed_at = NOW()
    WHERE id = $2 AND org_id = $3 AND status IN ('Requested', 'UnderReview')
    RETURNING id, org_id, placement_id, commission_record_id,
              requested_by, exception_type, justification, impact_amount,
              status, reviewed_by, reviewed_at, rejection_reason,
              attachment_url, created_at
    `,
    [actorId, exceptionId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return mapExceptionRow(rows[0] as unknown as ExceptionRawRow);
}

// ---------------------------------------------------------------------------
// rejectException — transition to Rejected with reason
// ---------------------------------------------------------------------------

/**
 * Transitions an exception to Rejected status and records the rejection reason.
 * Returns the updated exception row, or null if not found / already reviewed.
 */
export async function rejectException(
  sql: Sql,
  orgId: string,
  exceptionId: string,
  actorId: string,
  rejectionReason: string,
): Promise<ExceptionRow | null> {
  const rows = await sql.unsafe(
    `
    UPDATE exceptions
    SET status = 'Rejected',
        reviewed_by = $1,
        reviewed_at = NOW(),
        rejection_reason = $2
    WHERE id = $3 AND org_id = $4 AND status IN ('Requested', 'UnderReview')
    RETURNING id, org_id, placement_id, commission_record_id,
              requested_by, exception_type, justification, impact_amount,
              status, reviewed_by, reviewed_at, rejection_reason,
              attachment_url, created_at
    `,
    [actorId, rejectionReason, exceptionId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return mapExceptionRow(rows[0] as unknown as ExceptionRawRow);
}

// ---------------------------------------------------------------------------
// writeNetPayableBytes — low-level writer for the encrypted net_payable column
// ---------------------------------------------------------------------------

/**
 * Writes a new encrypted net_payable BYTEA back to commission_records.
 *
 * The caller is responsible for decrypting the current value, adding the
 * impact_amount, re-encrypting, and passing the result here.
 * The FieldEncryptor from packages/db/src/encryption.ts handles crypto.
 *
 * @param sql                - Postgres client
 * @param orgId              - Tenant scope
 * @param commissionRecordId - Target record
 * @param newNetPayableBytes - Re-encrypted BYTEA buffer for net_payable
 */
export async function writeNetPayableBytes(
  sql: Sql,
  orgId: string,
  commissionRecordId: string,
  newNetPayableBytes: Buffer,
): Promise<void> {
  await sql.unsafe(
    `
    UPDATE commission_records
    SET net_payable = $1
    WHERE id = $2 AND org_id = $3
    `,
    [newNetPayableBytes, commissionRecordId, orgId],
  );
}

// ---------------------------------------------------------------------------
// Internal types and mappers
// ---------------------------------------------------------------------------

interface ExceptionRawRow {
  id: string;
  org_id: string;
  placement_id: string;
  commission_record_id: string | null;
  requested_by: string;
  exception_type: string;
  justification: string;
  impact_amount: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  attachment_url: string | null;
  created_at: Date;
}

function mapExceptionRow(row: ExceptionRawRow): ExceptionRow {
  return {
    id: row.id,
    orgId: row.org_id,
    placementId: row.placement_id,
    commissionRecordId: row.commission_record_id ?? null,
    requestedBy: row.requested_by,
    exceptionType: row.exception_type,
    justification: row.justification,
    impactAmount: row.impact_amount != null ? String(row.impact_amount) : null,
    status: row.status as ExceptionState,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
    attachmentUrl: row.attachment_url ?? null,
    createdAt: row.created_at,
  };
}

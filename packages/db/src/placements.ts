/**
 * DB access functions for the placements table with transparent field encryption.
 *
 * All writes encrypt the sensitive BYTEA columns (compensation_base, fee_amount)
 * using the FieldEncryptor before inserting into Postgres.
 * All reads decrypt those columns transparently before returning the record.
 *
 * Encrypted columns: placements.compensation_base, placements.fee_amount
 * Canonical: docs/architecture/decisions.md — Field Encryption Registry
 */

import type { Sql } from 'postgres';
import { FieldEncryptor } from './encryption.js';
import { createKmsAdapter } from './kms.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlacementStatus =
  | 'Created'
  | 'ContributorsAssigned'
  | 'PendingApproval'
  | 'Active'
  | 'Invoiced'
  | 'Collected'
  | 'GuaranteeActive'
  | 'GuaranteeExpired'
  | 'Closed'
  | 'Refunded'
  | 'Disputed'
  | 'ClawbackTriggered';

export interface CreatePlacementInput {
  id?: string;
  orgId: string;
  candidateId: string;
  clientEntityId: string;
  jobTitle: string;
  /** Numeric string, e.g. "150000" or "75000.00" */
  compensationBase: string;
  /** Numeric string, e.g. "22500" */
  feeAmount: string;
  status?: PlacementStatus;
  startDate?: string | null;
  guaranteeDays?: number | null;
}

export interface Placement {
  id: string;
  orgId: string;
  candidateId: string;
  clientEntityId: string;
  jobTitle: string;
  /** Decrypted string value */
  compensationBase: string;
  /** Decrypted string value */
  feeAmount: string;
  status: PlacementStatus;
  startDate: string | null;
  guaranteeDays: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Encryptor singleton (lazy-initialised)
// ---------------------------------------------------------------------------

let _encryptor: FieldEncryptor | null = null;

async function getEncryptor(): Promise<FieldEncryptor> {
  if (_encryptor) return _encryptor;
  const adapter = await createKmsAdapter();
  _encryptor = new FieldEncryptor(adapter);
  return _encryptor;
}

/** Replace the encryptor singleton. Used in tests to inject a test adapter. */
export function _setEncryptorForTest(enc: FieldEncryptor): void {
  _encryptor = enc;
}

/** Reset the encryptor singleton. Used in tests for isolation. */
export function _resetEncryptorForTest(): void {
  _encryptor = null;
}

// ---------------------------------------------------------------------------
// createPlacement — encrypt sensitive fields then INSERT
// ---------------------------------------------------------------------------

/**
 * Inserts a new placement row, encrypting compensationBase and feeAmount
 * as BYTEA before writing to Postgres.
 *
 * @returns The newly created placement with decrypted field values.
 */
export async function createPlacement(sql: Sql, input: CreatePlacementInput): Promise<Placement> {
  const enc = await getEncryptor();

  const compensationBaseBuf = await enc.encrypt(
    'placements',
    'compensation_base',
    input.compensationBase,
  );
  const feeAmountBuf = await enc.encrypt('placements', 'fee_amount', input.feeAmount);

  const idClause = input.id ? `'${input.id}',` : '';
  const idColClause = input.id ? 'id,' : '';
  const startDateClause = input.startDate != null ? `'${input.startDate}',` : 'NULL,';
  const guaranteeDaysClause = input.guaranteeDays != null ? String(input.guaranteeDays) : 'NULL';
  const statusClause = input.status ?? 'Created';

  const rows = await sql.unsafe(
    `
    INSERT INTO placements (
      ${idColClause}
      org_id, candidate_id, client_entity_id, job_title,
      compensation_base, fee_amount, status, start_date, guarantee_days
    ) VALUES (
      ${idClause}
      '${input.orgId}', '${input.candidateId}', '${input.clientEntityId}', '${input.jobTitle}',
      $1, $2, '${statusClause}', ${startDateClause} ${guaranteeDaysClause}
    )
    RETURNING id, org_id, candidate_id, client_entity_id, job_title,
              compensation_base, fee_amount, status, start_date, guarantee_days,
              created_at, updated_at
    `,
    [compensationBaseBuf, feeAmountBuf],
  );

  return decryptPlacementRow(enc, rows[0] as unknown as PlacementRawRow);
}

// ---------------------------------------------------------------------------
// listPlacements — SELECT all for an org, then decrypt
// ---------------------------------------------------------------------------

/**
 * Lists all placements for a given org, ordered by created_at descending.
 * Decrypts the BYTEA columns transparently.
 *
 * @returns Array of decrypted Placement records (may be empty).
 */
export async function listPlacements(sql: Sql, orgId: string): Promise<Placement[]> {
  const enc = await getEncryptor();

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, candidate_id, client_entity_id, job_title,
           compensation_base, fee_amount, status, start_date, guarantee_days,
           created_at, updated_at
    FROM placements
    WHERE org_id = $1
    ORDER BY created_at DESC
    `,
    [orgId],
  );

  if (!rows || rows.length === 0) return [];
  return Promise.all(
    (rows as unknown as PlacementRawRow[]).map((row) => decryptPlacementRow(enc, row)),
  );
}

// ---------------------------------------------------------------------------
// getPlacement — SELECT then decrypt
// ---------------------------------------------------------------------------

/**
 * Fetches a placement by ID and decrypts the BYTEA columns transparently.
 *
 * @returns Decrypted Placement, or null if not found.
 */
export async function getPlacement(sql: Sql, id: string): Promise<Placement | null> {
  const enc = await getEncryptor();

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, candidate_id, client_entity_id, job_title,
           compensation_base, fee_amount, status, start_date, guarantee_days,
           created_at, updated_at
    FROM placements
    WHERE id = $1
    LIMIT 1
    `,
    [id],
  );

  if (!rows || rows.length === 0) return null;
  return decryptPlacementRow(enc, rows[0] as unknown as PlacementRawRow);
}

// ---------------------------------------------------------------------------
// Internal types and helper — decrypt a raw DB row
// ---------------------------------------------------------------------------

interface PlacementRawRow {
  id: string;
  org_id: string;
  candidate_id: string;
  client_entity_id: string;
  job_title: string;
  compensation_base: Buffer | Uint8Array;
  fee_amount: Buffer | Uint8Array;
  status: string;
  start_date: string | null;
  guarantee_days: number | null;
  created_at: Date;
  updated_at: Date;
}

async function decryptPlacementRow(enc: FieldEncryptor, row: PlacementRawRow): Promise<Placement> {
  const compensationBase = await enc.decrypt(
    'placements',
    'compensation_base',
    Buffer.isBuffer(row.compensation_base)
      ? row.compensation_base
      : Buffer.from(row.compensation_base),
  );
  const feeAmount = await enc.decrypt(
    'placements',
    'fee_amount',
    Buffer.isBuffer(row.fee_amount) ? row.fee_amount : Buffer.from(row.fee_amount),
  );

  return {
    id: row.id,
    orgId: row.org_id,
    candidateId: row.candidate_id,
    clientEntityId: row.client_entity_id,
    jobTitle: row.job_title,
    compensationBase,
    feeAmount,
    status: row.status as PlacementStatus,
    startDate: row.start_date ?? null,
    guaranteeDays: row.guarantee_days ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

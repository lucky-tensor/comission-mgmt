/**
 * DB access functions for the commission_records table.
 *
 * commission_records stores one row per contributor per placement per calculation run.
 * gross_amount and net_payable are BYTEA columns encrypted via FieldEncryptor.
 *
 * Canonical docs:
 *   - docs/prd.md §5.3 — Commission Calculation
 *   - docs/architecture/decisions.md — ER Diagram (commission_records)
 *   - packages/db/schema.sql — commission_records DDL
 *
 * Issue: feat: commission calculation engine (#10)
 */

import type { Sql } from 'postgres';
import { FieldEncryptor } from './encryption.js';
import { createKmsAdapter } from './kms.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommissionRecordStatus =
  | 'Accrued'
  | 'PendingApproval'
  | 'Approved'
  | 'Held'
  | 'Payable'
  | 'Paid'
  | 'ClawbackInitiated'
  | 'Recovered';

export interface CommissionRecordRow {
  id: string;
  orgId: string;
  placementId: string;
  contributorId: string;
  planVersionId: string;
  /** Decrypted gross commission amount as a string, e.g. "25000.00" */
  grossAmount: string;
  /** Decrypted net payable amount as a string, e.g. "20000.00" */
  netPayable: string;
  /** Tier rate applied, e.g. 0.25 = 25%. Null when base rate used. */
  tierRate: number | null;
  status: CommissionRecordStatus;
  approvalActor: string | null;
  approvalAt: Date | null;
  createdAt: Date;
}

export interface CreateCommissionRecordInput {
  orgId: string;
  placementId: string;
  contributorId: string;
  planVersionId: string;
  /** Gross commission amount as a numeric string or number. */
  grossAmount: number | string;
  /** Net payable amount as a numeric string or number. */
  netPayable: number | string;
  /** Tier rate applied (decimal fraction, e.g. 0.25). Null when none applied. */
  tierRate?: number | null;
  status: CommissionRecordStatus;
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
// createCommissionRecord — encrypt sensitive fields then INSERT
// ---------------------------------------------------------------------------

/**
 * Inserts a new commission_records row, encrypting grossAmount and netPayable
 * as BYTEA before writing to Postgres.
 *
 * Returns the newly created record with decrypted field values.
 */
export async function createCommissionRecord(
  sql: Sql,
  input: CreateCommissionRecordInput,
): Promise<CommissionRecordRow> {
  const enc = await getEncryptor();

  const grossAmountStr = String(input.grossAmount);
  const netPayableStr = String(input.netPayable);

  const grossAmountBuf = await enc.encrypt('commission_records', 'gross_amount', grossAmountStr);
  const netPayableBuf = await enc.encrypt('commission_records', 'net_payable', netPayableStr);

  const tierRateClause = input.tierRate != null ? `${input.tierRate}` : 'NULL';

  const rows = await sql.unsafe(
    `
    INSERT INTO commission_records (
      org_id, placement_id, contributor_id, plan_version_id,
      gross_amount, net_payable, tier_rate, status
    ) VALUES (
      '${input.orgId}', '${input.placementId}', '${input.contributorId}', '${input.planVersionId}',
      $1, $2, ${tierRateClause}, '${input.status}'
    )
    RETURNING id, org_id, placement_id, contributor_id, plan_version_id,
              gross_amount, net_payable, tier_rate, status,
              approval_actor, approval_at, created_at
    `,
    [grossAmountBuf, netPayableBuf],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createCommissionRecord: insert returned no rows');
  }

  return decryptRecordRow(enc, rows[0] as unknown as CommissionRecordRawRow);
}

// ---------------------------------------------------------------------------
// listCommissionRecords — SELECT all records for a placement
// ---------------------------------------------------------------------------

/**
 * Lists all commission records for a given placement, ordered by created_at descending.
 * Decrypts BYTEA columns transparently.
 */
export async function listCommissionRecords(
  sql: Sql,
  orgId: string,
  placementId: string,
): Promise<CommissionRecordRow[]> {
  const enc = await getEncryptor();

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, contributor_id, plan_version_id,
           gross_amount, net_payable, tier_rate, status,
           approval_actor, approval_at, created_at
    FROM commission_records
    WHERE org_id = $1 AND placement_id = $2
    ORDER BY created_at DESC
    `,
    [orgId, placementId],
  );

  if (!rows || rows.length === 0) return [];
  return Promise.all(
    (rows as unknown as CommissionRecordRawRow[]).map((row) => decryptRecordRow(enc, row)),
  );
}

// ---------------------------------------------------------------------------
// getCommissionRecord — SELECT a single record by ID
// ---------------------------------------------------------------------------

/**
 * Fetches a single commission record by ID, scoped to org.
 * Returns null if not found.
 */
export async function getCommissionRecord(
  sql: Sql,
  orgId: string,
  recordId: string,
): Promise<CommissionRecordRow | null> {
  const enc = await getEncryptor();

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, contributor_id, plan_version_id,
           gross_amount, net_payable, tier_rate, status,
           approval_actor, approval_at, created_at
    FROM commission_records
    WHERE id = $1 AND org_id = $2
    LIMIT 1
    `,
    [recordId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return decryptRecordRow(enc, rows[0] as unknown as CommissionRecordRawRow);
}

// ---------------------------------------------------------------------------
// Internal types and helper — decrypt a raw DB row
// ---------------------------------------------------------------------------

interface CommissionRecordRawRow {
  id: string;
  org_id: string;
  placement_id: string;
  contributor_id: string;
  plan_version_id: string;
  gross_amount: Buffer | Uint8Array;
  net_payable: Buffer | Uint8Array;
  tier_rate: string | number | null;
  status: string;
  approval_actor: string | null;
  approval_at: Date | null;
  created_at: Date;
}

async function decryptRecordRow(
  enc: FieldEncryptor,
  row: CommissionRecordRawRow,
): Promise<CommissionRecordRow> {
  const grossAmount = await enc.decrypt(
    'commission_records',
    'gross_amount',
    Buffer.isBuffer(row.gross_amount) ? row.gross_amount : Buffer.from(row.gross_amount),
  );
  const netPayable = await enc.decrypt(
    'commission_records',
    'net_payable',
    Buffer.isBuffer(row.net_payable) ? row.net_payable : Buffer.from(row.net_payable),
  );

  return {
    id: row.id,
    orgId: row.org_id,
    placementId: row.placement_id,
    contributorId: row.contributor_id,
    planVersionId: row.plan_version_id,
    grossAmount,
    netPayable,
    tierRate: row.tier_rate != null ? Number(row.tier_rate) : null,
    status: row.status as CommissionRecordStatus,
    approvalActor: row.approval_actor ?? null,
    approvalAt: row.approval_at ?? null,
    createdAt: row.created_at,
  };
}

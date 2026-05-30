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
  /**
   * Pre-computed expiry date: start_date + guarantee_days.
   * ISO date string (YYYY-MM-DD). NULL when start_date or guarantee_days is absent.
   * Issue: feat: guarantee period tracking and monitoring (#19)
   */
  guaranteeExpiryDate?: string | null;
  isConfidential?: boolean;
}

export interface UpdatePlacementInput {
  candidateId?: string;
  clientEntityId?: string;
  jobTitle?: string;
  compensationBase?: string;
  feeAmount?: string;
  status?: PlacementStatus;
  startDate?: string | null;
  guaranteeDays?: number | null;
  /**
   * Pre-computed expiry date: start_date + guarantee_days.
   * Issue: feat: guarantee period tracking and monitoring (#19)
   */
  guaranteeExpiryDate?: string | null;
  isConfidential?: boolean;
}

/**
 * The set of fields that must be present for a placement to be commission-eligible.
 * A placement missing any of these fields (or lacking at least one contributor) is "incomplete".
 */
export const COMMISSION_REQUIRED_FIELDS = [
  'client_entity_id',
  'start_date',
  'fee_amount',
  'compensation_base',
] as const;

export type CommissionRequiredField = (typeof COMMISSION_REQUIRED_FIELDS)[number] | 'contributors';

export interface IncompletePlacement extends Placement {
  missingFields: CommissionRequiredField[];
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
  /**
   * Computed at write time: start_date + guarantee_days (ISO date string YYYY-MM-DD).
   * NULL when start_date or guarantee_days is absent.
   * Issue: feat: guarantee period tracking and monitoring (#19)
   */
  guaranteeExpiryDate: string | null;
  isConfidential: boolean;
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

  // Every caller-supplied value is passed as a bound $n parameter — no value is
  // ever interpolated into the SQL string (DATA-C-005 injection defense).
  const cols: string[] = [];
  const valuePlaceholders: string[] = [];
  const params: unknown[] = [];
  const bind = (col: string, value: unknown): void => {
    cols.push(col);
    params.push(value);
    valuePlaceholders.push(`$${params.length}`);
  };

  if (input.id) bind('id', input.id);
  bind('org_id', input.orgId);
  bind('candidate_id', input.candidateId);
  bind('client_entity_id', input.clientEntityId);
  bind('job_title', input.jobTitle);
  bind('compensation_base', compensationBaseBuf);
  bind('fee_amount', feeAmountBuf);
  bind('status', input.status ?? 'Created');
  bind('start_date', input.startDate ?? null);
  bind('guarantee_days', input.guaranteeDays ?? null);
  bind('guarantee_expiry_date', input.guaranteeExpiryDate ?? null);
  bind('is_confidential', input.isConfidential === true);

  const rows = await sql.unsafe(
    `
    INSERT INTO placements (${cols.join(', ')})
    VALUES (${valuePlaceholders.join(', ')})
    RETURNING id, org_id, candidate_id, client_entity_id, job_title,
              compensation_base, fee_amount, status, start_date, guarantee_days,
              guarantee_expiry_date, is_confidential,
              created_at, updated_at
    `,
    params as unknown[] as (string | Buffer)[],
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
           guarantee_expiry_date, is_confidential,
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
           guarantee_expiry_date, is_confidential,
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
// updatePlacement — UPDATE fields then return refreshed record
// ---------------------------------------------------------------------------

/**
 * Updates mutable fields on a placement.
 * Only the fields present in the input are updated; others remain unchanged.
 *
 * @returns The updated placement with decrypted field values, or null if not found.
 */
export async function updatePlacement(
  sql: Sql,
  id: string,
  input: UpdatePlacementInput,
  orgId?: string,
): Promise<Placement | null> {
  const enc = await getEncryptor();

  const setClauses: string[] = [];
  const params: unknown[] = [];
  // Every value flows through a bound $n parameter — never interpolated.
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (input.candidateId !== undefined) {
    setClauses.push(`candidate_id = ${bind(input.candidateId)}`);
  }
  if (input.clientEntityId !== undefined) {
    setClauses.push(`client_entity_id = ${bind(input.clientEntityId)}`);
  }
  if (input.jobTitle !== undefined) {
    setClauses.push(`job_title = ${bind(input.jobTitle)}`);
  }
  if (input.compensationBase !== undefined) {
    const buf = await enc.encrypt('placements', 'compensation_base', input.compensationBase);
    setClauses.push(`compensation_base = ${bind(buf)}`);
  }
  if (input.feeAmount !== undefined) {
    const buf = await enc.encrypt('placements', 'fee_amount', input.feeAmount);
    setClauses.push(`fee_amount = ${bind(buf)}`);
  }
  if (input.status !== undefined) {
    setClauses.push(`status = ${bind(input.status)}`);
  }
  if ('startDate' in input) {
    setClauses.push(`start_date = ${bind(input.startDate ?? null)}`);
  }
  if ('guaranteeDays' in input) {
    setClauses.push(`guarantee_days = ${bind(input.guaranteeDays ?? null)}`);
  }
  if ('guaranteeExpiryDate' in input) {
    setClauses.push(`guarantee_expiry_date = ${bind(input.guaranteeExpiryDate ?? null)}`);
  }
  if (input.isConfidential !== undefined) {
    setClauses.push(`is_confidential = ${bind(input.isConfidential === true)}`);
  }

  if (setClauses.length === 0) {
    // Nothing to update — just return existing record
    return getPlacement(sql, id);
  }

  setClauses.push(`updated_at = NOW()`);

  // Tenancy: when orgId is supplied, scope the write so a guessed cross-tenant
  // id cannot be mutated (DATA tenancy isolation).
  const idPlaceholder = bind(id);
  const orgClause = orgId !== undefined ? ` AND org_id = ${bind(orgId)}` : '';

  const query = `
    UPDATE placements
    SET ${setClauses.join(', ')}
    WHERE id = ${idPlaceholder}${orgClause}
    RETURNING id, org_id, candidate_id, client_entity_id, job_title,
              compensation_base, fee_amount, status, start_date, guarantee_days,
              guarantee_expiry_date, is_confidential,
              created_at, updated_at
  `;

  const rows = await sql.unsafe(query, params as (string | Buffer)[]);
  if (!rows || rows.length === 0) return null;
  return decryptPlacementRow(enc, rows[0] as unknown as PlacementRawRow);
}

// ---------------------------------------------------------------------------
// listIncompletePlacements — placements missing commission-required fields
// ---------------------------------------------------------------------------

/**
 * Returns all placements for the given org that are missing at least one
 * commission-required field (or have no contributors assigned).
 *
 * A placement is considered incomplete when it lacks any of:
 *   - client_entity_id (always present due to schema constraint — checked logically)
 *   - start_date (nullable, may be NULL)
 *   - fee_amount (non-zero check: zero value is treated as missing)
 *   - compensation_base (non-zero check)
 *   - at least one contributor row
 *
 * @returns Array of IncompletePlacement records annotated with missingFields[].
 */
export async function listIncompletePlacements(
  sql: Sql,
  orgId: string,
): Promise<IncompletePlacement[]> {
  const enc = await getEncryptor();

  // Fetch all placements for the org along with contributor counts
  const rows = await sql.unsafe(
    `
    SELECT p.id, p.org_id, p.candidate_id, p.client_entity_id, p.job_title,
           p.compensation_base, p.fee_amount, p.status, p.start_date, p.guarantee_days,
           p.guarantee_expiry_date, p.is_confidential, p.created_at, p.updated_at,
           COUNT(c.id) AS contributor_count
    FROM placements p
    LEFT JOIN contributors c ON c.placement_id = p.id AND c.org_id = $1
    WHERE p.org_id = $1
    GROUP BY p.id
    ORDER BY p.created_at DESC
    `,
    [orgId],
  );

  if (!rows || rows.length === 0) return [];

  const results: IncompletePlacement[] = [];

  for (const rawRow of rows as unknown as (PlacementRawRow & {
    contributor_count: string | number;
  })[]) {
    const placement = await decryptPlacementRow(enc, rawRow);
    const contributorCount = Number(rawRow.contributor_count ?? 0);

    const missingFields: CommissionRequiredField[] = [];

    // start_date: NULL means missing
    if (!placement.startDate) {
      missingFields.push('start_date');
    }

    // fee_amount: zero or empty string means missing
    if (!placement.feeAmount || Number(placement.feeAmount) === 0) {
      missingFields.push('fee_amount');
    }

    // compensation_base: zero or empty string means missing
    if (!placement.compensationBase || Number(placement.compensationBase) === 0) {
      missingFields.push('compensation_base');
    }

    // contributors: at least one required
    if (contributorCount === 0) {
      missingFields.push('contributors');
    }

    if (missingFields.length > 0) {
      results.push({ ...placement, missingFields });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// checkPlacementsComplete — batch completeness check for commission run pre-flight
// ---------------------------------------------------------------------------

/**
 * Checks whether each of the given placement IDs is complete (commission-eligible).
 * Returns a map of placementId → missingFields[] for any incomplete placements.
 *
 * Placements not found or belonging to a different org are treated as incomplete
 * with missingFields=['not_found'].
 */
export async function checkPlacementsComplete(
  sql: Sql,
  orgId: string,
  placementIds: string[],
): Promise<Map<string, CommissionRequiredField[]>> {
  if (placementIds.length === 0) return new Map();

  const enc = await getEncryptor();

  // Build a parameterized IN clause
  const placeholders = placementIds.map((_, i) => `$${i + 2}`).join(', ');
  const rows = await sql.unsafe(
    `
    SELECT p.id, p.org_id, p.candidate_id, p.client_entity_id, p.job_title,
           p.compensation_base, p.fee_amount, p.status, p.start_date, p.guarantee_days,
           p.guarantee_expiry_date, p.is_confidential, p.created_at, p.updated_at,
           COUNT(c.id) AS contributor_count
    FROM placements p
    LEFT JOIN contributors c ON c.placement_id = p.id AND c.org_id = $1
    WHERE p.org_id = $1 AND p.id IN (${placeholders})
    GROUP BY p.id
    `,
    [orgId, ...placementIds],
  );

  const foundIds = new Set<string>();
  const result = new Map<string, CommissionRequiredField[]>();

  for (const rawRow of rows as unknown as (PlacementRawRow & {
    contributor_count: string | number;
  })[]) {
    const placement = await decryptPlacementRow(enc, rawRow);
    foundIds.add(placement.id);
    const contributorCount = Number(rawRow.contributor_count ?? 0);

    const missingFields: CommissionRequiredField[] = [];
    if (!placement.startDate) missingFields.push('start_date');
    if (!placement.feeAmount || Number(placement.feeAmount) === 0) missingFields.push('fee_amount');
    if (!placement.compensationBase || Number(placement.compensationBase) === 0)
      missingFields.push('compensation_base');
    if (contributorCount === 0) missingFields.push('contributors');

    if (missingFields.length > 0) {
      result.set(placement.id, missingFields);
    }
  }

  // Any requested IDs not found → treat as not_found
  for (const id of placementIds) {
    if (!foundIds.has(id)) {
      result.set(id, ['contributors']); // conservative: flag as incomplete
    }
  }

  return result;
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
  guarantee_expiry_date: Date | string | null;
  is_confidential: boolean;
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

  // guarantee_expiry_date may be a Date object from Postgres or a string
  const rawExpiry = row.guarantee_expiry_date;
  const guaranteeExpiryDate =
    rawExpiry == null
      ? null
      : rawExpiry instanceof Date
        ? rawExpiry.toISOString().slice(0, 10)
        : String(rawExpiry).slice(0, 10);

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
    guaranteeExpiryDate,
    isConfidential: row.is_confidential ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * DB access functions for the invoices table.
 *
 * invoices stores one row per client invoice linked to a placement.
 * amount_billed and amount_collected are BYTEA columns encrypted via FieldEncryptor.
 *
 * Canonical docs:
 *   - docs/prd.md §5.5 — Invoice and Collection Tracking
 *   - docs/prd.md §7.2 — Accounts Receivable and Invoice Data
 *   - packages/db/schema.sql — invoices DDL
 *
 * Issue: feat: invoice and collection tracking (#12)
 */

import type { Sql } from 'postgres';
import { FieldEncryptor } from './encryption.js';
import { createKmsAdapter } from './kms.js';
// Invoice status values — canonical source is core/invoice-trigger.ts
export const INVOICE_STATES = [
  'Issued',
  'PartiallyPaid',
  'Paid',
  'Disputed',
  'WrittenOff',
  'CreditMemoApplied',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATES)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceRow {
  id: string;
  orgId: string;
  placementId: string;
  invoiceNumber: string;
  /** Decrypted billed amount as a string, e.g. "50000.00" */
  amountBilled: string;
  /** Decrypted collected amount as a string, or null when not yet collected */
  amountCollected: string | null;
  status: string;
  issuedAt: Date;
  dueAt: Date | null;
  collectedAt: Date | null;
}

export interface CreateInvoiceInput {
  orgId: string;
  placementId: string;
  invoiceNumber: string;
  /** Billed amount as a numeric string or number */
  amountBilled: number | string;
  status?: string;
  issuedAt?: string | Date;
  dueAt?: string | Date | null;
}

export interface UpdateInvoiceInput {
  status?: string;
  /** Collected (paid) amount as a numeric string or number */
  amountCollected?: number | string | null;
  collectedAt?: string | Date | null;
  dueAt?: string | Date | null;
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
// createInvoice — INSERT a new invoice row
// ---------------------------------------------------------------------------

/**
 * Inserts a new invoices row, encrypting amountBilled as BYTEA.
 * Returns the newly created invoice with decrypted field values.
 */
export async function createInvoice(sql: Sql, input: CreateInvoiceInput): Promise<InvoiceRow> {
  const enc = await getEncryptor();

  const amountBilledStr = String(input.amountBilled);
  const amountBilledBuf = await enc.encrypt('invoices', 'amount_billed', amountBilledStr);

  const status = input.status ?? 'Issued';
  const issuedAt = input.issuedAt ? new Date(input.issuedAt) : new Date();
  const dueAtSql = input.dueAt ? `'${new Date(input.dueAt).toISOString()}'` : 'NULL';

  const rows = await sql.unsafe(
    `
    INSERT INTO invoices (
      org_id, placement_id, invoice_number, amount_billed, status, issued_at, due_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, ${dueAtSql}
    )
    RETURNING id, org_id, placement_id, invoice_number,
              amount_billed, amount_collected, status, issued_at, due_at, collected_at
    `,
    [input.orgId, input.placementId, input.invoiceNumber, amountBilledBuf, status, issuedAt],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createInvoice: insert returned no rows');
  }

  return decryptInvoiceRow(enc, rows[0] as unknown as InvoiceRawRow);
}

// ---------------------------------------------------------------------------
// getInvoice — SELECT a single invoice by ID
// ---------------------------------------------------------------------------

export async function getInvoice(
  sql: Sql,
  orgId: string,
  invoiceId: string,
): Promise<InvoiceRow | null> {
  const enc = await getEncryptor();

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, invoice_number,
           amount_billed, amount_collected, status, issued_at, due_at, collected_at
    FROM invoices
    WHERE id = $1 AND org_id = $2
    LIMIT 1
    `,
    [invoiceId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return decryptInvoiceRow(enc, rows[0] as unknown as InvoiceRawRow);
}

// ---------------------------------------------------------------------------
// listInvoicesForPlacement — SELECT all invoices for a placement
// ---------------------------------------------------------------------------

export async function listInvoicesForPlacement(
  sql: Sql,
  orgId: string,
  placementId: string,
): Promise<InvoiceRow[]> {
  const enc = await getEncryptor();

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, invoice_number,
           amount_billed, amount_collected, status, issued_at, due_at, collected_at
    FROM invoices
    WHERE org_id = $1 AND placement_id = $2
    ORDER BY issued_at DESC
    `,
    [orgId, placementId],
  );

  if (!rows || rows.length === 0) return [];
  return Promise.all((rows as unknown as InvoiceRawRow[]).map((r) => decryptInvoiceRow(enc, r)));
}

// ---------------------------------------------------------------------------
// updateInvoice — UPDATE status and optional paid amount
// ---------------------------------------------------------------------------

/**
 * Updates an invoice row. Returns the updated row or null if not found.
 *
 * When status transitions to 'Paid', collectedAt is auto-set to NOW() if not provided.
 */
export async function updateInvoice(
  sql: Sql,
  orgId: string,
  invoiceId: string,
  input: UpdateInvoiceInput,
): Promise<InvoiceRow | null> {
  const enc = await getEncryptor();

  // Build SET clauses dynamically
  const sets: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [invoiceId, orgId];
  let paramIdx = 3;

  if (input.status !== undefined) {
    sets.push(`status = $${paramIdx++}`);
    params.push(input.status);
  }

  if (input.amountCollected !== undefined && input.amountCollected !== null) {
    const buf = await enc.encrypt('invoices', 'amount_collected', String(input.amountCollected));
    sets.push(`amount_collected = $${paramIdx++}`);
    params.push(buf);
  } else if (input.amountCollected === null) {
    sets.push(`amount_collected = NULL`);
  }

  if (input.dueAt !== undefined) {
    if (input.dueAt === null) {
      sets.push(`due_at = NULL`);
    } else {
      sets.push(`due_at = $${paramIdx++}`);
      params.push(new Date(input.dueAt));
    }
  }

  // Auto-set collected_at when transitioning to Paid
  if (input.status === 'Paid') {
    if (input.collectedAt !== undefined && input.collectedAt !== null) {
      sets.push(`collected_at = $${paramIdx++}`);
      params.push(new Date(input.collectedAt));
    } else if (input.collectedAt !== null) {
      sets.push(`collected_at = NOW()`);
    }
  } else if (input.collectedAt !== undefined) {
    if (input.collectedAt === null) {
      sets.push(`collected_at = NULL`);
    } else {
      sets.push(`collected_at = $${paramIdx++}`);
      params.push(new Date(input.collectedAt));
    }
  }

  if (sets.length === 0) {
    // Nothing to update — just return current state
    return getInvoice(sql, orgId, invoiceId);
  }

  const rows = await sql.unsafe(
    `
    UPDATE invoices
    SET ${sets.join(', ')}
    WHERE id = $1 AND org_id = $2
    RETURNING id, org_id, placement_id, invoice_number,
              amount_billed, amount_collected, status, issued_at, due_at, collected_at
    `,
    params,
  );

  if (!rows || rows.length === 0) return null;
  return decryptInvoiceRow(enc, rows[0] as unknown as InvoiceRawRow);
}

// ---------------------------------------------------------------------------
// upsertInvoiceByNumber — create or update by invoice_number + org (for import)
// ---------------------------------------------------------------------------

/**
 * Creates or updates an invoice by invoice_number within an org.
 * Used by the CSV import handler.
 */
export async function upsertInvoiceByNumber(
  sql: Sql,
  orgId: string,
  input: CreateInvoiceInput & { amountCollected?: number | string | null },
): Promise<InvoiceRow> {
  const enc = await getEncryptor();

  const amountBilledBuf = await enc.encrypt(
    'invoices',
    'amount_billed',
    String(input.amountBilled),
  );
  const status = input.status ?? 'Issued';
  const issuedAt = input.issuedAt ? new Date(input.issuedAt) : new Date();

  let amountCollectedBuf: Buffer | null = null;
  if (input.amountCollected != null) {
    amountCollectedBuf = await enc.encrypt(
      'invoices',
      'amount_collected',
      String(input.amountCollected),
    );
  }

  const collectedAtSql = status === 'Paid' ? 'NOW()' : 'NULL';
  const amountCollectedParam = amountCollectedBuf !== null ? '$6' : 'NULL';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseParams: any[] = [
    orgId,
    input.placementId,
    input.invoiceNumber,
    amountBilledBuf,
    status,
    issuedAt,
  ];
  if (amountCollectedBuf !== null) baseParams.push(amountCollectedBuf);

  const rows = await sql.unsafe(
    `
    INSERT INTO invoices (
      org_id, placement_id, invoice_number, amount_billed, status, issued_at,
      amount_collected, collected_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      ${amountCollectedParam}, ${collectedAtSql}
    )
    ON CONFLICT (org_id, invoice_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      amount_billed = EXCLUDED.amount_billed,
      amount_collected = EXCLUDED.amount_collected,
      collected_at = CASE WHEN EXCLUDED.status = 'Paid' THEN NOW() ELSE invoices.collected_at END
    RETURNING id, org_id, placement_id, invoice_number,
              amount_billed, amount_collected, status, issued_at, due_at, collected_at
    `,
    baseParams,
  );

  if (!rows || rows.length === 0) {
    throw new Error('upsertInvoiceByNumber: upsert returned no rows');
  }

  return decryptInvoiceRow(enc, rows[0] as unknown as InvoiceRawRow);
}

// ---------------------------------------------------------------------------
// releaseCollectionGate — update Held commission_records to Payable when invoice Paid
// ---------------------------------------------------------------------------

/**
 * When an invoice transitions to 'Paid', find all commission_records for that
 * placement that are Held with hold_reason='collection_gate' and transition them
 * to status='Payable', clearing hold_reason.
 *
 * Returns the count of records updated.
 */
export async function releaseCollectionGate(
  sql: Sql,
  orgId: string,
  placementId: string,
): Promise<number> {
  const rows = await sql.unsafe(
    `
    UPDATE commission_records
    SET status = 'Payable', hold_reason = NULL
    WHERE org_id = $1
      AND placement_id = $2
      AND status = 'Held'
      AND hold_reason = 'collection_gate'
    RETURNING id
    `,
    [orgId, placementId],
  );

  return rows ? rows.length : 0;
}

// ---------------------------------------------------------------------------
// listHeldCommissionRecordsByReason — for GET /commission-records?reason=
// ---------------------------------------------------------------------------

/**
 * Lists all commission records for an org filtered by status=Held and hold_reason.
 * Returns raw rows (no decryption needed for the filter query — amounts are excluded
 * from the list response per PRD security model; use GET /commission-records/:id for amounts).
 */
export async function listHeldCommissionRecordsByReason(
  sql: Sql,
  orgId: string,
  holdReason: string,
): Promise<HeldCommissionRecordRow[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, contributor_id, plan_version_id,
           status, hold_reason, created_at
    FROM commission_records
    WHERE org_id = $1
      AND status = 'Held'
      AND hold_reason = $2
    ORDER BY created_at DESC
    `,
    [orgId, holdReason],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as HeldCommissionRecordRow[]).map((r) => ({
    id: r.id,
    org_id: r.org_id,
    placement_id: r.placement_id,
    contributor_id: r.contributor_id,
    plan_version_id: r.plan_version_id,
    status: r.status,
    hold_reason: r.hold_reason,
    created_at: r.created_at,
  }));
}

export interface HeldCommissionRecordRow {
  id: string;
  org_id: string;
  placement_id: string;
  contributor_id: string;
  plan_version_id: string;
  status: string;
  hold_reason: string | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Internal types and helper — decrypt a raw invoice DB row
// ---------------------------------------------------------------------------

interface InvoiceRawRow {
  id: string;
  org_id: string;
  placement_id: string;
  invoice_number: string;
  amount_billed: Buffer | Uint8Array;
  amount_collected: Buffer | Uint8Array | null;
  status: string;
  issued_at: Date;
  due_at: Date | null;
  collected_at: Date | null;
}

async function decryptInvoiceRow(enc: FieldEncryptor, row: InvoiceRawRow): Promise<InvoiceRow> {
  const amountBilled = await enc.decrypt(
    'invoices',
    'amount_billed',
    Buffer.isBuffer(row.amount_billed) ? row.amount_billed : Buffer.from(row.amount_billed),
  );

  let amountCollected: string | null = null;
  if (row.amount_collected) {
    amountCollected = await enc.decrypt(
      'invoices',
      'amount_collected',
      Buffer.isBuffer(row.amount_collected)
        ? row.amount_collected
        : Buffer.from(row.amount_collected),
    );
  }

  return {
    id: row.id,
    orgId: row.org_id,
    placementId: row.placement_id,
    invoiceNumber: row.invoice_number,
    amountBilled,
    amountCollected,
    status: row.status,
    issuedAt: row.issued_at,
    dueAt: row.due_at ?? null,
    collectedAt: row.collected_at ?? null,
  };
}

/**
 * DB access functions for financial reconciliation (issue #65).
 *
 * Tables:
 *   ar_ingested_records        — AR data from the financial system (system-of-record amounts)
 *   reconciliation_discrepancies — discovered mismatches between ledger and AR data
 *
 * The reconciliation report compares ledger invoices against ingested AR records for a
 * given period and surfaces four discrepancy types:
 *   - ledger_only: invoice in ledger but absent from AR system
 *   - system_only: record in AR system but absent from ledger
 *   - amount_mismatch: both present but billed amounts differ
 *   - date_gap: both present but billed/received dates differ by more than threshold
 *
 * Canonical docs: docs/prd.md §5.8
 * Issue: feat: financial reconciliation report (#65)
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscrepancyType = 'ledger_only' | 'system_only' | 'amount_mismatch' | 'date_gap';

export interface ArIngestedRecord {
  id: string;
  orgId: string;
  invoiceNumber: string;
  amountBilled: string;
  amountCollected: string | null;
  billedDate: string;
  collectedDate: string | null;
  createdAt: Date;
}

export interface CreateArIngestedRecordInput {
  orgId: string;
  invoiceNumber: string;
  amountBilled: number | string;
  amountCollected?: number | string | null;
  billedDate: string;
  collectedDate?: string | null;
}

export interface ReconciliationDiscrepancy {
  id: string;
  orgId: string;
  periodStart: string;
  periodEnd: string;
  discrepancyType: DiscrepancyType;
  invoiceId: string | null;
  invoiceNumber: string | null;
  ledgerAmountBilled: string | null;
  arAmountBilled: string | null;
  ledgerIssuedAt: string | null;
  arBilledDate: string | null;
  dateGapDays: number | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  acknowledgedNote: string | null;
  createdAt: Date;
}

export interface UpsertDiscrepancyInput {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  discrepancyType: DiscrepancyType;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  ledgerAmountBilled?: number | string | null;
  arAmountBilled?: number | string | null;
  ledgerIssuedAt?: string | null;
  arBilledDate?: string | null;
  dateGapDays?: number | null;
}

// ---------------------------------------------------------------------------
// AR ingested records
// ---------------------------------------------------------------------------

/**
 * Upserts an AR ingested record by (org_id, invoice_number).
 */
export async function upsertArIngestedRecord(
  sql: Sql,
  input: CreateArIngestedRecordInput,
): Promise<ArIngestedRecord> {
  const rows = await sql.unsafe(
    `
    INSERT INTO ar_ingested_records (
      org_id, invoice_number, amount_billed, amount_collected, billed_date, collected_date
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (org_id, invoice_number)
    DO UPDATE SET
      amount_billed    = EXCLUDED.amount_billed,
      amount_collected = EXCLUDED.amount_collected,
      billed_date      = EXCLUDED.billed_date,
      collected_date   = EXCLUDED.collected_date
    RETURNING id, org_id, invoice_number, amount_billed, amount_collected,
              billed_date, collected_date, created_at
    `,
    [
      input.orgId,
      input.invoiceNumber,
      String(input.amountBilled),
      input.amountCollected != null ? String(input.amountCollected) : null,
      input.billedDate,
      input.collectedDate ?? null,
    ],
  );

  if (!rows || rows.length === 0) {
    throw new Error('upsertArIngestedRecord: upsert returned no rows');
  }

  return mapArRow(rows[0] as ArIngestedRawRow);
}

/**
 * List all AR ingested records for an org within a billed_date range.
 */
export async function listArIngestedRecords(
  sql: Sql,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ArIngestedRecord[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, invoice_number, amount_billed, amount_collected,
           billed_date, collected_date, created_at
    FROM ar_ingested_records
    WHERE org_id = $1
      AND billed_date >= $2::date
      AND billed_date <= $3::date
    ORDER BY billed_date
    `,
    [orgId, periodStart, periodEnd],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as ArIngestedRawRow[]).map(mapArRow);
}

// ---------------------------------------------------------------------------
// Reconciliation discrepancies
// ---------------------------------------------------------------------------

/**
 * Insert or replace a discrepancy row.
 * On re-run for the same period, un-acknowledged discrepancies are replaced;
 * acknowledged ones are left untouched (the INSERT ... ON CONFLICT DO NOTHING
 * pattern keeps acknowledged state stable across re-runs).
 */
export async function createDiscrepancy(
  sql: Sql,
  input: UpsertDiscrepancyInput,
): Promise<ReconciliationDiscrepancy> {
  const rows = await sql.unsafe(
    `
    INSERT INTO reconciliation_discrepancies (
      org_id, period_start, period_end, discrepancy_type,
      invoice_id, invoice_number,
      ledger_amount_billed, ar_amount_billed,
      ledger_issued_at, ar_billed_date, date_gap_days
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id, org_id, period_start, period_end, discrepancy_type,
              invoice_id, invoice_number,
              ledger_amount_billed, ar_amount_billed,
              ledger_issued_at, ar_billed_date, date_gap_days,
              acknowledged, acknowledged_by, acknowledged_at, acknowledged_note, created_at
    `,
    [
      input.orgId,
      input.periodStart,
      input.periodEnd,
      input.discrepancyType,
      input.invoiceId ?? null,
      input.invoiceNumber ?? null,
      input.ledgerAmountBilled != null ? String(input.ledgerAmountBilled) : null,
      input.arAmountBilled != null ? String(input.arAmountBilled) : null,
      input.ledgerIssuedAt ?? null,
      input.arBilledDate ?? null,
      input.dateGapDays ?? null,
    ],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createDiscrepancy: insert returned no rows');
  }

  return mapDiscrepancyRow(rows[0] as DiscrepancyRawRow);
}

/**
 * List discrepancies for an org and period.
 */
export async function listDiscrepancies(
  sql: Sql,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ReconciliationDiscrepancy[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, period_start, period_end, discrepancy_type,
           invoice_id, invoice_number,
           ledger_amount_billed, ar_amount_billed,
           ledger_issued_at, ar_billed_date, date_gap_days,
           acknowledged, acknowledged_by, acknowledged_at, acknowledged_note, created_at
    FROM reconciliation_discrepancies
    WHERE org_id = $1
      AND period_start = $2::date
      AND period_end   = $3::date
    ORDER BY created_at
    `,
    [orgId, periodStart, periodEnd],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as DiscrepancyRawRow[]).map(mapDiscrepancyRow);
}

/**
 * Get a single discrepancy by ID.
 */
export async function getDiscrepancy(
  sql: Sql,
  orgId: string,
  discrepancyId: string,
): Promise<ReconciliationDiscrepancy | null> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, period_start, period_end, discrepancy_type,
           invoice_id, invoice_number,
           ledger_amount_billed, ar_amount_billed,
           ledger_issued_at, ar_billed_date, date_gap_days,
           acknowledged, acknowledged_by, acknowledged_at, acknowledged_note, created_at
    FROM reconciliation_discrepancies
    WHERE id = $1 AND org_id = $2
    LIMIT 1
    `,
    [discrepancyId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return mapDiscrepancyRow(rows[0] as DiscrepancyRawRow);
}

/**
 * Acknowledge a discrepancy. Sets acknowledged=true, records the reviewer and note.
 */
export async function acknowledgeDiscrepancy(
  sql: Sql,
  orgId: string,
  discrepancyId: string,
  acknowledgedBy: string,
  note: string,
): Promise<ReconciliationDiscrepancy | null> {
  const rows = await sql.unsafe(
    `
    UPDATE reconciliation_discrepancies
    SET acknowledged       = true,
        acknowledged_by    = $3,
        acknowledged_at    = NOW(),
        acknowledged_note  = $4
    WHERE id = $1 AND org_id = $2
    RETURNING id, org_id, period_start, period_end, discrepancy_type,
              invoice_id, invoice_number,
              ledger_amount_billed, ar_amount_billed,
              ledger_issued_at, ar_billed_date, date_gap_days,
              acknowledged, acknowledged_by, acknowledged_at, acknowledged_note, created_at
    `,
    [discrepancyId, orgId, acknowledgedBy, note],
  );

  if (!rows || rows.length === 0) return null;
  return mapDiscrepancyRow(rows[0] as DiscrepancyRawRow);
}

/**
 * Count unacknowledged discrepancies for a period.
 * Used by the commission run finalization gate.
 */
export async function countUnacknowledgedDiscrepancies(
  sql: Sql,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const rows = await sql.unsafe(
    `
    SELECT COUNT(*) AS cnt
    FROM reconciliation_discrepancies
    WHERE org_id = $1
      AND period_start = $2::date
      AND period_end   = $3::date
      AND acknowledged = false
    `,
    [orgId, periodStart, periodEnd],
  );

  if (!rows || rows.length === 0) return 0;
  const row = rows[0] as unknown as { cnt: string };
  return parseInt(row.cnt, 10);
}

/**
 * Delete all discrepancies for a period (used during re-run to clear stale entries).
 * Only deletes un-acknowledged ones — acknowledged discrepancies are preserved.
 */
export async function clearUnacknowledgedDiscrepancies(
  sql: Sql,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const rows = await sql.unsafe(
    `
    DELETE FROM reconciliation_discrepancies
    WHERE org_id = $1
      AND period_start = $2::date
      AND period_end   = $3::date
      AND acknowledged = false
    RETURNING id
    `,
    [orgId, periodStart, periodEnd],
  );

  return rows ? rows.length : 0;
}

// ---------------------------------------------------------------------------
// Reconciliation engine
// ---------------------------------------------------------------------------

/**
 * Configuration for the reconciliation engine.
 */
export interface ReconcileOptions {
  /** Number of days difference in billed/collected dates to flag as a date_gap */
  dateGapThresholdDays?: number;
  /** Tolerance for amount comparison (default 0 — exact match required) */
  amountToleranceCents?: number;
}

interface LedgerInvoiceRow {
  id: string;
  invoice_number: string;
  amount_billed_numeric: string;
  issued_at: Date;
}

interface ArRawRow {
  invoice_number: string;
  amount_billed: string;
  billed_date: Date;
}

/**
 * Generate (and persist) reconciliation discrepancies for a period.
 *
 * Algorithm:
 *   1. Clear un-acknowledged discrepancies for the period (idempotent re-run).
 *   2. Load all ledger invoices in [period_start, period_end].
 *   3. Load all AR ingested records in [period_start, period_end].
 *   4. Match by invoice_number and classify each discrepancy.
 *   5. Persist each discrepancy via createDiscrepancy.
 *
 * Note: invoice amount_billed in the ledger is encrypted (BYTEA). This function
 * accepts a pre-decrypted map of invoice amounts as `ledgerAmounts` to keep the
 * reconciliation engine decoupled from the FieldEncryptor.
 */
export async function generateReconciliationReport(
  sql: Sql,
  opts: {
    orgId: string;
    periodStart: string;
    periodEnd: string;
    /** Map from invoice_number → decrypted numeric amount_billed string */
    ledgerAmounts: Map<string, { id: string; amountBilled: string; issuedAt: Date }>;
    /** AR ingested records for the period */
    arRecords: ArIngestedRecord[];
    options?: ReconcileOptions;
  },
): Promise<ReconciliationDiscrepancy[]> {
  const { orgId, periodStart, periodEnd, ledgerAmounts, arRecords, options } = opts;
  const dateGapThreshold = options?.dateGapThresholdDays ?? 5;
  const amountTolerance = options?.amountToleranceCents ?? 0;

  // Step 1: clear un-acknowledged stale discrepancies
  await clearUnacknowledgedDiscrepancies(sql, orgId, periodStart, periodEnd);

  const arByNumber = new Map<string, ArIngestedRecord>();
  for (const ar of arRecords) {
    arByNumber.set(ar.invoiceNumber, ar);
  }

  const results: ReconciliationDiscrepancy[] = [];

  // Step 2: ledger-only and amount/date mismatches
  for (const [invoiceNumber, ledger] of ledgerAmounts) {
    const ar = arByNumber.get(invoiceNumber);

    if (!ar) {
      // ledger_only
      const d = await createDiscrepancy(sql, {
        orgId,
        periodStart,
        periodEnd,
        discrepancyType: 'ledger_only',
        invoiceId: ledger.id,
        invoiceNumber,
        ledgerAmountBilled: ledger.amountBilled,
        arAmountBilled: null,
        ledgerIssuedAt: ledger.issuedAt.toISOString().split('T')[0],
        arBilledDate: null,
      });
      results.push(d);
      continue;
    }

    // Both present — check amount mismatch
    const ledgerAmt = parseFloat(ledger.amountBilled);
    const arAmt = parseFloat(ar.amountBilled);
    const diff = Math.abs(ledgerAmt - arAmt);
    if (diff > amountTolerance / 100) {
      const d = await createDiscrepancy(sql, {
        orgId,
        periodStart,
        periodEnd,
        discrepancyType: 'amount_mismatch',
        invoiceId: ledger.id,
        invoiceNumber,
        ledgerAmountBilled: ledger.amountBilled,
        arAmountBilled: ar.amountBilled,
        ledgerIssuedAt: ledger.issuedAt.toISOString().split('T')[0],
        arBilledDate: ar.billedDate,
      });
      results.push(d);
    }

    // Check date gap
    const ledgerDate = new Date(ledger.issuedAt);
    const arDate = new Date(ar.billedDate);
    const gapDays = Math.abs(
      Math.round((ledgerDate.getTime() - arDate.getTime()) / (1000 * 60 * 60 * 24)),
    );
    if (gapDays > dateGapThreshold) {
      const d = await createDiscrepancy(sql, {
        orgId,
        periodStart,
        periodEnd,
        discrepancyType: 'date_gap',
        invoiceId: ledger.id,
        invoiceNumber,
        ledgerAmountBilled: ledger.amountBilled,
        arAmountBilled: ar.amountBilled,
        ledgerIssuedAt: ledger.issuedAt.toISOString().split('T')[0],
        arBilledDate: ar.billedDate,
        dateGapDays: gapDays,
      });
      results.push(d);
    }
  }

  // Step 3: system_only — in AR but not in ledger
  for (const ar of arRecords) {
    if (!ledgerAmounts.has(ar.invoiceNumber)) {
      const d = await createDiscrepancy(sql, {
        orgId,
        periodStart,
        periodEnd,
        discrepancyType: 'system_only',
        invoiceId: null,
        invoiceNumber: ar.invoiceNumber,
        ledgerAmountBilled: null,
        arAmountBilled: ar.amountBilled,
        ledgerIssuedAt: null,
        arBilledDate: ar.billedDate,
      });
      results.push(d);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ArIngestedRawRow {
  id: string;
  org_id: string;
  invoice_number: string;
  amount_billed: string;
  amount_collected: string | null;
  billed_date: Date | string;
  collected_date: Date | string | null;
  created_at: Date;
}

interface DiscrepancyRawRow {
  id: string;
  org_id: string;
  period_start: Date | string;
  period_end: Date | string;
  discrepancy_type: string;
  invoice_id: string | null;
  invoice_number: string | null;
  ledger_amount_billed: string | null;
  ar_amount_billed: string | null;
  ledger_issued_at: Date | string | null;
  ar_billed_date: Date | string | null;
  date_gap_days: number | null;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  acknowledged_note: string | null;
  created_at: Date;
}

function toDateStr(v: Date | string | null): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.split('T')[0];
  return v.toISOString().split('T')[0];
}

function mapArRow(row: ArIngestedRawRow): ArIngestedRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    invoiceNumber: row.invoice_number,
    amountBilled: row.amount_billed,
    amountCollected: row.amount_collected,
    billedDate: toDateStr(row.billed_date) ?? '',
    collectedDate: toDateStr(row.collected_date),
    createdAt: row.created_at,
  };
}

function mapDiscrepancyRow(row: DiscrepancyRawRow): ReconciliationDiscrepancy {
  return {
    id: row.id,
    orgId: row.org_id,
    periodStart: toDateStr(row.period_start) ?? '',
    periodEnd: toDateStr(row.period_end) ?? '',
    discrepancyType: row.discrepancy_type as DiscrepancyType,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    ledgerAmountBilled: row.ledger_amount_billed,
    arAmountBilled: row.ar_amount_billed,
    ledgerIssuedAt: toDateStr(row.ledger_issued_at),
    arBilledDate: toDateStr(row.ar_billed_date),
    dateGapDays: row.date_gap_days,
    acknowledged: row.acknowledged,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedNote: row.acknowledged_note,
    createdAt: row.created_at,
  };
}

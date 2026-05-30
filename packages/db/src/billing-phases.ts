/**
 * DB access functions for the billing_phases and phase_contributors tables.
 *
 * Retained search placements carry named billing phases (retainer, delivery).
 * Each phase has its own invoice linkage, projected/billed/received amounts,
 * and per-phase contributor-credit assignments.
 *
 * Encrypted columns (BYTEA via FieldEncryptor):
 *   billing_phases.projected_amount
 *   billing_phases.billed_amount
 *   billing_phases.received_amount
 *
 * Collection gating is phase-scoped: a paid retainer invoice releases only
 * retainer-phase commission; delivery-phase commission remains Held until the
 * delivery invoice is paid.
 *
 * Canonical docs:
 *   - docs/prd.md §5.1, §5.5 — Retained Search Billing Phases
 *   - docs/architecture.md §4 — property-graph registry, relational journal
 *   - packages/db/schema.sql — billing_phases, phase_contributors, commission_journal DDL
 *
 * Issue: feat: retained search billing phases (#63)
 */

import type { Sql } from 'postgres';
import { FieldEncryptor } from './encryption.js';
import { createKmsAdapter } from './kms.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BillingPhaseName = 'retainer' | 'delivery';

export const BILLING_PHASE_NAMES: BillingPhaseName[] = ['retainer', 'delivery'];

export interface BillingPhase {
  id: string;
  orgId: string;
  placementId: string;
  phaseName: BillingPhaseName;
  /** UUID of the linked invoice, or null if not yet invoiced. */
  invoiceId: string | null;
  /** Decrypted projected amount string, e.g. "50000.00" */
  projectedAmount: string;
  /** Decrypted billed amount string, or null */
  billedAmount: string | null;
  /** Decrypted received amount string, or null */
  receivedAmount: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBillingPhaseInput {
  id?: string;
  orgId: string;
  placementId: string;
  phaseName: BillingPhaseName;
  invoiceId?: string | null;
  /** Projected amount as a numeric string or number, e.g. "50000" */
  projectedAmount: number | string;
  billedAmount?: number | string | null;
  receivedAmount?: number | string | null;
}

export interface UpdateBillingPhaseInput {
  invoiceId?: string | null;
  projectedAmount?: number | string;
  billedAmount?: number | string | null;
  receivedAmount?: number | string | null;
}

export interface PhaseContributor {
  id: string;
  orgId: string;
  billingPhaseId: string;
  contributorId: string;
  splitPct: number;
  createdAt: Date;
}

export interface CreatePhaseContributorInput {
  orgId: string;
  billingPhaseId: string;
  contributorId: string;
  /** Split percentage as a decimal fraction (0 < splitPct ≤ 1) */
  splitPct: number;
}

export interface CommissionJournalEntry {
  id: string;
  orgId: string;
  commissionRecordId: string;
  billingPhaseId: string | null;
  fromStatus: string;
  toStatus: string;
  triggerInvoiceId: string | null;
  actorId: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface CreateCommissionJournalEntryInput {
  orgId: string;
  commissionRecordId: string;
  billingPhaseId?: string | null;
  fromStatus: string;
  toStatus: string;
  triggerInvoiceId?: string | null;
  actorId?: string | null;
  reason?: string | null;
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
// createBillingPhase — INSERT a new billing phase row
// ---------------------------------------------------------------------------

/**
 * Inserts a new billing_phases row, encrypting monetary columns as BYTEA.
 * Returns the newly created phase with decrypted field values.
 *
 * At most two phases may exist per placement (one per phase_name).
 * The UNIQUE(placement_id, phase_name) constraint enforces this at the DB level.
 */
export async function createBillingPhase(
  sql: Sql,
  input: CreateBillingPhaseInput,
): Promise<BillingPhase> {
  const enc = await getEncryptor();

  const projectedBuf = await enc.encrypt(
    'billing_phases',
    'projected_amount',
    String(input.projectedAmount),
  );

  let billedBuf: Buffer | null = null;
  if (input.billedAmount != null) {
    billedBuf = await enc.encrypt('billing_phases', 'billed_amount', String(input.billedAmount));
  }

  let receivedBuf: Buffer | null = null;
  if (input.receivedAmount != null) {
    receivedBuf = await enc.encrypt(
      'billing_phases',
      'received_amount',
      String(input.receivedAmount),
    );
  }

  const idClause = input.id ? `'${input.id}',` : '';
  const idColClause = input.id ? 'id,' : '';
  const invoiceClause = input.invoiceId ? `'${input.invoiceId}'` : 'NULL';
  const billedParam = billedBuf ? '$3' : 'NULL';
  const receivedParam = receivedBuf ? `$${billedBuf ? 4 : 3}` : 'NULL';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseParams: any[] = [projectedBuf];
  if (billedBuf) baseParams.push(billedBuf);
  if (receivedBuf) baseParams.push(receivedBuf);

  const rows = await sql.unsafe(
    `
    INSERT INTO billing_phases (
      ${idColClause}
      org_id, placement_id, phase_name, invoice_id,
      projected_amount, billed_amount, received_amount
    ) VALUES (
      ${idClause}
      '${input.orgId}', '${input.placementId}', '${input.phaseName}', ${invoiceClause},
      $1, ${billedParam}, ${receivedParam}
    )
    RETURNING id, org_id, placement_id, phase_name, invoice_id,
              projected_amount, billed_amount, received_amount, created_at, updated_at
    `,
    baseParams,
  );

  if (!rows || rows.length === 0) {
    throw new Error('createBillingPhase: insert returned no rows');
  }

  return decryptPhaseRow(enc, rows[0] as unknown as BillingPhaseRawRow);
}

// ---------------------------------------------------------------------------
// listBillingPhases — SELECT all phases for a placement
// ---------------------------------------------------------------------------

/**
 * Lists all billing phases for a given placement, ordered by phase_name.
 * Returns at most two rows (retainer, delivery).
 */
export async function listBillingPhases(
  sql: Sql,
  orgId: string,
  placementId: string,
): Promise<BillingPhase[]> {
  const enc = await getEncryptor();

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, phase_name, invoice_id,
           projected_amount, billed_amount, received_amount, created_at, updated_at
    FROM billing_phases
    WHERE org_id = $1 AND placement_id = $2
    ORDER BY phase_name
    `,
    [orgId, placementId],
  );

  if (!rows || rows.length === 0) return [];
  return Promise.all((rows as unknown as BillingPhaseRawRow[]).map((r) => decryptPhaseRow(enc, r)));
}

// ---------------------------------------------------------------------------
// getBillingPhase — SELECT a single phase by ID
// ---------------------------------------------------------------------------

export async function getBillingPhase(
  sql: Sql,
  orgId: string,
  phaseId: string,
): Promise<BillingPhase | null> {
  const enc = await getEncryptor();

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, phase_name, invoice_id,
           projected_amount, billed_amount, received_amount, created_at, updated_at
    FROM billing_phases
    WHERE id = $1 AND org_id = $2
    LIMIT 1
    `,
    [phaseId, orgId],
  );

  if (!rows || rows.length === 0) return null;
  return decryptPhaseRow(enc, rows[0] as unknown as BillingPhaseRawRow);
}

// ---------------------------------------------------------------------------
// getBillingPhaseByName — SELECT a phase by placement + phase_name
// ---------------------------------------------------------------------------

export async function getBillingPhaseByName(
  sql: Sql,
  orgId: string,
  placementId: string,
  phaseName: BillingPhaseName,
): Promise<BillingPhase | null> {
  const enc = await getEncryptor();

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, phase_name, invoice_id,
           projected_amount, billed_amount, received_amount, created_at, updated_at
    FROM billing_phases
    WHERE org_id = $1 AND placement_id = $2 AND phase_name = $3
    LIMIT 1
    `,
    [orgId, placementId, phaseName],
  );

  if (!rows || rows.length === 0) return null;
  return decryptPhaseRow(enc, rows[0] as unknown as BillingPhaseRawRow);
}

// ---------------------------------------------------------------------------
// updateBillingPhase — UPDATE a phase row
// ---------------------------------------------------------------------------

export async function updateBillingPhase(
  sql: Sql,
  orgId: string,
  phaseId: string,
  input: UpdateBillingPhaseInput,
): Promise<BillingPhase | null> {
  const enc = await getEncryptor();
  const sets: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if ('invoiceId' in input) {
    sets.push(input.invoiceId != null ? `invoice_id = '${input.invoiceId}'` : `invoice_id = NULL`);
  }

  if (input.projectedAmount !== undefined) {
    const buf = await enc.encrypt(
      'billing_phases',
      'projected_amount',
      String(input.projectedAmount),
    );
    sets.push(`projected_amount = $${paramIdx++}`);
    params.push(buf);
  }

  if ('billedAmount' in input) {
    if (input.billedAmount != null) {
      const buf = await enc.encrypt('billing_phases', 'billed_amount', String(input.billedAmount));
      sets.push(`billed_amount = $${paramIdx++}`);
      params.push(buf);
    } else {
      sets.push(`billed_amount = NULL`);
    }
  }

  if ('receivedAmount' in input) {
    if (input.receivedAmount != null) {
      const buf = await enc.encrypt(
        'billing_phases',
        'received_amount',
        String(input.receivedAmount),
      );
      sets.push(`received_amount = $${paramIdx++}`);
      params.push(buf);
    } else {
      sets.push(`received_amount = NULL`);
    }
  }

  if (sets.length === 0) {
    return getBillingPhase(sql, orgId, phaseId);
  }

  sets.push(`updated_at = NOW()`);
  params.push(phaseId, orgId);

  const rows = await sql.unsafe(
    `
    UPDATE billing_phases
    SET ${sets.join(', ')}
    WHERE id = $${paramIdx++} AND org_id = $${paramIdx}
    RETURNING id, org_id, placement_id, phase_name, invoice_id,
              projected_amount, billed_amount, received_amount, created_at, updated_at
    `,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params as any[],
  );

  if (!rows || rows.length === 0) return null;
  return decryptPhaseRow(enc, rows[0] as unknown as BillingPhaseRawRow);
}

// ---------------------------------------------------------------------------
// createPhaseContributor — assign a contributor to a billing phase
// ---------------------------------------------------------------------------

/**
 * Assigns a contributor to a specific billing phase with a split_pct.
 * A contributor may be assigned to one or both phases independently.
 * The UNIQUE(billing_phase_id, contributor_id) constraint prevents duplicates.
 */
export async function createPhaseContributor(
  sql: Sql,
  input: CreatePhaseContributorInput,
): Promise<PhaseContributor> {
  const rows = await sql.unsafe(
    `
    INSERT INTO phase_contributors (
      org_id, billing_phase_id, contributor_id, split_pct
    ) VALUES ($1, $2, $3, $4)
    RETURNING id, org_id, billing_phase_id, contributor_id, split_pct, created_at
    `,
    [input.orgId, input.billingPhaseId, input.contributorId, input.splitPct],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createPhaseContributor: insert returned no rows');
  }

  return mapPhaseContributorRow(rows[0] as unknown as PhaseContributorRawRow);
}

// ---------------------------------------------------------------------------
// listPhaseContributors — SELECT all phase_contributors for a billing phase
// ---------------------------------------------------------------------------

export async function listPhaseContributors(
  sql: Sql,
  orgId: string,
  billingPhaseId: string,
): Promise<PhaseContributor[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, billing_phase_id, contributor_id, split_pct, created_at
    FROM phase_contributors
    WHERE org_id = $1 AND billing_phase_id = $2
    ORDER BY created_at ASC
    `,
    [orgId, billingPhaseId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as PhaseContributorRawRow[]).map(mapPhaseContributorRow);
}

// ---------------------------------------------------------------------------
// releasePhaseCollectionGate — release Held commission_records for a phase
// ---------------------------------------------------------------------------

/**
 * When a billing phase's linked invoice is marked Paid, release all Held
 * commission_records for that phase (hold_reason='held_pending_phase_invoice')
 * by setting status='Payable'.
 *
 * Also writes a commission_journal entry for each released record.
 *
 * Returns the count of records released.
 */
export async function releasePhaseCollectionGate(
  sql: Sql,
  orgId: string,
  billingPhaseId: string,
  triggerInvoiceId: string,
): Promise<number> {
  // Find all Held records for this phase
  const heldRows = await sql.unsafe(
    `
    SELECT id
    FROM commission_records
    WHERE org_id = $1
      AND billing_phase_id = $2
      AND status = 'Held'
      AND hold_reason = 'held_pending_phase_invoice'
    `,
    [orgId, billingPhaseId],
  );

  if (!heldRows || heldRows.length === 0) return 0;

  const recordIds = (heldRows as unknown as { id: string }[]).map((r) => r.id);
  const placeholders = recordIds.map((_, i) => `$${i + 3}`).join(', ');

  // Update to Payable
  await sql.unsafe(
    `
    UPDATE commission_records
    SET status = 'Payable', hold_reason = NULL
    WHERE org_id = $1
      AND billing_phase_id = $2
      AND id IN (${placeholders})
    `,
    [orgId, billingPhaseId, ...recordIds],
  );

  // Write journal entries for each released record
  for (const recordId of recordIds) {
    await sql.unsafe(
      `
      INSERT INTO commission_journal (
        org_id, commission_record_id, billing_phase_id,
        from_status, to_status, trigger_invoice_id, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        orgId,
        recordId,
        billingPhaseId,
        'Held',
        'Payable',
        triggerInvoiceId,
        'Phase invoice marked Paid — collection gate released',
      ],
    );
  }

  return recordIds.length;
}

// ---------------------------------------------------------------------------
// listCommissionJournalEntries — SELECT journal entries for a phase or record
// ---------------------------------------------------------------------------

export async function listCommissionJournalEntries(
  sql: Sql,
  orgId: string,
  opts: { billingPhaseId?: string; commissionRecordId?: string },
): Promise<CommissionJournalEntry[]> {
  const conditions = [`org_id = $1`];
  const params: unknown[] = [orgId];
  let paramIdx = 2;

  if (opts.billingPhaseId) {
    conditions.push(`billing_phase_id = $${paramIdx++}`);
    params.push(opts.billingPhaseId);
  }
  if (opts.commissionRecordId) {
    conditions.push(`commission_record_id = $${paramIdx++}`);
    params.push(opts.commissionRecordId);
  }

  const rows = await sql.unsafe(
    `
    SELECT id, org_id, commission_record_id, billing_phase_id,
           from_status, to_status, trigger_invoice_id, actor_id, reason, created_at
    FROM commission_journal
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at ASC
    `,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params as any[],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as CommissionJournalRawRow[]).map(mapJournalRow);
}

// ---------------------------------------------------------------------------
// createCommissionJournalEntry — INSERT a journal entry directly (for non-phase transitions)
// ---------------------------------------------------------------------------

export async function createCommissionJournalEntry(
  sql: Sql,
  input: CreateCommissionJournalEntryInput,
): Promise<CommissionJournalEntry> {
  const rows = await sql.unsafe(
    `
    INSERT INTO commission_journal (
      org_id, commission_record_id, billing_phase_id,
      from_status, to_status, trigger_invoice_id, actor_id, reason
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, org_id, commission_record_id, billing_phase_id,
              from_status, to_status, trigger_invoice_id, actor_id, reason, created_at
    `,
    [
      input.orgId,
      input.commissionRecordId,
      input.billingPhaseId ?? null,
      input.fromStatus,
      input.toStatus,
      input.triggerInvoiceId ?? null,
      input.actorId ?? null,
      input.reason ?? null,
    ],
  );

  if (!rows || rows.length === 0) {
    throw new Error('createCommissionJournalEntry: insert returned no rows');
  }

  return mapJournalRow(rows[0] as unknown as CommissionJournalRawRow);
}

// ---------------------------------------------------------------------------
// Internal types and helpers
// ---------------------------------------------------------------------------

interface BillingPhaseRawRow {
  id: string;
  org_id: string;
  placement_id: string;
  phase_name: string;
  invoice_id: string | null;
  projected_amount: Buffer | Uint8Array;
  billed_amount: Buffer | Uint8Array | null;
  received_amount: Buffer | Uint8Array | null;
  created_at: Date;
  updated_at: Date;
}

async function decryptPhaseRow(
  enc: FieldEncryptor,
  row: BillingPhaseRawRow,
): Promise<BillingPhase> {
  const projectedAmount = await enc.decrypt(
    'billing_phases',
    'projected_amount',
    Buffer.isBuffer(row.projected_amount)
      ? row.projected_amount
      : Buffer.from(row.projected_amount),
  );

  let billedAmount: string | null = null;
  if (row.billed_amount) {
    billedAmount = await enc.decrypt(
      'billing_phases',
      'billed_amount',
      Buffer.isBuffer(row.billed_amount) ? row.billed_amount : Buffer.from(row.billed_amount),
    );
  }

  let receivedAmount: string | null = null;
  if (row.received_amount) {
    receivedAmount = await enc.decrypt(
      'billing_phases',
      'received_amount',
      Buffer.isBuffer(row.received_amount) ? row.received_amount : Buffer.from(row.received_amount),
    );
  }

  return {
    id: row.id,
    orgId: row.org_id,
    placementId: row.placement_id,
    phaseName: row.phase_name as BillingPhaseName,
    invoiceId: row.invoice_id ?? null,
    projectedAmount,
    billedAmount,
    receivedAmount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface PhaseContributorRawRow {
  id: string;
  org_id: string;
  billing_phase_id: string;
  contributor_id: string;
  split_pct: string | number;
  created_at: Date;
}

function mapPhaseContributorRow(row: PhaseContributorRawRow): PhaseContributor {
  return {
    id: row.id,
    orgId: row.org_id,
    billingPhaseId: row.billing_phase_id,
    contributorId: row.contributor_id,
    splitPct: Number(row.split_pct),
    createdAt: row.created_at,
  };
}

interface CommissionJournalRawRow {
  id: string;
  org_id: string;
  commission_record_id: string;
  billing_phase_id: string | null;
  from_status: string;
  to_status: string;
  trigger_invoice_id: string | null;
  actor_id: string | null;
  reason: string | null;
  created_at: Date;
}

function mapJournalRow(row: CommissionJournalRawRow): CommissionJournalEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    commissionRecordId: row.commission_record_id,
    billingPhaseId: row.billing_phase_id ?? null,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    triggerInvoiceId: row.trigger_invoice_id ?? null,
    actorId: row.actor_id ?? null,
    reason: row.reason ?? null,
    createdAt: row.created_at,
  };
}

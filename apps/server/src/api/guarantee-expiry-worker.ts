/**
 * Worker task handler for guarantee_expired_recalc tasks.
 *
 * Called when the guarantee expiry cron enqueues a task for a placement whose
 * guarantee window has passed with no clawback event. The handler:
 *
 *   1. Loads the guarantee_periods row — returns early if already non-Active.
 *   2. Atomically in a single Postgres transaction:
 *      a. Transitions guarantee_periods.status → 'ExpiredClean'
 *      b. Transitions placement.status → 'GuaranteeExpired' (if currently GuaranteeActive)
 *      c. Releases all held commission_records (hold_reason='guarantee_hold') → 'Payable'
 *   3. Writes an AuditLogEntry for the clean expiry.
 *
 * Architecture seams:
 *   - Seam 1 (atomicity): all three writes are in a single Postgres transaction.
 *   - Seam 3 (hold release): commission records with hold_reason='guarantee_hold' → Payable.
 *
 * Canonical docs:
 *   - docs/prd.md §5.6 — Guarantee Period and Clawback Rules
 *   - docs/architecture/phase-post-placement-risk.md §Seam 1, §Seam 3
 *
 * Issue: feat: guarantee period tracking and monitoring (#19)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import {
  getGuaranteePeriodForPlacement,
  expireGuaranteePeriodClean,
  releaseHeldCommissionRecordsForPlacement,
  advancePlacementToGuaranteeExpired,
} from 'db/guarantee-periods';

/** Nil UUID used as actor_id for system-generated audit log entries. */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// GuaranteeExpiredRecalcPayload
// ---------------------------------------------------------------------------

export interface GuaranteeExpiredRecalcPayload {
  guarantee_period_id: string;
  placement_id: string;
  org_id: string;
}

// ---------------------------------------------------------------------------
// processGuaranteeExpiredRecalc — the main task handler
// ---------------------------------------------------------------------------

export interface GuaranteeExpiredRecalcResult {
  guarantee_period_id: string;
  placement_id: string;
  new_guarantee_state: string;
  commission_records_released: number;
  placement_advanced: boolean;
  skipped: boolean;
  skip_reason?: string;
}

/**
 * Processes a single guarantee_expired_recalc task.
 *
 * Idempotent: if the guarantee period is no longer Active when the task runs,
 * the handler returns { skipped: true } without making any writes.
 *
 * @param payload     - Task payload (guarantee_period_id, placement_id, org_id).
 * @param sqlClient   - Optional injectable SQL client (for testing).
 * @param auditClient - Optional injectable audit SQL client (for testing).
 */
export async function processGuaranteeExpiredRecalc(
  payload: GuaranteeExpiredRecalcPayload,
  sqlClient?: Sql,
  auditClient?: Sql,
): Promise<GuaranteeExpiredRecalcResult> {
  const db = sqlClient ?? defaultSql;
  const adb = auditClient ?? defaultAuditSql;
  const { guarantee_period_id, placement_id, org_id } = payload;

  // 1. Load the guarantee period — idempotency guard
  const period = await getGuaranteePeriodForPlacement(db, org_id, placement_id);

  if (!period) {
    return {
      guarantee_period_id,
      placement_id,
      new_guarantee_state: 'NotFound',
      commission_records_released: 0,
      placement_advanced: false,
      skipped: true,
      skip_reason: 'guarantee_period_not_found',
    };
  }

  if (period.id !== guarantee_period_id && period.status !== 'Active') {
    // Different period ID or already terminal — skip
    return {
      guarantee_period_id,
      placement_id,
      new_guarantee_state: period.status,
      commission_records_released: 0,
      placement_advanced: false,
      skipped: true,
      skip_reason: 'period_mismatch_or_not_active',
    };
  }

  if (period.status !== 'Active') {
    return {
      guarantee_period_id,
      placement_id,
      new_guarantee_state: period.status,
      commission_records_released: 0,
      placement_advanced: false,
      skipped: true,
      skip_reason: `already_${period.status.toLowerCase()}`,
    };
  }

  // 2. Atomically transition guarantee + placement + release holds (single transaction)
  let releasedCount = 0;
  let placementAdvanced = false;
  let raceCondition = false;

  await db
    .begin(async (tx) => {
      // 2a. Expire the guarantee period
      const expired = await expireGuaranteePeriodClean(tx, period.id);
      if (!expired) {
        // Race condition: another worker already processed this — rollback and skip
        raceCondition = true;
        throw new Error('SKIP: concurrent_expiry');
      }

      // 2b. Advance placement state (GuaranteeActive → GuaranteeExpired)
      placementAdvanced = await advancePlacementToGuaranteeExpired(tx, org_id, placement_id);

      // 2c. Release held commission records
      releasedCount = await releaseHeldCommissionRecordsForPlacement(tx, org_id, placement_id);
    })
    .catch((err: unknown) => {
      if (raceCondition) return; // swallow the skip error
      throw err;
    });

  if (raceCondition) {
    return {
      guarantee_period_id,
      placement_id,
      new_guarantee_state: 'ExpiredClean',
      commission_records_released: 0,
      placement_advanced: false,
      skipped: true,
      skip_reason: 'concurrent_expiry',
    };
  }

  // 3. Write AuditLogEntry (non-fatal — outside the transaction)
  try {
    await adb.unsafe(
      `
      INSERT INTO audit_log_entries (
        org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        org_id,
        SYSTEM_ACTOR_ID,
        'System',
        'guarantee.expired_clean',
        'guarantee_period',
        period.id,
        {},
        {
          guarantee_state: 'ExpiredClean',
          commission_records_released: releasedCount,
          placement_advanced: placementAdvanced,
        },
      ],
    );
  } catch (auditErr: unknown) {
    // Audit log failure is non-fatal — log but do not fail the task
    console.error('[guarantee-expiry-worker] audit log write failed (non-fatal):', auditErr);
  }

  return {
    guarantee_period_id: period.id,
    placement_id,
    new_guarantee_state: 'ExpiredClean',
    commission_records_released: releasedCount,
    placement_advanced: placementAdvanced,
    skipped: false,
  };
}

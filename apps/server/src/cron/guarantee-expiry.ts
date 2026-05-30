/**
 * Guarantee expiry cron — scans for expired guarantee windows and enqueues
 * guarantee_expired_recalc tasks for each matching row.
 *
 * Architecture decision: cron-based expiry (Decision 1 in phase-post-placement-risk.md).
 * Frequency: configurable via GUARANTEE_EXPIRY_CRON env var, default: daily at 02:00 UTC.
 *
 * Canonical docs:
 *   - docs/prd.md §5.6 — Guarantee Period and Clawback Rules
 *   - docs/architecture/phase-post-placement-risk.md §Decision 1
 *
 * Issue: feat: guarantee period tracking and monitoring (#19)
 */

import type { CronJobContext } from './scheduler';
import { listActiveExpiredGuaranteePeriods } from 'db/guarantee-periods';
import { sql as defaultSql } from 'db/index';
import type { Sql } from 'postgres';

/** Default cron expression: daily at 02:00 UTC. Overridden by GUARANTEE_EXPIRY_CRON env var. */
export const DEFAULT_GUARANTEE_EXPIRY_CRON = process.env.GUARANTEE_EXPIRY_CRON ?? '0 2 * * *';

/**
 * Cron handler — called once per scheduled tick.
 *
 * Scans guarantee_periods WHERE status = 'Active' AND guarantee_ends < today,
 * then enqueues one guarantee_expired_recalc task per matching row.
 *
 * Uses today's date as the cutoff (UTC). Tasks are idempotency-keyed by
 * guarantee_period_id + date so re-runs on the same day are no-ops.
 *
 * @param ctx      - CronJobContext provided by the scheduler.
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function runGuaranteeExpiryScan(
  ctx: CronJobContext,
  sqlClient?: Sql,
): Promise<{ enqueued: number }> {
  const db = sqlClient ?? defaultSql;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  let periods;
  try {
    periods = await listActiveExpiredGuaranteePeriods(db, today);
  } catch (err: unknown) {
    console.error('[guarantee-expiry-cron] scan query failed:', err);
    return { enqueued: 0 };
  }

  if (periods.length === 0) {
    return { enqueued: 0 };
  }

  let enqueued = 0;
  for (const period of periods) {
    try {
      await ctx.enqueueCronTask({
        job_type: 'guarantee_expired_recalc',
        payload: {
          guarantee_period_id: period.id,
          placement_id: period.placementId,
          org_id: period.orgId,
        },
        idempotency_key_suffix: `${period.id}:${today}`,
        priority: 3,
      });
      enqueued++;
    } catch (err: unknown) {
      // Non-fatal: log and continue to next period
      console.error(`[guarantee-expiry-cron] failed to enqueue task for period ${period.id}:`, err);
    }
  }

  console.log(`[guarantee-expiry-cron] scan complete: ${enqueued} task(s) enqueued for ${today}`);
  return { enqueued };
}

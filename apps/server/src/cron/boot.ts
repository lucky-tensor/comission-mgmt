/**
 * Cron scheduler boot module for commission management.
 *
 * Creates and starts the singleton CronScheduler, registering commission-specific
 * cron jobs. Called once from the server entrypoint (index.ts).
 *
 * Jobs registered here:
 *   - stale-claim-recovery: recovers task_queue rows with expired claims
 *
 * Additional commission-domain jobs (invoice generation, partner reminders,
 * dispute escalation) will be registered in later issues.
 *
 * Adapted from template apps/server/src/cron/boot.ts.
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 */

import { CronScheduler } from './scheduler';

let scheduler: CronScheduler | null = null;

/**
 * Starts the cron scheduler and registers all jobs. Idempotent — calling
 * more than once returns the existing scheduler.
 */
export function startCronScheduler(): CronScheduler {
  if (scheduler) {
    return scheduler;
  }

  scheduler = new CronScheduler();

  // Stale claim recovery: runs every minute, recovers expired task_queue claims.
  // Reconnects to Phase 1 task-queue foundation (task-queue.ts recoverStaleClaims).
  scheduler.register('stale-claim-recovery', '* * * * *', async (ctx) => {
    await ctx.enqueueCronTask({
      job_type: 'stale-claim-recovery',
      payload: {},
      idempotency_key_suffix: new Date().toISOString().slice(0, 16), // minute-level dedup
    });
  });

  scheduler.start();
  return scheduler;
}

/**
 * Stops the cron scheduler. Safe to call even if not started.
 */
export function stopCronScheduler(): void {
  if (scheduler) {
    scheduler.stop();
    scheduler = null;
  }
}

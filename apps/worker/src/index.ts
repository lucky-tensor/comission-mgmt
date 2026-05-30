/**
 * Commission Management Worker — entry point.
 *
 * Phase 1 Foundation: worker entry point stub for background jobs
 * (guarantee expiry, clawback triggers). Full task-queue integration
 * is implemented in the task-queue Foundation issue.
 *
 * Architecture constraints:
 *   - Network-isolated: zero DB write grants; all mutations go via the API
 *     using single-use, ≤24h, task-scoped delegated tokens. (WORKER-X-001)
 *   - SELECT-only DB access via the task_queue view (WORKER-P-001/P-002)
 *   - Single-replica to start (WORKER-A-001)
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, Worker section
 */

import { log } from 'core/logger';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? '5000');

/**
 * Main worker loop. Polls the task queue for pending guarantee/clawback
 * tasks and delegates execution to the appropriate handler.
 *
 * Phase 1 stub: no tasks are processed yet — the queue schema and claim
 * logic land in the task-queue Foundation issue.
 */
async function run(): Promise<never> {
  log('info', 'Commission worker starting', {
    trace_id: crypto.randomUUID(),
    poll_interval_ms: POLL_INTERVAL_MS,
  });

  for (;;) {
    // Phase 1 stub: real task claim logic lands in the task-queue issue.
    // When implemented, this loop will:
    //   1. SELECT one pending task from the queue (SELECT-only role)
    //   2. Dispatch to a handler (guarantee-expiry, clawback-trigger, etc.)
    //   3. POST the result to the API using a single-use delegated token
    //   4. Mark the task as complete via the API
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

run().catch((err: unknown) => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});

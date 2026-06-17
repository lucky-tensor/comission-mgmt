/**
 * @file simulation-run.ts
 *
 * Producer Deal Simulator — simulation_run persistence + TTL expiry job seam.
 *
 * DORMANT_BY_DESIGN
 * depends_on: issue #262 (Producer Deal Simulator pipeline)
 * reason: dev-scout #263 reserves the typed persistence contract and the TTL
 * reaper signature so the feature work (#262) plugs into stable shapes instead
 * of re-deriving them. No runtime code writes a simulation_run row in this scout;
 * reapExpiredSimulationRuns is wired but operates only on rows the feature creates.
 *
 * simulation_run rows are ephemeral "what-if" forecasts:
 *   - input_params: the producer scenario (deal terms, bonus-season flag, ...)
 *   - result_json:  the worker forecast (predicted commission, payout schedule,
 *                   risk factors) written back via the delegated-result route
 *   - ttl_expires_at: retention ceiling; rows past this are reaped
 *
 * The TTL reaper is the simulation-side analogue of the worker-token reaper:
 * a single idempotent DELETE keyed on ttl_expires_at, safe to call repeatedly
 * (e.g. from a cron tick). It returns the number of rows removed.
 *
 * Canonical docs: docs/prd.md §5.9, docs/prd.md §5.12, docs/arbitration-simulation.md
 * Schema: packages/db/schema.sql — simulation_run table (dev-scout #263)
 */

import { sql as defaultSql } from '../index';
import type postgres from 'postgres';

/** Default retention window for a simulation_run row — 24 hours. */
export const SIMULATION_RUN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Typed view of a simulation_run row.
 * result_json is null until the worker submits its forecast via the
 * delegated-result route (POST /producer/simulations/:id/result).
 */
export interface SimulationRunRow {
  id: string;
  producer_id: string;
  org_id: string;
  /** task_queue.id of the simulation job, or null before enqueue. */
  job_id: string | null;
  input_params: Record<string, unknown>;
  result_json: Record<string, unknown> | null;
  created_at: Date;
  ttl_expires_at: Date;
}

/**
 * Compute the ttl_expires_at ceiling for a new simulation_run row.
 * Exposed so the feature pipeline (#262) stamps a consistent TTL at insert time.
 */
export function computeSimulationRunTtl(
  now: Date = new Date(),
  ttlSeconds: number = SIMULATION_RUN_TTL_SECONDS,
): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}

/**
 * TTL expiry job — delete simulation_run rows whose ttl_expires_at has passed.
 *
 * Idempotent and safe to call on a recurring schedule (cron tick). Returns the
 * number of rows removed so callers can log/meter reaper activity.
 *
 * STUB NOTE (dev-scout #263): The DELETE is real and correct, but no runtime
 * path inserts simulation_run rows yet (the worker + delegated-result route are
 * inert stubs until #262). Until the feature lands this is a no-op in practice.
 *
 * @param sqlClient - optional injected Postgres client (tests pass an ephemeral
 *   connection); production callers omit it and the module pool is used.
 * @param now - optional clock override for deterministic tests.
 */
export async function reapExpiredSimulationRuns(
  sqlClient: ReturnType<typeof postgres> = defaultSql,
  now: Date = new Date(),
): Promise<number> {
  const deleted = await sqlClient<{ id: string }[]>`
    DELETE FROM simulation_run
    WHERE ttl_expires_at <= ${now}
    RETURNING id
  `;
  return deleted.length;
}

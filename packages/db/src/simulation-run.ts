/**
 * @file simulation-run.ts
 *
 * Producer Deal Simulator — simulation_run persistence + TTL expiry job.
 *
 * simulation_run rows are ephemeral "what-if" forecasts:
 *   - input_params: the producer scenario (deal terms, bonus-season flag, ...)
 *   - result_json:  the worker forecast (payout estimate, dispute risk, reasoning)
 *                   written back via the delegated-result route
 *   - ttl_expires_at: retention ceiling; rows past this are reaped (30-day default)
 *
 * Persistence path (issue #262):
 *   1. The producer API inserts a row with input_params + a 30-day TTL when a
 *      simulation is requested (insertSimulationRun), before enqueuing the task.
 *   2. The simulation worker submits its forecast via the delegated single-use
 *      token route, which writes result_json (setSimulationRunResult).
 *   3. GET /producer/simulations reads the caller's own rows (listSimulationRunsByProducer).
 *
 * The TTL reaper is the simulation-side analogue of the worker-token reaper:
 * a single idempotent DELETE keyed on ttl_expires_at, safe to call repeatedly
 * (e.g. from a cron tick). It returns the number of rows removed.
 *
 * Canonical docs: docs/prd.md §5.9, docs/prd.md §5.12, docs/arbitration-simulation.md
 * Schema: packages/db/schema.sql — simulation_run table
 */

import { sql as defaultSql } from '../index';
import type postgres from 'postgres';

/**
 * Default retention window for a simulation_run row — 30 days.
 * Forecasts are ephemeral by design; rows past this are reaped (PRD §5.9).
 */
export const SIMULATION_RUN_TTL_SECONDS = 30 * 24 * 60 * 60;

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
 * Exposed so the feature pipeline stamps a consistent TTL at insert time.
 */
export function computeSimulationRunTtl(
  now: Date = new Date(),
  ttlSeconds: number = SIMULATION_RUN_TTL_SECONDS,
): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}

/** Options for inserting a new simulation_run row. */
export interface InsertSimulationRunOptions {
  orgId: string;
  producerId: string;
  inputParams: Record<string, unknown>;
  /** task_queue.id once the task is enqueued (may be set later). */
  jobId?: string | null;
  ttlExpiresAt?: Date;
}

/**
 * Insert a simulation_run row for a newly-requested forecast.
 * result_json starts null and is filled in by the delegated-result route once
 * the worker submits the forecast.
 *
 * @param sqlClient - optional injected Postgres client (tests pass an ephemeral
 *   connection); production callers omit it and the module pool is used.
 */
export async function insertSimulationRun(
  options: InsertSimulationRunOptions,
  sqlClient: ReturnType<typeof postgres> = defaultSql,
): Promise<SimulationRunRow> {
  const ttl = options.ttlExpiresAt ?? computeSimulationRunTtl();
  const [row] = await sqlClient<SimulationRunRow[]>`
    INSERT INTO simulation_run
      (org_id, producer_id, job_id, input_params, result_json, ttl_expires_at)
    VALUES
      (${options.orgId}, ${options.producerId}, ${options.jobId ?? null},
       ${sqlClient.json(options.inputParams as never)}, NULL, ${ttl})
    RETURNING id, producer_id, org_id, job_id, input_params, result_json,
              created_at, ttl_expires_at
  `;
  return row;
}

/**
 * Fetch a single simulation_run row by id (no scoping — callers must verify
 * org/producer ownership before exposing the row).
 */
export async function getSimulationRunById(
  id: string,
  sqlClient: ReturnType<typeof postgres> = defaultSql,
): Promise<SimulationRunRow | null> {
  const rows = await sqlClient<SimulationRunRow[]>`
    SELECT id, producer_id, org_id, job_id, input_params, result_json,
           created_at, ttl_expires_at
    FROM simulation_run
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Persist the worker's forecast onto an existing simulation_run row.
 * Returns the updated row, or null if no row matched the id + org.
 *
 * Scoped by org_id as defense-in-depth even though the delegated token is
 * task-bound: a forecast can only be written to a row in the same tenant.
 */
export async function setSimulationRunResult(
  options: { id: string; orgId: string; result: Record<string, unknown> },
  sqlClient: ReturnType<typeof postgres> = defaultSql,
): Promise<SimulationRunRow | null> {
  const rows = await sqlClient<SimulationRunRow[]>`
    UPDATE simulation_run
    SET result_json = ${sqlClient.json(options.result as never)}
    WHERE id = ${options.id} AND org_id = ${options.orgId}
    RETURNING id, producer_id, org_id, job_id, input_params, result_json,
              created_at, ttl_expires_at
  `;
  return rows[0] ?? null;
}

/**
 * List a producer's own simulation_run history within their org, newest first.
 * Used by GET /producer/simulations. Scoped to (org_id, producer_id) so a
 * producer can never read another producer's forecasts.
 */
export async function listSimulationRunsByProducer(
  orgId: string,
  producerId: string,
  sqlClient: ReturnType<typeof postgres> = defaultSql,
): Promise<SimulationRunRow[]> {
  return sqlClient<SimulationRunRow[]>`
    SELECT id, producer_id, org_id, job_id, input_params, result_json,
           created_at, ttl_expires_at
    FROM simulation_run
    WHERE org_id = ${orgId} AND producer_id = ${producerId}
    ORDER BY created_at DESC
  `;
}

/**
 * TTL expiry job — delete simulation_run rows whose ttl_expires_at has passed.
 *
 * Idempotent and safe to call on a recurring schedule (cron tick). Returns the
 * number of rows removed so callers can log/meter reaper activity.
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

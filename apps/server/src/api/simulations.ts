/**
 * Producer deal simulation API routes (issue #262).
 *
 * The Producer Deal Simulator forecasts payout + dispute-risk for a producer's
 * own deals (registered placements) or for a hypothetical scenario, using the
 * async worker pipeline:
 *
 *   POST /producer/simulations/actual        — enqueue a forecast for an own deal
 *   POST /producer/simulations/hypothetical   — enqueue a forecast for a scenario
 *   GET  /producer/simulations                 — own simulation history
 *   POST /producer/simulations/:id/result      — worker write path (delegated token)
 *
 * Request flow (docs/arbitration-simulation.md — Simulation worker execution flow):
 *   1. Validate producer scope (own deal_id only; 403 otherwise).
 *   2. Resolve deal + producer plan-version + fee-rate context under the
 *      producer's authority and embed it in the task payload (the HTTP-only
 *      worker never connects to the DB; WORKER-X-001).
 *   3. Insert a simulation_run row (input_params + 30-day TTL).
 *   4. Enqueue a `producer_simulation` task and mint a single-use delegated
 *      token bound to that task + simulation_run, returned in the enqueue
 *      response so the demo worker can submit the forecast back.
 *   5. The worker submits to POST /producer/simulations/:id/result; we validate
 *      the single-use token, persist result_json, and write an AuditLogEntry.
 *
 * Simulation is strictly read-only: it never creates or modifies a placement,
 * commission, or payout row.
 *
 * Canonical docs: docs/prd.md §5.9, §5.12, §9; docs/arbitration-simulation.md
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import {
  insertSimulationRun,
  getSimulationRunById,
  setSimulationRunResult,
  listSimulationRunsByProducer,
} from 'db/index';
import { getPlacement } from 'db/index';
import { enqueueTask } from 'db/task-queue';
import { persistWorkerToken, consumeWorkerToken } from 'db/worker-tokens';
import { signJwt, verifyJwtSignatureOnly } from '../auth/jwt';
import type { SessionClaims } from 'core/auth';
import type {
  ActualDealSimulationRequest,
  HypotheticalDealSimulationRequest,
  DealSimulationForecast,
  SimulationRunRecord,
  SimulationRunHistoryResponse,
} from 'core/producer-simulation';

type SqlClient = Sql;

/** agent_type for the simulation worker queue (docs/arbitration-simulation.md). */
const SIMULATION_AGENT_TYPE = 'simulation_agent';
/** job_type for producer deal-simulation tasks. */
const SIMULATION_JOB_TYPE = 'producer_simulation';
/** Delegated token scope the result route accepts. */
const SIMULATION_RESULT_SCOPE = 'simulation_agent:submit';
/** Delegated token TTL — short-lived; the forecast is computed promptly. */
const SIMULATION_TOKEN_TTL_SECONDS = 15 * 60;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Claims embedded in the simulation delegated token. */
interface SimulationTokenClaims {
  task_id: string;
  simulation_run_id: string;
  org_id: string;
  agent_type: string;
  scope: string;
  jti: string;
  exp: number;
}

/**
 * Resolve the producer's active plan version + fee-rate so the forecast can be
 * traced to the producer's own plan version and fee-rate structure (PRD §9).
 * Reads under the producer's authority (called from a session-authenticated
 * handler). Returns null when the producer has no active plan assignment.
 */
async function resolveProducerPlanContext(
  db: SqlClient,
  orgId: string,
  producerId: string,
): Promise<{
  plan_version_id: string;
  plan_name: string;
  base_rate: number | null;
  rules_snapshot: Record<string, unknown>;
} | null> {
  const rows = (await db.unsafe(
    `
    SELECT pv.id AS plan_version_id, pv.rules_snapshot, cp.name AS plan_name
    FROM plan_assignments pa
    JOIN plan_versions pv ON pv.id = pa.plan_version_id
    JOIN commission_plans cp ON cp.id = pv.plan_id
    WHERE pa.org_id = $1
      AND pa.producer_id = $2
      AND pv.status = 'Active'
      AND (pa.expires_at IS NULL OR pa.expires_at > NOW())
    ORDER BY pa.assigned_at DESC
    LIMIT 1
    `,
    [orgId, producerId],
  )) as unknown as Array<{
    plan_version_id: string;
    rules_snapshot: Record<string, unknown>;
    plan_name: string;
  }>;

  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  const rate = r.rules_snapshot?.['base_rate'];
  return {
    plan_version_id: r.plan_version_id,
    plan_name: r.plan_name,
    base_rate: typeof rate === 'number' ? rate : null,
    rules_snapshot: r.rules_snapshot ?? {},
  };
}

/**
 * Assert the producer (caller) is credited on the given deal (placement).
 * Returns true when a contributor row links producer_id = caller within the org.
 */
async function producerOwnsDeal(
  db: SqlClient,
  orgId: string,
  producerId: string,
  dealId: string,
): Promise<boolean> {
  const rows = (await db.unsafe(
    `
    SELECT 1
    FROM contributors
    WHERE org_id = $1 AND producer_id = $2 AND placement_id = $3
    LIMIT 1
    `,
    [orgId, producerId, dealId],
  )) as unknown as Array<unknown>;
  return rows.length > 0;
}

/**
 * Mint + persist a single-use delegated token bound to the simulation task and
 * its simulation_run row. The demo response includes this token so the worker
 * can submit the forecast to POST /producer/simulations/:id/result.
 */
async function mintSimulationToken(
  db: SqlClient,
  opts: { taskId: string; simulationRunId: string; orgId: string; podId: string },
): Promise<string> {
  const jti = crypto.randomUUID();
  const ttlSeconds = SIMULATION_TOKEN_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const payload: SimulationTokenClaims = {
    task_id: opts.taskId,
    simulation_run_id: opts.simulationRunId,
    org_id: opts.orgId,
    agent_type: SIMULATION_AGENT_TYPE,
    scope: SIMULATION_RESULT_SCOPE,
    jti,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };

  const token = await signJwt(payload, ttlSeconds / 3600);
  await persistWorkerToken({
    podId: opts.podId,
    agentType: SIMULATION_AGENT_TYPE,
    taskId: opts.taskId,
    jti,
    expiresAt,
    sql: db,
  });
  return token;
}

function toForecast(result: Record<string, unknown> | null): DealSimulationForecast | null {
  if (!result) return null;
  const payout = result['payout_estimate'];
  const risk = result['dispute_risk'];
  const reasoning = result['reasoning'];
  if (typeof payout !== 'number' || typeof risk !== 'string' || typeof reasoning !== 'string') {
    return null;
  }
  return { payout_estimate: payout, dispute_risk: risk, reasoning };
}

function toHistoryRecord(row: {
  id: string;
  producer_id: string;
  org_id: string;
  job_id: string | null;
  input_params: Record<string, unknown>;
  result_json: Record<string, unknown> | null;
  created_at: Date;
  ttl_expires_at: Date;
}): SimulationRunRecord {
  return {
    id: row.id,
    producer_id: row.producer_id,
    org_id: row.org_id,
    job_id: row.job_id ?? '',
    input_params: row.input_params,
    result_json: toForecast(row.result_json),
    created_at: new Date(row.created_at).toISOString(),
    ttl_expires_at: new Date(row.ttl_expires_at).toISOString(),
  };
}

/**
 * Enqueue a simulation: insert the simulation_run, create the task with an
 * embedded context payload, and mint the delegated token. Shared by the actual
 * and hypothetical entrypoints.
 */
async function enqueueSimulation(
  db: SqlClient,
  opts: {
    orgId: string;
    producerId: string;
    inputParams: Record<string, unknown>;
    payloadContext: Record<string, unknown>;
  },
): Promise<{ simulationRunId: string; taskId: string; token: string }> {
  // 1. Insert the simulation_run row with input_params + 30-day TTL.
  const run = await insertSimulationRun(
    { orgId: opts.orgId, producerId: opts.producerId, inputParams: opts.inputParams },
    db,
  );

  // 2. Enqueue a producer_simulation task. The payload carries entity references
  //    plus the producer-authored context the worker turns into a prompt; the
  //    simulation_run_id binds the result back to this row. We must create the
  //    task before minting the token because the token is task-bound.
  const idempotencyKey = crypto.randomUUID();
  const task = await enqueueTaskScoped(db, {
    idempotencyKey,
    agentType: SIMULATION_AGENT_TYPE,
    jobType: SIMULATION_JOB_TYPE,
    payload: {
      ...opts.payloadContext,
      simulation_run_id: run.id,
      producer_id: opts.producerId,
      org_id: opts.orgId,
    },
    createdBy: opts.producerId,
    correlationId: run.id,
  });

  // 3. Persist the task_queue link onto the simulation_run row.
  await db.unsafe(`UPDATE simulation_run SET job_id = $1 WHERE id = $2`, [task.id, run.id]);

  // 4. Mint the single-use delegated token bound to the task + run, and embed it
  //    in the task payload so the claiming worker can submit its forecast to
  //    POST /producer/simulations/:id/result (WORKER-P-002 write path).
  const token = await mintSimulationToken(db, {
    taskId: task.id,
    simulationRunId: run.id,
    orgId: opts.orgId,
    podId: `simulation-${run.id}`,
  });
  await db.unsafe(
    `UPDATE task_queue SET payload = jsonb_set(payload, '{result_token}', to_jsonb($1::text)) WHERE id = $2`,
    [token, task.id],
  );

  return { simulationRunId: run.id, taskId: task.id, token };
}

/** Insert a task_queue row, honoring an injectable sql client (tests). */
async function enqueueTaskScoped(
  db: SqlClient,
  opts: {
    idempotencyKey: string;
    agentType: string;
    jobType: string;
    payload: Record<string, unknown>;
    createdBy: string;
    correlationId: string;
  },
): Promise<{ id: string }> {
  if (db === defaultSql) {
    const row = await enqueueTask({
      idempotency_key: opts.idempotencyKey,
      agent_type: opts.agentType,
      job_type: opts.jobType,
      payload: opts.payload,
      correlation_id: opts.correlationId,
      created_by: opts.createdBy,
    });
    return { id: row.id };
  }
  const [row] = await db<{ id: string }[]>`
    INSERT INTO task_queue
      (idempotency_key, agent_type, job_type, payload, correlation_id, created_by, priority, max_attempts)
    VALUES
      (${opts.idempotencyKey}, ${opts.agentType}, ${opts.jobType},
       ${db.json(opts.payload as never)}, ${opts.correlationId}, ${opts.createdBy}, ${5}, ${3})
    RETURNING id
  `;
  return { id: row.id };
}

// ---------------------------------------------------------------------------
// POST /producer/simulations/actual
// ---------------------------------------------------------------------------

/**
 * Enqueue a forecast for one of the producer's own registered deals.
 *
 * Producer-scope: the caller must be a contributor on deal_id within their org;
 * another producer's deal_id returns 403. Returns 202 with a pending envelope
 * (simulation_id, job_id) and the delegated token for the demo worker.
 */
export async function handleCreateActualSimulation(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  let body: ActualDealSimulationRequest;
  try {
    body = (await req.json()) as ActualDealSimulationRequest;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.deal_id || typeof body.deal_id !== 'string') {
    return errorResponse('deal_id is required', 422);
  }

  // Producer scope: caller must own (be credited on) the deal.
  const owns = await producerOwnsDeal(db, claims.org_id, claims.user_id, body.deal_id);
  if (!owns) {
    return errorResponse('You do not have access to this deal', 403);
  }

  // Resolve the deal + plan context under the producer's authority.
  const placement = await getPlacement(db, body.deal_id);
  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Deal not found', 404);
  }
  const planContext = await resolveProducerPlanContext(db, claims.org_id, claims.user_id);

  const inputParams: Record<string, unknown> = {
    kind: 'actual',
    deal_id: body.deal_id,
  };

  const payloadContext: Record<string, unknown> = {
    kind: 'actual',
    deal_id: body.deal_id,
    bonus_season_flag: false,
    deal_context: {
      job_title: placement.jobTitle,
      fee_amount: placement.feeAmount,
      compensation_base: placement.compensationBase,
      status: placement.status,
    },
    plan_context: planContext,
  };

  try {
    const { simulationRunId, taskId, token } = await enqueueSimulation(db, {
      orgId: claims.org_id,
      producerId: claims.user_id,
      inputParams,
      payloadContext,
    });
    return jsonResponse(
      {
        status: 'pending',
        simulation_id: simulationRunId,
        job_id: taskId,
        result_token: token,
      },
      202,
    );
  } catch (err) {
    console.error('[simulations] enqueue actual error:', err);
    return errorResponse('Failed to enqueue simulation', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /producer/simulations/hypothetical
// ---------------------------------------------------------------------------

/**
 * Enqueue a forecast for a hypothetical scenario (amount/tier/bonus/accrual).
 * No deal is referenced, so no producer-scope check applies beyond the session
 * role (RBAC). The forecast is still traceable to the producer's plan context.
 */
export async function handleCreateHypotheticalSimulation(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  let body: HypotheticalDealSimulationRequest;
  try {
    body = (await req.json()) as HypotheticalDealSimulationRequest;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
    return errorResponse('amount must be a positive number', 422);
  }
  if (typeof body.tier !== 'string' || body.tier.trim() === '') {
    return errorResponse('tier is required', 422);
  }
  if (typeof body.accrual_percent !== 'number' || !Number.isFinite(body.accrual_percent)) {
    return errorResponse('accrual_percent must be a number', 422);
  }
  const bonusSeason = Boolean(body.bonus_season_flag);

  const planContext = await resolveProducerPlanContext(db, claims.org_id, claims.user_id);

  const inputParams: Record<string, unknown> = {
    kind: 'hypothetical',
    amount: body.amount,
    tier: body.tier,
    bonus_season_flag: bonusSeason,
    accrual_percent: body.accrual_percent,
  };

  const payloadContext: Record<string, unknown> = {
    kind: 'hypothetical',
    amount: body.amount,
    tier: body.tier,
    bonus_season_flag: bonusSeason,
    accrual_percent: body.accrual_percent,
    plan_context: planContext,
  };

  try {
    const { simulationRunId, taskId, token } = await enqueueSimulation(db, {
      orgId: claims.org_id,
      producerId: claims.user_id,
      inputParams,
      payloadContext,
    });
    return jsonResponse(
      {
        status: 'pending',
        simulation_id: simulationRunId,
        job_id: taskId,
        result_token: token,
      },
      202,
    );
  } catch (err) {
    console.error('[simulations] enqueue hypothetical error:', err);
    return errorResponse('Failed to enqueue simulation', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /producer/simulations — own history
// ---------------------------------------------------------------------------

/**
 * Returns only the requesting producer's simulation history, newest first.
 * Scoped to (org_id, producer_id) at the DB layer.
 */
export async function handleListMySimulations(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  try {
    const rows = await listSimulationRunsByProducer(claims.org_id, claims.user_id, db);
    const body: SimulationRunHistoryResponse = {
      simulation_runs: rows.map(toHistoryRecord),
    };
    return jsonResponse(body);
  } catch (err) {
    console.error('[simulations] list error:', err);
    return errorResponse('Failed to list simulations', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /producer/simulations/:id/result — worker delegated-result write path
// ---------------------------------------------------------------------------

/**
 * Structured forecast body the simulation worker submits back to the API via
 * the delegated single-use token.
 */
export interface SimulationResultBody {
  payout_estimate: number;
  dispute_risk: string;
  reasoning: string;
}

/**
 * Validate the structured simulation result payload the worker submits.
 */
export function validateSimulationResultBody(payload: unknown): payload is SimulationResultBody {
  if (!payload || typeof payload !== 'object') return false;
  const body = payload as Record<string, unknown>;
  if (typeof body['payout_estimate'] !== 'number' || Number.isNaN(body['payout_estimate'])) {
    return false;
  }
  if (typeof body['dispute_risk'] !== 'string' || body['dispute_risk'].trim() === '') {
    return false;
  }
  if (typeof body['reasoning'] !== 'string' || body['reasoning'].trim() === '') {
    return false;
  }
  return true;
}

/**
 * Write an AuditLogEntry for a simulation run (best-effort; failures logged).
 */
async function writeSimulationAuditLog(
  auditSql: SqlClient,
  opts: {
    orgId: string;
    actorId: string;
    correlationId: string;
    simulationRunId: string;
    afterJson: unknown;
  },
): Promise<void> {
  try {
    // audit_log_entries has no correlation_id column; carry it in after_json so
    // every run is traceable to its task/job (PRD §9 explainability).
    const afterWithCorrelation = {
      ...(opts.afterJson as Record<string, unknown>),
      correlation_id: opts.correlationId,
    };
    await auditSql.unsafe(
      `
      INSERT INTO audit_log_entries (
        org_id, actor_id, actor_type, action, entity_type, entity_id,
        before_json, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        opts.orgId,
        opts.actorId,
        'Agent',
        'simulation.completed',
        'simulation_run',
        opts.simulationRunId,
        null as never,
        afterWithCorrelation as never,
      ],
    );
  } catch (err: unknown) {
    console.error('[simulations] audit log write error (non-fatal):', err);
  }
}

/**
 * POST /producer/simulations/:id/result — delegated single-use token result route.
 *
 * Worker-facing write path (Bearer delegated token, no session cookie), matching
 * the WORKER-P-002 writes-through-authenticated-api model used by
 * POST /tasks/:id/result. The token is single-use (consumeWorkerToken) and must
 * be bound to this simulation_run id. Persists result_json and writes an
 * AuditLogEntry with a correlation id.
 *
 * @param simulationId - the simulation_run id from the route (:id).
 */
export async function handleSubmitSimulationResult(
  simulationId: string,
  req: Request,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return errorResponse('Worker token required', 401);
  }
  const token = authHeader.slice('Bearer '.length).trim();

  let claims: SimulationTokenClaims;
  try {
    claims = await verifyJwtSignatureOnly<SimulationTokenClaims>(token);
  } catch {
    return errorResponse('Invalid or expired worker token', 403);
  }

  // Scope must include simulation_agent:submit and bind to this simulation_run.
  if (claims.scope !== SIMULATION_RESULT_SCOPE) {
    return errorResponse('Insufficient scope', 403);
  }
  if (claims.simulation_run_id !== simulationId) {
    return errorResponse('Token not bound to this simulation', 403);
  }

  let body: SimulationResultBody;
  try {
    body = (await req.json()) as SimulationResultBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (!validateSimulationResultBody(body)) {
    return errorResponse('Malformed forecast result', 422);
  }

  // Consume the single-use token before applying any mutation.
  const consumed = await consumeWorkerToken(claims.jti, db);
  if (!consumed) {
    return errorResponse('Worker token already used, expired, or invalid', 403);
  }

  const run = await getSimulationRunById(simulationId, db);
  if (!run || run.org_id !== claims.org_id) {
    return errorResponse('Simulation not found', 404);
  }

  const updated = await setSimulationRunResult(
    {
      id: simulationId,
      orgId: claims.org_id,
      result: {
        payout_estimate: body.payout_estimate,
        dispute_risk: body.dispute_risk,
        reasoning: body.reasoning,
      },
    },
    db,
  );
  if (!updated) {
    return errorResponse('Failed to persist simulation result', 500);
  }

  await writeSimulationAuditLog(adb, {
    orgId: claims.org_id,
    actorId: run.producer_id,
    correlationId: claims.task_id,
    simulationRunId: simulationId,
    afterJson: {
      payout_estimate: body.payout_estimate,
      dispute_risk: body.dispute_risk,
    },
  });

  return jsonResponse({ id: updated.id, status: 'completed' });
}

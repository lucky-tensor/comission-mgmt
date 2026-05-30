/**
 * Task queue API routes.
 *
 * Routes:
 *   POST /tasks              — enqueue a background task (references-only payload)
 *   GET  /tasks/:id          — get task status
 *   POST /tasks/:id/result   — worker submits task result via delegated credential
 *   POST /tasks/claim        — worker claims next pending task (Bearer auth)
 *   POST /agents/credentials — Finance Admin mints a scoped worker token
 *
 * Worker write-path security (WORKER-X-001):
 *   Workers never write to the DB directly. Instead they POST to /tasks/:id/result
 *   using a single-use, scoped, short-lived delegated worker token. The middleware
 *   validates the worker token scope and single-use constraint before applying any
 *   mutation — so every worker write passes the same validation and audit path as
 *   a human request.
 *
 * Injectable sql (for testing):
 *   All handler functions accept an optional SqlClient so tests can inject an
 *   ephemeral Postgres connection without touching the module-level pool.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, Task Queue
 */

import { signJwt, verifyJwtSignatureOnly } from '../auth/jwt';
import { consumeWorkerToken, persistWorkerToken, type SqlClient } from 'db/worker-tokens';
import {
  enqueueTask,
  claimNextTask,
  submitTaskResult,
  validatePayload,
  type TaskQueueRow,
} from 'db/task-queue';
import { sql as defaultSql } from 'db/index';
import type { SessionClaims } from 'core/auth';

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
// POST /tasks — enqueue a background task
// ---------------------------------------------------------------------------

export interface EnqueueTaskBody {
  idempotency_key?: string;
  agent_type: string;
  job_type: string;
  payload?: Record<string, unknown>;
  priority?: number;
}

/**
 * Enqueues a background task.
 *
 * The caller must supply a references-only payload (entity IDs, no business
 * values). Returns 400 when payload validation fails.
 * Returns 201 on first creation, 200 on idempotent re-submission.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleEnqueueTask(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  let body: EnqueueTaskBody;
  try {
    body = (await req.json()) as EnqueueTaskBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.agent_type || !body.job_type) {
    return errorResponse('agent_type and job_type are required', 400);
  }

  const payload = body.payload ?? {};

  // References-only enforcement (TQ-P-004)
  try {
    validatePayload(payload);
  } catch (err: unknown) {
    return errorResponse((err as Error).message, 400);
  }

  const idempotency_key = body.idempotency_key ?? crypto.randomUUID();
  const db = sqlClient ?? defaultSql;

  let task: TaskQueueRow;
  try {
    // enqueueTask uses the module-level sql; if sqlClient is provided, bypass
    // it with a direct insert so tests can use their ephemeral container.
    if (sqlClient) {
      const [row] = await db<TaskQueueRow[]>`
        INSERT INTO task_queue
          (idempotency_key, agent_type, job_type, payload, created_by, priority, max_attempts)
        VALUES
          (${idempotency_key}, ${body.agent_type}, ${body.job_type},
           ${db.json(payload as never)}, ${claims.user_id},
           ${body.priority ?? 5}, ${3})
        ON CONFLICT (idempotency_key) DO UPDATE
          SET updated_at = task_queue.updated_at
        RETURNING *
      `;
      task = row;
    } else {
      task = await enqueueTask({
        idempotency_key,
        agent_type: body.agent_type,
        job_type: body.job_type,
        payload,
        created_by: claims.user_id,
        priority: body.priority,
      });
    }
  } catch (err: unknown) {
    console.error('[tasks] enqueue error:', err);
    return errorResponse('Failed to enqueue task', 500);
  }

  // Determine if this is a new task or an idempotent re-submission
  const isNew =
    Math.abs(new Date(task.created_at).getTime() - new Date(task.updated_at).getTime()) < 100;
  const status = isNew ? 201 : 200;

  return jsonResponse(
    {
      id: task.id,
      idempotency_key: task.idempotency_key,
      agent_type: task.agent_type,
      job_type: task.job_type,
      status: task.status,
      priority: task.priority,
      created_at: task.created_at,
    },
    status,
  );
}

// ---------------------------------------------------------------------------
// GET /tasks/:id — get task status
// ---------------------------------------------------------------------------

/**
 * Returns the current status of a task by ID.
 * Sensitive fields (payload, delegated_token) are excluded.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleGetTask(
  taskId: string,
  _claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const rows = await db<TaskQueueRow[]>`
    SELECT
      id, idempotency_key, agent_type, job_type, status, correlation_id,
      created_by, claimed_by, claimed_at, claim_expires_at,
      result, error_message, attempt, max_attempts,
      next_retry_at, priority, created_at, updated_at
    FROM task_queue
    WHERE id = ${taskId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return errorResponse('Task not found', 404);
  }

  const task = rows[0];
  return jsonResponse({
    id: task.id,
    idempotency_key: task.idempotency_key,
    agent_type: task.agent_type,
    job_type: task.job_type,
    status: task.status,
    correlation_id: task.correlation_id,
    created_by: task.created_by,
    claimed_by: task.claimed_by,
    claimed_at: task.claimed_at,
    claim_expires_at: task.claim_expires_at,
    result: task.result,
    error_message: task.error_message,
    attempt: task.attempt,
    max_attempts: task.max_attempts,
    next_retry_at: task.next_retry_at,
    priority: task.priority,
    created_at: task.created_at,
    updated_at: task.updated_at,
  });
}

// ---------------------------------------------------------------------------
// POST /tasks/:id/result — worker submits task result via delegated credential
//
// This is the only mutation path available to worker containers. Workers must
// present a valid single-use worker token (Bearer) with a scope that matches
// the agent_type of the task. A missing or invalid scope returns 403 with no
// DB change.
// ---------------------------------------------------------------------------

/** Worker token claims shape (subset of JWT payload). */
interface WorkerTokenClaims {
  task_id: string;
  agent_type: string;
  pod_id: string;
  jti: string;
  exp: number;
  scope: string;
}

export interface SubmitResultBody {
  result: Record<string, unknown>;
}

/**
 * Accepts a task result from a worker process.
 *
 * Authentication: Bearer token (worker token, not session cookie).
 * The token is validated as single-use (consumeWorkerToken). If the scope
 * does not include the task's agent_type, returns 403 with no DB mutation.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleSubmitTaskResult(
  taskId: string,
  req: Request,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // Extract Bearer token from Authorization header
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return errorResponse('Worker token required', 401);
  }
  const token = authHeader.slice('Bearer '.length).trim();

  // Verify the JWT signature and expiry
  let claims: WorkerTokenClaims;
  try {
    claims = await verifyJwtSignatureOnly<WorkerTokenClaims>(token);
  } catch {
    return errorResponse('Invalid or expired worker token', 403);
  }

  // Validate scope: must contain a colon-delimited scope that matches the
  // pattern "<agent_type>:submit" or the generic "task:submit".
  const allowedScopes = new Set(['task:submit', `${claims.agent_type}:submit`]);
  const tokenScope: string = claims.scope ?? '';
  const scopeTokens = tokenScope.split(' ');
  const hasScope = scopeTokens.some((s: string) => allowedScopes.has(s));
  if (!hasScope) {
    return errorResponse('Insufficient scope', 403);
  }

  // Enforce that the token is bound to this task
  if (claims.task_id !== taskId) {
    return errorResponse('Token not bound to this task', 403);
  }

  // Consume the single-use token (inserts JTI into revoked_tokens on success)
  const consumed = await consumeWorkerToken(claims.jti, sqlClient);
  if (!consumed) {
    return errorResponse('Worker token already used, expired, or invalid', 403);
  }

  // Parse result body
  let body: SubmitResultBody;
  try {
    body = (await req.json()) as SubmitResultBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.result || typeof body.result !== 'object') {
    return errorResponse('result is required and must be an object', 400);
  }

  // Fetch the task to verify it exists and is claimable by this agent type
  const taskRows = await db<TaskQueueRow[]>`
    SELECT id, agent_type, status FROM task_queue WHERE id = ${taskId} LIMIT 1
  `;
  if (taskRows.length === 0) {
    return errorResponse('Task not found', 404);
  }
  const task = taskRows[0];

  if (task.agent_type !== claims.agent_type) {
    return errorResponse('Token agent_type does not match task agent_type', 403);
  }

  if (task.status === 'completed') {
    return jsonResponse({ id: task.id, status: 'completed', message: 'Already completed' });
  }

  // Submit the result (use injectable db path when sqlClient provided)
  let updated: TaskQueueRow | null;
  if (sqlClient) {
    const rows = await db<TaskQueueRow[]>`
      UPDATE task_queue
      SET status     = 'completed',
          result     = ${db.json(body.result as never)},
          updated_at = NOW()
      WHERE id = ${taskId}
      RETURNING *
    `;
    updated = rows[0] ?? null;
  } else {
    updated = await submitTaskResult({ id: taskId, result: body.result });
  }

  if (!updated) {
    return errorResponse('Failed to submit task result', 500);
  }

  return jsonResponse({ id: updated.id, status: updated.status, result: updated.result });
}

// ---------------------------------------------------------------------------
// POST /agents/credentials — mint a scoped delegated worker token
//
// Operator or Finance Admin action: issues a short-lived token (max 24h)
// that a worker pod can use to submit results via the tasks/:id/result route.
// ---------------------------------------------------------------------------

export interface MintCredentialBody {
  pod_id: string;
  agent_type: string;
  task_id: string;
  /** Scope string e.g. "commission-calculator:submit" */
  scope?: string;
  /** TTL in seconds, max 86400 (24h). Defaults to 3600. */
  ttl_seconds?: number;
}

/**
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleMintAgentCredential(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  // Only Finance Admin or system roles may mint worker tokens
  if (claims.role !== 'FinanceAdmin') {
    return errorResponse('Finance Admin role required to mint worker credentials', 403);
  }

  let body: MintCredentialBody;
  try {
    body = (await req.json()) as MintCredentialBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.pod_id || !body.agent_type || !body.task_id) {
    return errorResponse('pod_id, agent_type, and task_id are required', 400);
  }

  const ttlSeconds = Math.min(body.ttl_seconds ?? 3600, 86400);
  const scope = body.scope ?? `${body.agent_type}:submit`;

  // Issue the JWT
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const expiresInHours = ttlSeconds / 3600;

  const workerPayload: WorkerTokenClaims = {
    task_id: body.task_id,
    agent_type: body.agent_type,
    pod_id: body.pod_id,
    jti,
    exp: Math.floor(expiresAt.getTime() / 1000),
    scope,
  };

  const token = await signJwt(workerPayload, expiresInHours);

  // Persist the token record in worker_tokens for single-use tracking
  await persistWorkerToken({
    podId: body.pod_id,
    agentType: body.agent_type,
    taskId: body.task_id,
    jti,
    expiresAt,
    sql: sqlClient,
  });

  return jsonResponse(
    {
      token,
      jti,
      pod_id: body.pod_id,
      agent_type: body.agent_type,
      task_id: body.task_id,
      scope,
      expires_at: expiresAt.toISOString(),
    },
    201,
  );
}

// ---------------------------------------------------------------------------
// POST /tasks/claim — claim a task (called by worker process via Bearer auth)
//
// The worker process calls this to atomically claim a pending task for a
// given agent_type. Returns the claimed task row or 204 when no task is
// available. The claim is done server-side (in the app layer, with app_rw
// credentials) so the worker never touches the DB directly.
// ---------------------------------------------------------------------------

export interface ClaimTaskBody {
  agent_type: string;
  /** Worker pod identifier */
  pod_id: string;
}

/**
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleClaimTask(req: Request, sqlClient?: SqlClient): Promise<Response> {
  // This endpoint is called by the worker using a Bearer worker token
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return errorResponse('Worker token required', 401);
  }
  const token = authHeader.slice('Bearer '.length).trim();

  let claims: WorkerTokenClaims;
  try {
    claims = await verifyJwtSignatureOnly<WorkerTokenClaims>(token);
  } catch {
    return errorResponse('Invalid or expired worker token', 403);
  }

  let body: ClaimTaskBody;
  try {
    body = (await req.json()) as ClaimTaskBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.agent_type) {
    return errorResponse('agent_type is required', 400);
  }

  // For injectable sql, use direct SQL; otherwise use the module function
  let task: TaskQueueRow | null;
  if (sqlClient) {
    const db = sqlClient;
    const rows = await db<TaskQueueRow[]>`
      UPDATE task_queue
      SET status           = 'claimed',
          claimed_by       = ${claims.pod_id ?? body.pod_id},
          claimed_at       = NOW(),
          claim_expires_at = NOW() + INTERVAL '5 minutes',
          delegated_token  = ${token},
          attempt          = attempt + 1,
          updated_at       = NOW()
      WHERE id = (
        SELECT id FROM task_queue
        WHERE agent_type = ${body.agent_type}
          AND status = 'pending'
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;
    task = rows[0] ?? null;
  } else {
    task = await claimNextTask({
      agent_type: body.agent_type,
      claimed_by: claims.pod_id ?? body.pod_id,
      delegated_token: token,
      claim_ttl_seconds: 300,
    });
  }

  if (!task) {
    return new Response(null, { status: 204 });
  }

  return jsonResponse({
    id: task.id,
    agent_type: task.agent_type,
    job_type: task.job_type,
    payload: task.payload,
    claim_expires_at: task.claim_expires_at,
    attempt: task.attempt,
  });
}

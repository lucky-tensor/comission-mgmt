/**
 * Commission Management Worker — entry point.
 *
 * Implements the claim-execute-submit loop for background commission tasks.
 * The worker operates under strict network isolation constraints:
 *
 * Security model (WORKER-X-001):
 *   - No direct DB connection to domain tables. All mutations go via the
 *     application API using single-use, ≤24h, task-scoped delegated tokens.
 *   - The worker claims tasks via POST /tasks/claim (app-side DB write).
 *   - Results are submitted via POST /tasks/:id/result with a Bearer token.
 *
 * Agents implemented:
 *   - ping: no-op round-trip that proves the full claim-execute-submit loop.
 *
 * Future agents (added in later phases):
 *   - guarantee-expire: Post-Placement Risk phase
 *   - clawback-trigger: Post-Placement Risk phase
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, Worker section
 */

import { log } from 'core/logger';
import { runPingAgent } from './agents/ping';
import { assertNoDbCredentials } from './startup-guard';

// Fail fast if the worker was handed a DB credential or the encryption master
// key — it is HTTP-only and must never hold one (WORKER-X-009, DATA-P-007).
assertNoDbCredentials();

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? '5000');
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://server:31415';
/** Worker pod identifier — in k8s this is the pod name injected via HOSTNAME env. */
const POD_ID = process.env.HOSTNAME ?? `worker-${crypto.randomUUID()}`;
/** Agent type this worker instance handles. */
const AGENT_TYPE = process.env.AGENT_TYPE ?? 'ping';
/** Delegated worker token issued at pod startup for task:submit scope. */
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? '';

/** Agent handlers keyed by agent_type. */
const AGENT_HANDLERS: Record<
  string,
  (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
> = {
  ping: runPingAgent,
};

/**
 * Processes one task: claim → execute → submit.
 * Returns true when a task was processed, false when no task was available.
 */
export async function processOnce(
  overrides: {
    apiBaseUrl?: string;
    workerToken?: string;
    podId?: string;
    agentType?: string;
  } = {},
): Promise<boolean> {
  const apiBase = overrides.apiBaseUrl ?? API_BASE_URL;
  const token = overrides.workerToken ?? WORKER_TOKEN;
  const podId = overrides.podId ?? POD_ID;
  const agentType = overrides.agentType ?? AGENT_TYPE;

  // Claim via API
  const claimRes = await fetch(`${apiBase}/tasks/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ agent_type: agentType, pod_id: podId }),
  });

  if (claimRes.status === 204) return false;
  if (!claimRes.ok) {
    log('warn', 'claim_task_failed', {
      trace_id: '',
      status: claimRes.status,
      agent_type: agentType,
    });
    return false;
  }

  const task = (await claimRes.json()) as {
    id: string;
    agent_type: string;
    job_type: string;
    payload: Record<string, unknown>;
  };

  const traceId = crypto.randomUUID();
  log('info', 'task_claimed', {
    trace_id: traceId,
    task_id: task.id,
    agent_type: task.agent_type,
    job_type: task.job_type,
  });

  const handler = AGENT_HANDLERS[task.agent_type];
  if (!handler) {
    log('warn', 'unknown_agent_type', {
      trace_id: traceId,
      task_id: task.id,
      agent_type: task.agent_type,
    });
    return true;
  }

  let result: Record<string, unknown>;
  try {
    result = await handler(task.payload);
  } catch (err: unknown) {
    log('error', 'agent_handler_failed', {
      trace_id: traceId,
      task_id: task.id,
      agent_type: task.agent_type,
      error: String(err),
    });
    return true;
  }

  // Submit result via API
  const submitRes = await fetch(`${apiBase}/tasks/${task.id}/result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ result }),
  });

  const submitted = submitRes.ok;
  log('info', 'task_processed', {
    trace_id: traceId,
    task_id: task.id,
    agent_type: task.agent_type,
    submitted,
  });

  return true;
}

/**
 * Main worker loop. Polls the task queue for pending tasks and processes them
 * one at a time. Sleeps between polls when no task is available.
 */
async function run(): Promise<never> {
  log('info', 'worker_starting', {
    trace_id: '',
    pod_id: POD_ID,
    agent_type: AGENT_TYPE,
    poll_interval_ms: POLL_INTERVAL_MS,
    api_base_url: API_BASE_URL,
  });

  for (;;) {
    try {
      const processed = await processOnce();
      if (!processed) {
        await Bun.sleep(POLL_INTERVAL_MS);
      }
    } catch (err: unknown) {
      log('error', 'worker_loop_error', { trace_id: '', error: String(err) });
      await Bun.sleep(POLL_INTERVAL_MS);
    }
  }
}

run().catch((err: unknown) => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});

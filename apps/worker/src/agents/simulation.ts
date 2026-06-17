/**
 * Simulation Agent Worker (issue #262).
 *
 * Executes producer deal-simulation tasks inside an isolated digital twin
 * (WORKER-P-007) and returns a payout + dispute-risk forecast WITHOUT mutating
 * any production state. The forecast is produced by spawning the locally
 * installed `claude` CLI as a subprocess (runClaudeCli) — no outbound Anthropic
 * HTTP call is made by the worker.
 *
 * Execution flow (docs/arbitration-simulation.md — Simulation worker flow):
 *   1. The task payload carries the producer-authored context (deal / scenario
 *      terms + the producer's own plan version + fee-rate) resolved by the
 *      server under the producer's authority. The worker never connects to the
 *      DB (WORKER-X-001); it reasons over the payload context only — this IS the
 *      isolated digital twin: a self-contained projection of the deal that is
 *      discarded when the task returns.
 *   2. Build a structured prompt instructing the CLI to emit a JSON forecast.
 *   3. Spawn the `claude` CLI (bounded by a timeout); parse stdout into
 *      { payout_estimate, dispute_risk, reasoning }.
 *   4. On any CLI timeout / spawn / parse failure, return status 'error' so the
 *      task is marked failed and the UI falls back to "Simulation unavailable".
 *
 * Simulation is strictly read-only: it never creates or modifies a placement,
 * commission, or payout. The twin (the in-memory payload projection) is dropped
 * the moment this function returns.
 *
 * Canonical docs: docs/prd.md §5.9, §5.12, §9; docs/arbitration-simulation.md
 */

import { runClaudeCli, type ClaudeCliSpawn } from 'db';

/**
 * Simulation agent task payload.
 *
 * `kind` selects the scenario: an `actual` deal references a placement (deal_id)
 * with resolved deal_context; a `hypothetical` scenario carries scenario terms.
 * Both carry the producer's plan_context (plan version + fee rate) so the
 * forecast reasoning is traceable to it (PRD §9).
 */
export interface SimulationTaskPayload {
  /** Binds the forecast back to its simulation_run row. */
  simulation_run_id?: string;
  kind?: 'actual' | 'hypothetical';
  deal_id?: string;
  bonus_season_flag?: boolean;
  amount?: number;
  tier?: string;
  accrual_percent?: number;
  producer_id?: string;
  org_id?: string;
  client_id?: string;
  deal_context?: Record<string, unknown>;
  plan_context?: Record<string, unknown> | null;
  /** Single-use delegated token for POST /producer/simulations/:id/result. */
  result_token?: string;
}

/** The structured forecast schema the CLI must emit and the UI consumes. */
export interface SimulationForecast {
  payout_estimate: number;
  dispute_risk: string;
  reasoning: string;
}

/**
 * Simulation agent execution result.
 * On success, result_or_error is a SimulationForecast; on error it carries an
 * error message and the task is marked failed.
 */
export interface SimulationTaskResult {
  status: 'success' | 'error';
  result_or_error: {
    payout_estimate?: number;
    dispute_risk?: string;
    reasoning?: string;
    error?: string;
    /** True when the failure is transient and the producer may retry. */
    retriable?: boolean;
  };
}

/**
 * Build the CLI prompt from the digital-twin payload. The prompt instructs the
 * CLI to reason from the producer's OWN plan version and fee-rate structure and
 * to emit a single JSON object so the output is machine-parseable.
 */
export function buildSimulationPrompt(payload: SimulationTaskPayload): string {
  const planContext = payload.plan_context ?? {};
  const scenario =
    payload.kind === 'hypothetical'
      ? {
          kind: 'hypothetical',
          amount: payload.amount,
          tier: payload.tier,
          bonus_season_flag: payload.bonus_season_flag ?? false,
          accrual_percent: payload.accrual_percent,
        }
      : {
          kind: 'actual',
          deal_id: payload.deal_id,
          bonus_season_flag: payload.bonus_season_flag ?? false,
          deal_context: payload.deal_context ?? {},
        };

  return [
    'You are a commission forecasting assistant for a recruiting agency.',
    'Estimate the producer payout and dispute risk for the scenario below.',
    "Base your reasoning on the producer's own commission plan version and fee-rate structure provided in plan_context.",
    '',
    `plan_context: ${JSON.stringify(planContext)}`,
    `scenario: ${JSON.stringify(scenario)}`,
    '',
    'Respond with ONLY a single JSON object, no prose, of the exact shape:',
    '{"payout_estimate": <number>, "dispute_risk": "low"|"moderate"|"high", "reasoning": "<plain-language explanation referencing the plan version and fee rate>"}',
  ].join('\n');
}

/**
 * Parse the CLI stdout into the forecast schema. Tolerates the model wrapping
 * the JSON in code fences or surrounding prose by extracting the first JSON
 * object. Throws on malformed output so runClaudeCli maps it to 'parse_error'.
 */
export function parseSimulationForecast(rawStdout: string): SimulationForecast {
  const text = rawStdout.trim();
  // Extract the first {...} block (handles ```json fences / leading prose).
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON object found in CLI output');
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const payout = parsed['payout_estimate'];
  const risk = parsed['dispute_risk'];
  const reasoning = parsed['reasoning'];
  if (typeof payout !== 'number' || Number.isNaN(payout)) {
    throw new Error('payout_estimate must be a number');
  }
  if (typeof risk !== 'string' || risk.trim() === '') {
    throw new Error('dispute_risk must be a non-empty string');
  }
  if (typeof reasoning !== 'string' || reasoning.trim() === '') {
    throw new Error('reasoning must be a non-empty string');
  }
  return { payout_estimate: payout, dispute_risk: risk, reasoning };
}

/**
 * Execute a producer deal simulation task.
 *
 * @param taskId         - Task ID from the task queue.
 * @param payload        - Digital-twin payload (scenario + plan context).
 * @param _delegatedToken - Single-use token (the worker uses payload.result_token
 *                          for the delegated-result POST; this arg is retained for
 *                          signature parity with other agents).
 * @param spawn          - Optional injectable subprocess launcher (hermetic tests).
 * @returns Structured result ready for POST /producer/simulations/:id/result.
 */
export async function executeSimulationTask(
  taskId: string,
  payload: SimulationTaskPayload,
  _delegatedToken: string,
  spawn?: ClaudeCliSpawn,
): Promise<SimulationTaskResult> {
  try {
    const prompt = buildSimulationPrompt(payload);

    const cli = await runClaudeCli<SimulationForecast>({
      taskId,
      prompt,
      parse: parseSimulationForecast,
      ...(spawn ? { spawn } : {}),
    });

    if (cli.status === 'success' && cli.result) {
      return {
        status: 'success',
        result_or_error: {
          payout_estimate: cli.result.payout_estimate,
          dispute_risk: cli.result.dispute_risk,
          reasoning: cli.result.reasoning,
        },
      };
    }

    // Graceful failure: surface a stable message so the UI shows the fallback.
    return {
      status: 'error',
      result_or_error: {
        error: cli.error?.message ?? 'Simulation engine returned no result',
        retriable: cli.error?.retriable ?? false,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      result_or_error: { error: `Simulation task failed: ${errorMsg}`, retriable: false },
    };
  }
}

/**
 * Validate that a payload conforms to the expected simulation task shape.
 * Used at task-processing time to fail fast on malformed payloads.
 */
export function validateSimulationPayload(payload: unknown): payload is SimulationTaskPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const p = payload as Record<string, unknown>;

  const kind = p['kind'];
  if (kind === 'hypothetical') {
    return typeof p['amount'] === 'number' && typeof p['tier'] === 'string';
  }
  // Default / actual: a deal_id is required.
  if (typeof p['deal_id'] !== 'string') {
    return false;
  }
  if (p['bonus_season_flag'] !== undefined && typeof p['bonus_season_flag'] !== 'boolean') {
    return false;
  }
  if (p['producer_id'] !== undefined && typeof p['producer_id'] !== 'string') {
    return false;
  }
  return true;
}

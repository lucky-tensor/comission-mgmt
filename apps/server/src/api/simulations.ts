/**
 * Producer deal simulation API routes.
 *
 * The feature issue (#187) calls for actual/hypothetical simulation entrypoints
 * and producer-visible history. This scout only reserves the transport seam:
 * handlers exist, are routeable, and return 501 Not Implemented until the real
 * simulation pipeline is built.
 *
 * DORMANT_BY_DESIGN
 * depends_on: issue #262 (Producer Deal Simulator pipeline)
 * reason: The route handlers are reserved so the simulation request/result
 * contracts can be documented and integration-tested before the live enqueue
 * and delegated-result write paths are wired.
 * reviewed_at: 2026-06-17
 *
 * Canonical docs:
 *   - docs/prd.md §5.9
 *   - docs/prd.md §5.12
 *   - docs/arbitration-simulation.md
 * Issue: feat: Producer Deal Simulation — payout + dispute-risk forecasting (#262)
 */

import type { SessionClaims } from 'core/auth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notImplementedResponse(): Response {
  return jsonResponse({ error: 'Not Implemented' }, 501);
}

/**
 * POST /producer/simulations/actual — stub producer deal simulation entrypoint.
 */
export async function handleCreateActualSimulation(
  _req: Request,
  _claims: SessionClaims,
): Promise<Response> {
  return notImplementedResponse();
}

/**
 * POST /producer/simulations/hypothetical — stub hypothetical simulation entrypoint.
 */
export async function handleCreateHypotheticalSimulation(
  _req: Request,
  _claims: SessionClaims,
): Promise<Response> {
  return notImplementedResponse();
}

/**
 * GET /producer/simulations — stub producer simulation history entrypoint.
 */
export async function handleListMySimulations(
  _req: Request,
  _claims: SessionClaims,
): Promise<Response> {
  return notImplementedResponse();
}

/**
 * Structured forecast body the simulation worker submits back to the API via
 * the delegated single-use token (POST /producer/simulations/:id/result).
 * Mirrors SimulationTaskResult.result_or_error from the worker seam.
 */
export interface SimulationResultBody {
  predicted_commission: number;
  predicted_payout_schedule: Array<{ date: string; amount: number }>;
  risk_factors: string[];
}

/**
 * Validate the structured simulation result payload future workers will submit.
 * Used by integration tests and the future delegated-result handler to fail
 * fast on malformed forecasts.
 */
export function validateSimulationResultBody(payload: unknown): payload is SimulationResultBody {
  if (!payload || typeof payload !== 'object') return false;
  const body = payload as Record<string, unknown>;

  if (typeof body.predicted_commission !== 'number' || Number.isNaN(body.predicted_commission)) {
    return false;
  }
  if (
    !Array.isArray(body.predicted_payout_schedule) ||
    !body.predicted_payout_schedule.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).date === 'string' &&
        typeof (item as Record<string, unknown>).amount === 'number',
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(body.risk_factors) ||
    !body.risk_factors.every((item) => typeof item === 'string')
  ) {
    return false;
  }

  return true;
}

/**
 * POST /producer/simulations/:id/result — delegated single-use token result route.
 *
 * Worker-facing write path (Bearer delegated token, no session cookie), matching
 * the WORKER-P-002 writes-through-authenticated-api model used by
 * POST /tasks/:id/result and POST /disputes/:id/arbitration-result. The worker
 * executes the forecast in a digital twin, then submits the structured result
 * here using the single-use token minted at task creation.
 *
 * STUB (dev-scout #263): reserved and routeable; returns 501 until #262 wires
 * delegated-token validation, simulation_run.result_json persistence, and
 * single-use token invalidation.
 */
export async function handleSubmitSimulationResult(
  _simulationId: string,
  _req: Request,
): Promise<Response> {
  return notImplementedResponse();
}

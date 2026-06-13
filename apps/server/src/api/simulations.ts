/**
 * Producer deal simulation API routes.
 *
 * The feature issue (#187) calls for actual/hypothetical simulation entrypoints
 * and producer-visible history. This scout only reserves the transport seam:
 * handlers exist, are routeable, and return 501 Not Implemented until the real
 * simulation pipeline is built.
 *
 * Canonical docs:
 *   - docs/prd.md §5.9
 *   - docs/prd.md §5.12
 *   - docs/arbitration-simulation.md
 * Issue: feat: Producer Deal Simulation — payout + dispute-risk forecasting (#187)
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

/**
 * Dispute arbitration API seams.
 *
 * DORMANT_BY_DESIGN
 * depends_on: issue #186
 * reason: The route handlers are reserved so the dispute-arbitration contract
 * can be documented and tested before the live enqueue/result flow is wired.
 * reviewed_at: 2026-06-09
 *
 * Canonical docs: docs/arbitration-simulation.md, docs/architecture.md
 *
 * Route surface reserved for the future feature:
 *   POST /disputes/:id/arbitrate
 *   POST /disputes/:id/arbitration-result
 */

import type { SessionClaims } from 'core/auth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface ArbitrationResultBody {
  recommendation: string;
  reasoning: string;
  edge_cases: string[];
  payout_adjustment: number;
}

/**
 * Validate the structured arbitration result payload that future workers will submit.
 */
export function validateArbitrationResultBody(payload: unknown): payload is ArbitrationResultBody {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const body = payload as Record<string, unknown>;

  if (typeof body.recommendation !== 'string' || body.recommendation.trim() === '') return false;
  if (typeof body.reasoning !== 'string' || body.reasoning.trim() === '') return false;
  if (!Array.isArray(body.edge_cases) || !body.edge_cases.every((item) => typeof item === 'string')) {
    return false;
  }
  if (typeof body.payout_adjustment !== 'number' || Number.isNaN(body.payout_adjustment)) {
    return false;
  }

  return true;
}

/**
 * Reserved future handler for POST /disputes/:id/arbitrate.
 *
 * The live enqueue path is intentionally not wired yet. This stub keeps the
 * seam visible for integration tests and downstream feature work.
 */
export async function handleRequestDisputeArbitration(
  _disputeId: string,
  _req: Request,
  _claims: SessionClaims,
): Promise<Response> {
  return jsonResponse({ error: 'Not Implemented' }, 501);
}

/**
 * Reserved future handler for POST /disputes/:id/arbitration-result.
 *
 * The live result-submission path is intentionally not wired yet.
 */
export async function handleSubmitDisputeArbitrationResult(
  _disputeId: string,
  _req: Request,
  _claims: SessionClaims,
): Promise<Response> {
  return jsonResponse({ error: 'Not Implemented' }, 501);
}

/**
 * Simulation Agent Worker
 *
 * Stub implementation for producer deal simulation task execution.
 * This agent processes simulation requests in digital twins and returns
 * predicted outcomes without mutating production state.
 *
 * Phase: Arbitration & Simulation (dev-scout #188)
 * Canonical docs: docs/prd.md §5.9, docs/prd.md §5.12
 * Canonical: docs/arbitration-simulation.md — Simulation agent execution flow, WORKER-P-007
 *
 * STUB IMPLEMENTATION: Compiles and accepts task payloads. Does not invoke Claude API
 * or return actual predictions. Real feature (#187) will fill in the simulation logic.
 *
 * Expected payload shape for producer_deal_simulation job type:
 *   {
 *     "deal_id": "<UUID>",
 *     "bonus_season_flag": boolean
 *   }
 *
 * Return contract: { status: 'success' | 'error', result_or_error: any }
 *
 * Per WORKER-P-007 (simulation-in-digital-twins), simulation happens in isolated
 * digital twins, not on production. The worker requests a twin, executes the
 * simulation inside it, and returns predictions without mutation.
 */

import { type ClaudeApiContext } from 'db';
// Note: callClaudeAPI is not imported in this stub. Real feature (#187) will
// import callClaudeAPI and invoke it inside executeSimulationTask().

/**
 * Simulation agent task payload.
 * Fields are opaque references; business data is fetched via API at execution time.
 */
export interface SimulationTaskPayload {
  deal_id: string;
  bonus_season_flag: boolean;
  // Optional context fields (filled in at task creation)
  producer_id?: string;
  client_id?: string;
}

/**
 * Simulation agent execution result.
 * Returns predicted outcomes from the digital twin simulation.
 */
export interface SimulationTaskResult {
  status: 'success' | 'error';
  result_or_error: {
    predicted_commission?: number; // Projected commission amount (stub: placeholder)
    predicted_payout_schedule?: Array<{ date: string; amount: number }>; // Stub: placeholder
    risk_factors?: string[]; // Identified risks (stub: placeholder)
    error?: string; // Error message if status='error'
  };
}

/**
 * Execute a producer deal simulation task.
 *
 * This is the entrypoint for the simulation worker. It:
 * 1. Accepts a task ID and payload from the task queue view
 * 2. Requests a digital twin for this deal (isolated from production)
 * 3. Fetches deal and producer data via authenticated API
 * 4. Calls Claude to simulate deal outcomes
 * 5. Returns predictions without mutating production state
 *
 * STUB: Always returns { status: 'success', ... }. Real implementation (#187) will
 * call Claude API and return actual deal predictions from a digital twin.
 *
 * @param taskId - Task ID from task queue
 * @param payload - Opaque task payload (deal_id, bonus_season_flag, etc.)
 * @param delegatedToken - Single-use, task-scoped token for result submission
 * @returns Structured result ready for POST /producer/simulations/:id/result
 */
export async function executeSimulationTask(
  taskId: string,
  payload: SimulationTaskPayload,
  _delegatedToken: string,
): Promise<SimulationTaskResult> {
  try {
    console.log(
      `[simulation-worker] Executing task ${taskId} for deal ${payload.deal_id} (bonus_season=${payload.bonus_season_flag})`,
    );

    // STUB: Placeholder for real feature implementation.
    // Feature #187 will:
    // 1. Request a digital twin for this deal (isolated environment)
    // 2. Fetch deal and producer data via authenticated API
    // 3. Build Claude prompt from deal details and simulation context
    // 4. Call callClaudeAPI() with deal simulation prompt
    // 5. Parse Claude response into predicted outcomes
    // 6. Return predictions for submission via delegated token
    //
    // Per WORKER-P-007, simulation produces predictions and diffs, not mutations.
    // The twin is discarded after simulation. Promotion to live submission is a
    // separate, explicitly authorized step.

    const _context: ClaudeApiContext = {
      taskId,
      jobType: 'producer_simulation',
      correlationId: payload.deal_id,
    };

    console.log(
      `[simulation-worker] Task ${taskId}: would call Claude API for deal ${payload.deal_id}`,
    );
    // await callClaudeAPI(_context, '<deal simulation prompt>');

    const result: SimulationTaskResult = {
      status: 'success',
      result_or_error: {
        predicted_commission: 45000,
        predicted_payout_schedule: [
          { date: '2026-07-31', amount: 22500 },
          { date: '2026-08-31', amount: 22500 },
        ],
        risk_factors: ['[STUB] Placeholder risk factors from Claude'],
      },
    };

    console.log(`[simulation-worker] Task ${taskId} completed with status=${result.status}`);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[simulation-worker] Task ${taskId} failed:`, err);

    return {
      status: 'error',
      result_or_error: {
        error: `Simulation task failed: ${errorMsg}`,
      },
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

  // Required: deal_id and bonus_season_flag
  if (typeof p.deal_id !== 'string' || typeof p.bonus_season_flag !== 'boolean') {
    return false;
  }

  // Optional fields: producer_id, client_id (strings)
  if (p.producer_id !== undefined && typeof p.producer_id !== 'string') {
    return false;
  }

  if (p.client_id !== undefined && typeof p.client_id !== 'string') {
    return false;
  }

  return true;
}

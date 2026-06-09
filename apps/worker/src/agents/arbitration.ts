/**
 * Arbitration Agent Worker
 *
 * Stub implementation for dispute arbitration task execution.
 * This agent processes dispute arbitration tasks from the task queue and submits
 * results via the delegated token write path.
 *
 * Phase: Arbitration & Simulation (dev-scout #188)
 * Canonical: docs/arbitration-simulation.md — Arbitration agent execution flow
 *
 * STUB IMPLEMENTATION: Compiles and accepts task payloads. Does not invoke Claude API
 * or submit results. Real feature (#186) will fill in the dispute-resolution logic.
 *
 * Expected payload shape for arbitration_dispute job type:
 *   {
 *     "dispute_id": "<UUID>",
 *     "commission_record_id": "<UUID>",
 *     "contested_amount": number,
 *     "reason": string,
 *     "attachments": string[] (GCS object paths)
 *   }
 *
 * Return contract: { status: 'success' | 'error', result_or_error: any }
 */

import { type ClaudeApiContext } from 'db';
// Note: callClaudeAPI is not imported in this stub. Real feature (#186) will
// import callClaudeAPI and invoke it inside executeArbitrationTask().

/**
 * Arbitration agent task payload.
 * Fields are opaque references (IDs); business data is fetched via API at execution time.
 */
export interface ArbitrationTaskPayload {
  dispute_id: string;
  commission_record_id: string;
  contested_amount?: number; // Optional: additional context
  reason?: string; // Optional: additional context
  attachments?: string[]; // Optional: GCS paths to supporting documents
}

/**
 * Arbitration agent execution result.
 */
export interface ArbitrationTaskResult {
  status: 'success' | 'error';
  result_or_error: {
    dispute_resolution?: string; // Recommended resolution (stub: placeholder)
    confidence?: number; // Confidence score 0–1 (stub: placeholder)
    reasoning?: string; // Explanation (stub: placeholder)
    error?: string; // Error message if status='error'
  };
}

/**
 * Execute an arbitration task.
 *
 * This is the entrypoint for the arbitration worker. It:
 * 1. Accepts a task ID and payload from the task queue view
 * 2. Fetches full dispute and commission record data via authenticated API
 * 3. Calls Claude to generate dispute resolution recommendation
 * 4. Returns structured result for submission via delegated token write path
 *
 * STUB: Always returns { status: 'success', ... }. Real implementation (#186) will
 * call Claude API and return actual dispute analysis results.
 *
 * @param taskId - Task ID from task queue
 * @param payload - Opaque task payload (dispute_id, commission_record_id, etc.)
 * @param delegatedToken - Single-use, task-scoped token for result submission
 * @returns Structured result ready for POST /disputes/:id/arbitration-result
 */
export async function executeArbitrationTask(
  taskId: string,
  payload: ArbitrationTaskPayload,
  _delegatedToken: string,
): Promise<ArbitrationTaskResult> {
  try {
    console.log(`[arbitration-worker] Executing task ${taskId} for dispute ${payload.dispute_id}`);

    // STUB: Placeholder for real feature implementation.
    // Feature #186 will:
    // 1. Fetch full dispute and commission record via authenticated API
    // 2. Build Claude prompt from dispute details and attachments
    // 3. Call callClaudeAPI() with arbitration prompt
    // 4. Parse Claude response into structured result
    // 5. Return result for submission via delegated token

    // For now, return a stub success response
    const _context: ClaudeApiContext = {
      taskId,
      jobType: 'dispute_arbitration',
      correlationId: payload.dispute_id,
    };

    console.log(
      `[arbitration-worker] Task ${taskId}: would call Claude API for dispute ${payload.dispute_id}`,
    );
    // await callClaudeAPI(_context, '<dispute resolution prompt>');

    const result: ArbitrationTaskResult = {
      status: 'success',
      result_or_error: {
        dispute_resolution: '[STUB] Placeholder resolution recommendation',
        confidence: 0.85,
        reasoning: '[STUB] Placeholder reasoning from Claude',
      },
    };

    console.log(`[arbitration-worker] Task ${taskId} completed with status=${result.status}`);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[arbitration-worker] Task ${taskId} failed:`, err);

    return {
      status: 'error',
      result_or_error: {
        error: `Arbitration task failed: ${errorMsg}`,
      },
    };
  }
}

/**
 * Validate that a payload conforms to the expected arbitration task shape.
 * Used at task-processing time to fail fast on malformed payloads.
 */
export function validateArbitrationPayload(payload: unknown): payload is ArbitrationTaskPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const p = payload as Record<string, unknown>;

  // Required: dispute_id and commission_record_id
  if (typeof p.dispute_id !== 'string' || typeof p.commission_record_id !== 'string') {
    return false;
  }

  // Optional fields: contested_amount (number), reason (string), attachments (array)
  if (p.contested_amount !== undefined && typeof p.contested_amount !== 'number') {
    return false;
  }

  if (p.reason !== undefined && typeof p.reason !== 'string') {
    return false;
  }

  if (p.attachments !== undefined && !Array.isArray(p.attachments)) {
    return false;
  }

  return true;
}

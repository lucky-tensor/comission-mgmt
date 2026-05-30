/**
 * Ping agent handler.
 *
 * A no-op agent that proves the full claim-execute-submit loop works end-to-end.
 * The ping handler accepts any payload (references only, validated at enqueue time)
 * and returns a result containing a timestamp and echo of the input payload refs.
 *
 * Agent type: "ping"
 * Job type:   "ping" (or any)
 *
 * Result shape: { pong: true, echoed_payload: <input>, completed_at: <ISO string> }
 *
 * Used by:
 *   - E2E worker loop integration tests (acceptance criterion #6)
 *   - Smoke test for task queue infrastructure before real agents land in later phases
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, Worker Ping Agent
 */

/**
 * Executes the ping agent logic.
 *
 * @param payload - References-only payload from the task_queue row.
 * @returns Result object that will be persisted via POST /tasks/:id/result.
 */
export async function runPingAgent(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Simulate minimal async work (I/O placeholder — real agents do external calls)
  await Promise.resolve();

  return {
    pong: true,
    echoed_payload: payload,
    completed_at: new Date().toISOString(),
  };
}

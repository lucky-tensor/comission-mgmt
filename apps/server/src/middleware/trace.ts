/**
 * Trace ID middleware — server-side.
 *
 * Every incoming HTTP request gets a UUID v4 trace ID that is:
 *   1. Extracted from the incoming X-Trace-Id header (if present)
 *   2. Or freshly generated (crypto.randomUUID) if the header is absent
 *   3. Stored in a Bun AsyncLocalStorage context so all code in the
 *      request scope can retrieve it without threading it through every call
 *   4. Returned in the X-Trace-Id response header
 *   5. Included in all structured log lines as `trace_id`
 *
 * Architecture constraints:
 *   - UUID v4 format: ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
 *   - AsyncLocalStorage is the propagation mechanism (no thread-locals, no globals)
 *   - No console.log — all logging via packages/core/logger (structured JSON)
 *
 * Canonical docs: docs/architecture.md — Observability, Phase 1 Foundation
 * Blueprint rule: DEPLOY-P-003/P-004, DEPLOY-D-002/D-003
 */

import { AsyncLocalStorage } from 'async_hooks';

interface TraceContext {
  traceId: string;
}

/**
 * AsyncLocalStorage instance carrying the per-request trace context.
 * Exported for use in logging helpers and downstream middleware.
 */
export const traceStore = new AsyncLocalStorage<TraceContext>();

/**
 * Returns the trace ID for the current async context.
 * Returns an empty string when called outside a request handler
 * (e.g., during startup or in non-request async paths).
 */
export function getCurrentTraceId(): string {
  return traceStore.getStore()?.traceId ?? '';
}

/**
 * Wraps a Bun.serve fetch handler with trace-ID middleware.
 *
 * Middleware responsibilities:
 *   1. Read X-Trace-Id from the request header; generate UUID v4 if absent.
 *   2. Run the handler inside an AsyncLocalStorage context carrying { traceId }.
 *   3. Inject the X-Trace-Id header into the response before returning.
 *
 * @example
 * ```ts
 * import { withTraceId, getCurrentTraceId } from './middleware/trace';
 *
 * Bun.serve({
 *   fetch: withTraceId(async (req) => {
 *     const traceId = getCurrentTraceId();
 *     return new Response(`Trace: ${traceId}`);
 *   }),
 * });
 * ```
 */
export function withTraceId(
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    // Extract existing trace ID or generate a fresh UUID v4.
    const traceId = req.headers.get('X-Trace-Id') ?? crypto.randomUUID();
    const ctx: TraceContext = { traceId };

    // Execute the handler inside the AsyncLocalStorage context.
    const response = await new Promise<Response>((resolve, reject) => {
      traceStore.run(ctx, () => {
        Promise.resolve(handler(req)).then(resolve, reject);
      });
    });

    // Inject the trace ID into the response header so callers can correlate logs.
    const headers = new Headers(response.headers);
    headers.set('X-Trace-Id', traceId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

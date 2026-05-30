/**
 * Unit tests — Trace ID middleware.
 *
 * Acceptance criteria (issue #29):
 *   - UUID v4 is generated per request when X-Trace-Id header is absent
 *   - Existing X-Trace-Id is forwarded unchanged
 *   - The trace ID is stored in AsyncLocalStorage and accessible via getCurrentTraceId()
 *   - The X-Trace-Id response header contains a valid UUID v4
 *
 * UUID v4 regex: ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
 */

import { describe, it, expect } from 'vitest';
import { withTraceId, getCurrentTraceId, traceStore } from '../../src/middleware/trace';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost/healthz', {
    headers: headers ?? {},
  });
}

// ---------------------------------------------------------------------------
// withTraceId — UUID generation
// ---------------------------------------------------------------------------

describe('withTraceId', () => {
  it('generates a UUID v4 when X-Trace-Id header is absent', async () => {
    let capturedTraceId = '';

    const handler = withTraceId(async () => {
      capturedTraceId = getCurrentTraceId();
      return new Response('ok');
    });

    const res = await handler(makeRequest());

    expect(capturedTraceId).toMatch(UUID_V4_RE);
    expect(res.headers.get('X-Trace-Id')).toMatch(UUID_V4_RE);
    expect(res.headers.get('X-Trace-Id')).toBe(capturedTraceId);
  });

  it('generates a different UUID v4 for each request', async () => {
    const ids: string[] = [];

    const handler = withTraceId(async () => {
      ids.push(getCurrentTraceId());
      return new Response('ok');
    });

    await handler(makeRequest());
    await handler(makeRequest());
    await handler(makeRequest());

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // all distinct
    ids.forEach((id) => expect(id).toMatch(UUID_V4_RE));
  });

  it('propagates an existing X-Trace-Id header unchanged', async () => {
    const existing = '123e4567-e89b-4d3c-a456-426614174000';
    let capturedTraceId = '';

    const handler = withTraceId(async () => {
      capturedTraceId = getCurrentTraceId();
      return new Response('ok');
    });

    const res = await handler(makeRequest({ 'X-Trace-Id': existing }));

    expect(capturedTraceId).toBe(existing);
    expect(res.headers.get('X-Trace-Id')).toBe(existing);
  });

  it('sets X-Trace-Id on the response even when the inner handler sets other headers', async () => {
    const handler = withTraceId(async () => {
      return new Response('ok', {
        headers: { 'Content-Type': 'text/plain', 'X-Custom': 'value' },
      });
    });

    const res = await handler(makeRequest());

    expect(res.headers.get('X-Trace-Id')).toMatch(UUID_V4_RE);
    expect(res.headers.get('Content-Type')).toBe('text/plain');
    expect(res.headers.get('X-Custom')).toBe('value');
  });

  it('preserves the response status code', async () => {
    const handler = withTraceId(async () => {
      return new Response('not found', { status: 404 });
    });

    const res = await handler(makeRequest());

    expect(res.status).toBe(404);
    expect(res.headers.get('X-Trace-Id')).toMatch(UUID_V4_RE);
  });
});

// ---------------------------------------------------------------------------
// getCurrentTraceId — AsyncLocalStorage context
// ---------------------------------------------------------------------------

describe('getCurrentTraceId', () => {
  it('returns empty string outside a request context', () => {
    // Called outside withTraceId — the store has no value.
    expect(getCurrentTraceId()).toBe('');
  });

  it('returns the trace ID from the current AsyncLocalStorage context', async () => {
    const traceId = crypto.randomUUID();
    let result = '';

    await new Promise<void>((resolve) => {
      traceStore.run({ traceId }, () => {
        result = getCurrentTraceId();
        resolve();
      });
    });

    expect(result).toBe(traceId);
  });

  it('is isolated between concurrent requests', async () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();

    const [r1, r2] = await Promise.all([
      new Promise<string>((resolve) => {
        traceStore.run({ traceId: id1 }, () => {
          // Simulate async work within the same context
          setTimeout(() => resolve(getCurrentTraceId()), 10);
        });
      }),
      new Promise<string>((resolve) => {
        traceStore.run({ traceId: id2 }, () => {
          setTimeout(() => resolve(getCurrentTraceId()), 5);
        });
      }),
    ]);

    expect(r1).toBe(id1);
    expect(r2).toBe(id2);
  });
});

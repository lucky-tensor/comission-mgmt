/**
 * Unit tests for apps/server/src/security/rate-limiter.ts
 *
 * Tests: rate-limits a burst within the sliding window.
 * No database required — in-memory store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../../src/security/rate-limiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    delete process.env.RATE_LIMIT_DISABLED;
    // 3 requests per 60-second window for testing
    limiter = new RateLimiter(60_000, 3);
    limiter.reset();
  });

  it('allows requests under the limit', () => {
    const r1 = limiter.check('client-1');
    expect(r1.allowed).toBe(true);
    limiter.consume('client-1');

    const r2 = limiter.check('client-1');
    expect(r2.allowed).toBe(true);
    limiter.consume('client-1');

    const r3 = limiter.check('client-1');
    expect(r3.allowed).toBe(true);
  });

  it('blocks requests that exceed the limit', () => {
    // Consume all 3 slots
    for (let i = 0; i < 3; i++) {
      limiter.consume('burst-client');
    }

    const result = limiter.check('burst-client');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('rate-limits a burst correctly', () => {
    const key = 'burst-test';

    // Simulate a burst of 5 requests
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const r = limiter.check(key);
      results.push(r.allowed);
      if (r.allowed) {
        limiter.consume(key);
      }
    }

    // First 3 should be allowed, remaining 2 should be blocked
    expect(results.filter(Boolean).length).toBe(3);
    expect(results.filter((x) => !x).length).toBe(2);
  });

  it('allows requests for independent client keys', () => {
    // Exhaust client-a
    for (let i = 0; i < 3; i++) {
      limiter.consume('client-a');
    }
    expect(limiter.check('client-a').allowed).toBe(false);

    // client-b is unaffected
    expect(limiter.check('client-b').allowed).toBe(true);
  });

  it('bypasses limits when RATE_LIMIT_DISABLED=true', () => {
    process.env.RATE_LIMIT_DISABLED = 'true';
    const testLimiter = new RateLimiter(60_000, 1);

    // Should always be allowed regardless of consumption
    for (let i = 0; i < 10; i++) {
      testLimiter.consume('any');
    }
    const result = testLimiter.check('any');
    expect(result.allowed).toBe(true);

    delete process.env.RATE_LIMIT_DISABLED;
  });

  it('returns correct limit and remaining counts', () => {
    limiter.consume('count-test');
    limiter.consume('count-test');

    const result = limiter.check('count-test');
    expect(result.limit).toBe(3);
    // 2 consumed, checking 1 more: remaining = 3 - 2 - 1 = 0
    expect(result.remaining).toBe(0);
    expect(result.allowed).toBe(true);
  });
});

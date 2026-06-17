/**
 * Producer Deal Simulator — server-side unit tests (issue #262).
 *
 * Covers the no-DB-touching paths only (the full enqueue + delegated-result
 * flow is exercised against real Postgres in the simulations integration suite,
 * vitest.simulations.config.ts):
 *   - the result payload validator (new { payout_estimate, dispute_risk, reasoning }
 *     schema)
 *   - the delegated-result route's auth guards that short-circuit before any DB
 *     access (missing Bearer token → 401; malformed token → 403)
 */

import { describe, expect, test } from 'vitest';
import {
  handleSubmitSimulationResult,
  validateSimulationResultBody,
} from '../../src/api/simulations';

describe('simulation result payload validator', () => {
  test('accepts the documented forecast shape', () => {
    expect(
      validateSimulationResultBody({
        payout_estimate: 45000,
        dispute_risk: 'moderate',
        reasoning: 'Plan v3 25% gross-fee rate on the $180,000 fee.',
      }),
    ).toBe(true);
  });

  test('rejects malformed payloads', () => {
    expect(validateSimulationResultBody({ payout_estimate: 1 })).toBe(false);
    expect(
      validateSimulationResultBody({
        payout_estimate: 'not-a-number',
        dispute_risk: 'low',
        reasoning: 'x',
      }),
    ).toBe(false);
    expect(
      validateSimulationResultBody({ payout_estimate: 100, dispute_risk: '', reasoning: 'x' }),
    ).toBe(false);
    expect(
      validateSimulationResultBody({ payout_estimate: 100, dispute_risk: 'low', reasoning: '' }),
    ).toBe(false);
  });
});

describe('delegated-result route auth guards (no DB access)', () => {
  test('missing Bearer token returns 401', async () => {
    const res = await handleSubmitSimulationResult(
      crypto.randomUUID(),
      new Request('http://test/producer/simulations/x/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payout_estimate: 1, dispute_risk: 'low', reasoning: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test('malformed Bearer token returns 403', async () => {
    const res = await handleSubmitSimulationResult(
      crypto.randomUUID(),
      new Request('http://test/producer/simulations/x/result', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer not.a.jwt',
        },
        body: JSON.stringify({ payout_estimate: 1, dispute_risk: 'low', reasoning: 'x' }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

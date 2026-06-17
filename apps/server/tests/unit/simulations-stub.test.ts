/**
 * Producer Deal Simulator API seam tests — dev-scout #263.
 *
 * Verifies the reserved route contract (actual/hypothetical/history + the
 * delegated single-use token result route) and the result payload validator
 * without wiring the live simulation pipeline (delivered by #262).
 */

import { describe, expect, test } from 'vitest';
import type { SessionClaims } from 'core/auth';
import {
  handleCreateActualSimulation,
  handleCreateHypotheticalSimulation,
  handleListMySimulations,
  handleSubmitSimulationResult,
  validateSimulationResultBody,
} from '../../src/api/simulations';

const claims: SessionClaims = {
  org_id: crypto.randomUUID(),
  user_id: crypto.randomUUID(),
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function makeRequest(body?: unknown): Request {
  return new Request('http://test/producer/simulations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('simulation result payload validator', () => {
  test('accepts the documented forecast shape', () => {
    expect(
      validateSimulationResultBody({
        predicted_commission: 45000,
        predicted_payout_schedule: [
          { date: '2026-07-31', amount: 22500 },
          { date: '2026-08-31', amount: 22500 },
        ],
        risk_factors: ['Bonus-season tier rollback risk'],
      }),
    ).toBe(true);
  });

  test('rejects malformed payloads', () => {
    expect(validateSimulationResultBody({ predicted_commission: 1 })).toBe(false);
    expect(
      validateSimulationResultBody({
        predicted_commission: 'not-a-number',
        predicted_payout_schedule: [],
        risk_factors: [],
      }),
    ).toBe(false);
    expect(
      validateSimulationResultBody({
        predicted_commission: 100,
        predicted_payout_schedule: [{ date: '2026-07-31' }],
        risk_factors: [],
      }),
    ).toBe(false);
  });
});

describe('producer simulation route seams', () => {
  test('reserved POST /producer/simulations/actual handler returns Not Implemented', async () => {
    const response = await handleCreateActualSimulation(makeRequest(), claims);
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ error: 'Not Implemented' });
  });

  test('reserved POST /producer/simulations/hypothetical handler returns Not Implemented', async () => {
    const response = await handleCreateHypotheticalSimulation(makeRequest(), claims);
    expect(response.status).toBe(501);
  });

  test('reserved GET /producer/simulations handler returns Not Implemented', async () => {
    const response = await handleListMySimulations(makeRequest(), claims);
    expect(response.status).toBe(501);
  });

  test('reserved POST /producer/simulations/:id/result handler returns Not Implemented', async () => {
    const response = await handleSubmitSimulationResult(
      crypto.randomUUID(),
      makeRequest({
        predicted_commission: 45000,
        predicted_payout_schedule: [{ date: '2026-07-31', amount: 45000 }],
        risk_factors: [],
      }),
    );
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ error: 'Not Implemented' });
  });
});

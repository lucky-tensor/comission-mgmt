/**
 * Producer simulation API stub tests — issue #187.
 *
 * These tests verify the transport seam only:
 *   - the producer simulation routes exist
 *   - they return 501 Not Implemented for now
 *   - the shared contract types compile from packages/core
 *
 * Canonical docs: docs/prd.md §5.8, docs/arbitration-simulation.md
 * Issue: dev-scout: stub Producer Deal Simulation integration seams (#187)
 */

import { describe, expect, test } from 'vitest';
import type { SessionClaims } from 'core/auth';
import type {
  ActualDealSimulationRequest,
  HypotheticalDealSimulationRequest,
  SimulationRunHistoryResponse,
  DealSimulationForecast,
} from 'core/producer-simulation';
import {
  handleCreateActualSimulation,
  handleCreateHypotheticalSimulation,
  handleListMySimulations,
} from '../../../apps/server/src/api/simulations';

const producerClaims: SessionClaims = {
  org_id: crypto.randomUUID(),
  user_id: crypto.randomUUID(),
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function makeRequest(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('producer simulation API stubs', () => {
  test('POST /producer/simulations/actual returns 501 Not Implemented', async () => {
    const body: ActualDealSimulationRequest = { deal_id: crypto.randomUUID() };
    const res = await handleCreateActualSimulation(
      makeRequest('/producer/simulations/actual', body),
      producerClaims,
    );
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'Not Implemented' });
  });

  test('POST /producer/simulations/hypothetical returns 501 Not Implemented', async () => {
    const body: HypotheticalDealSimulationRequest = {
      amount: 125000,
      tier: 'Gold',
      bonus_season_flag: true,
      accrual_percent: 0.12,
    };
    const res = await handleCreateHypotheticalSimulation(
      makeRequest('/producer/simulations/hypothetical', body),
      producerClaims,
    );
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'Not Implemented' });
  });

  test('GET /producer/simulations returns 501 Not Implemented', async () => {
    const res = await handleListMySimulations(makeRequest('/producer/simulations'), producerClaims);
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'Not Implemented' });
  });
});

describe('producer simulation contract types', () => {
  test('shared forecast type remains compile-safe', () => {
    const forecast: DealSimulationForecast = {
      payout_estimate: 42000,
      dispute_risk: 'moderate',
      reasoning: 'Stub forecast shape for the future simulation pipeline.',
    };

    const history: SimulationRunHistoryResponse = {
      simulation_runs: [
        {
          id: crypto.randomUUID(),
          producer_id: crypto.randomUUID(),
          org_id: crypto.randomUUID(),
          job_id: crypto.randomUUID(),
          input_params: { deal_id: crypto.randomUUID() },
          result_json: forecast,
          created_at: new Date().toISOString(),
          ttl_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    };

    expect(history.simulation_runs[0]?.result_json).toEqual(forecast);
  });
});

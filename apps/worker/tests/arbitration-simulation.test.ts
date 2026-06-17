/**
 * Arbitration and simulation worker stub tests — issue #188.
 *
 * These tests only verify the seam:
 *   - payload validators accept the expected shapes
 *   - the worker entrypoints return the documented structured result
 *   - no real Claude integration or production writes are performed
 */

import { describe, expect, test } from 'vitest';
import {
  executeArbitrationTask,
  validateArbitrationPayload,
  type ArbitrationTaskPayload,
} from '../src/agents/arbitration';
import { validateSimulationPayload, type SimulationTaskPayload } from '../src/agents/simulation';

describe('arbitration worker stub', () => {
  test('validateArbitrationPayload accepts the documented task shape', () => {
    const payload: ArbitrationTaskPayload = {
      dispute_id: crypto.randomUUID(),
      commission_record_id: crypto.randomUUID(),
      contested_amount: 1200,
      reason: 'Split disagreement',
      attachments: ['gs://supporting-docs/a.pdf'],
    };

    expect(validateArbitrationPayload(payload)).toBe(true);
    expect(validateArbitrationPayload({ dispute_id: payload.dispute_id })).toBe(false);
  });

  test('executeArbitrationTask returns the documented stub response', async () => {
    const result = await executeArbitrationTask(
      crypto.randomUUID(),
      {
        dispute_id: crypto.randomUUID(),
        commission_record_id: crypto.randomUUID(),
      },
      'delegated-token-stub',
    );

    expect(result.status).toBe('success');
    expect(result.result_or_error).toMatchObject({
      dispute_resolution: expect.any(String),
      confidence: expect.any(Number),
      reasoning: expect.any(String),
    });
  });
});

describe('simulation worker', () => {
  test('validateSimulationPayload accepts the documented task shapes', () => {
    const actual: SimulationTaskPayload = {
      deal_id: crypto.randomUUID(),
      bonus_season_flag: true,
      producer_id: crypto.randomUUID(),
    };
    expect(validateSimulationPayload(actual)).toBe(true);

    const hypothetical: SimulationTaskPayload = {
      kind: 'hypothetical',
      amount: 50000,
      tier: 'standard',
    };
    expect(validateSimulationPayload(hypothetical)).toBe(true);

    // Missing deal_id (and not hypothetical) is rejected.
    expect(validateSimulationPayload({ bonus_season_flag: false })).toBe(false);
  });
});

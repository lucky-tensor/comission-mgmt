/**
 * Dispute arbitration API seam tests — issue #186.
 *
 * Verifies the reserved route contract and the result payload validator without
 * wiring the live enqueue/result workflow into the server router.
 */

import { describe, expect, test } from 'vitest';
import type { SessionClaims } from 'core/auth';
import {
  handleRequestDisputeArbitration,
  handleSubmitDisputeArbitrationResult,
  validateArbitrationResultBody,
} from '../../src/api/dispute-arbitration';

const claims: SessionClaims = {
  org_id: crypto.randomUUID(),
  user_id: crypto.randomUUID(),
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function makeRequest(body?: unknown): Request {
  return new Request('http://test/disputes/test/arbitration-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('arbitration result payload validator', () => {
  test('accepts the documented recommendation shape', () => {
    expect(
      validateArbitrationResultBody({
        recommendation: 'approve_partial',
        reasoning: 'Commission rules support a reduced payout after review.',
        edge_cases: ['Overlapping contributor evidence'],
        payout_adjustment: -1250,
      }),
    ).toBe(true);
  });

  test('rejects malformed payloads', () => {
    expect(validateArbitrationResultBody({ recommendation: 'approve_partial' })).toBe(false);
    expect(
      validateArbitrationResultBody({
        recommendation: ' ',
        reasoning: 'missing recommendation',
        edge_cases: [],
        payout_adjustment: 0,
      }),
    ).toBe(false);
  });
});

describe('dispute arbitration route seams', () => {
  test('reserved POST /disputes/:id/arbitrate handler returns Not Implemented', async () => {
    const response = await handleRequestDisputeArbitration(
      crypto.randomUUID(),
      makeRequest(),
      claims,
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ error: 'Not Implemented' });
  });

  test('reserved POST /disputes/:id/arbitration-result handler returns Not Implemented', async () => {
    const response = await handleSubmitDisputeArbitrationResult(
      crypto.randomUUID(),
      makeRequest({
        recommendation: 'reject',
        reasoning: 'Stub response',
        edge_cases: [],
        payout_adjustment: 0,
      }),
      claims,
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ error: 'Not Implemented' });
  });
});

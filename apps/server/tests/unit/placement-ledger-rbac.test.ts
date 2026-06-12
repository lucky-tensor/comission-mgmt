import { describe, expect, test } from 'vitest';
import type { SessionClaims } from 'core/auth';
import {
  handleCreatePlacement,
  handleListPlacementLedger,
  handleUpdatePlacement,
} from '../../src/api/placements';

function claims(role: SessionClaims['role']): SessionClaims {
  return {
    org_id: crypto.randomUUID(),
    user_id: crypto.randomUUID(),
    role,
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

describe('placement ledger RBAC', () => {
  test.each(['Producer', 'ExternalPartner'] as const)(
    '%s cannot view the placement ledger',
    async (role) => {
      const response = await handleListPlacementLedger(claims(role));
      expect(response.status).toBe(403);
    },
  );

  test('Producer cannot create a placement', async () => {
    const request = new Request('http://localhost/placements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await handleCreatePlacement(request, claims('Producer'));
    expect(response.status).toBe(403);
  });

  test('Executive cannot edit a placement', async () => {
    const request = new Request(`http://localhost/placements/${crypto.randomUUID()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Active' }),
    });
    const response = await handleUpdatePlacement(crypto.randomUUID(), request, claims('Executive'));
    expect(response.status).toBe(403);
  });
});

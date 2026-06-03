/**
 * E2E External Partner seed (Bun runtime helper, NOT a test file).
 *
 * Seeds two placements into the ephemeral Postgres after the server is up:
 *
 *   1. seedPartnerFlow():
 *       a. Create a placement where the External Partner holds a split
 *          contributor role (CandidateOwner, 100%) — this is the own-deal the
 *          partner must see.
 *       b. Create an unrelated placement credited only to the Producer persona
 *          — the partner must NOT see this placement when calling
 *          GET /partner/placements.
 *
 * Both placements are flipped to Active via a direct DB write (same pattern as
 * seed-producer.ts) so GET /partner/placements returns them.
 *
 * Encryption: fee_amount is encrypted by the server process, so seeding goes
 * through the real HTTP API (ApiSession) so the server's process-local DEK
 * encrypts it and can later decrypt it for the partner read.
 *
 * The seeded partner placement ID is written to the shared .e2e-fixture.json
 * file (via global-setup.ts) so the browser-side test can assert by ID.
 *
 * Issue: test: E2E — External Partner payout visibility and scope enforcement (#121)
 */

import postgres from 'postgres';
import { SEEDED, PARTNER } from './ids';

export { SEEDED, PARTNER } from './ids';

/** Minimal HTTP session helper (mirrors ApiSession in seed-producer.ts). */
class ApiSession {
  private cookie = '';
  constructor(private readonly base: string) {}

  async login(userId: string): Promise<void> {
    const res = await fetch(`${this.base}/demo/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) throw new Error(`demo login failed: ${res.status}`);
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) throw new Error('demo login returned no cookie');
    this.cookie = setCookie.split(';')[0];
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: this.cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}

export interface PartnerFixture {
  /** The placement ID the partner has a split on (must appear in /partner/placements). */
  partnerPlacementId: string;
  /** An unrelated placement the partner must NOT see. */
  unrelatedPlacementId: string;
}

/**
 * Seeds the External Partner E2E fixture via the running server.
 *
 * @param baseUrl     Server root without /api prefix (e.g. http://localhost:31999).
 * @param databaseUrl Postgres URL — used only for direct status flip.
 */
export async function seedPartnerFlow(
  baseUrl: string,
  databaseUrl: string,
): Promise<PartnerFixture> {
  const api = new ApiSession(baseUrl);
  await api.login(SEEDED.adminId);

  // ── 1. Plan for the External Partner ────────────────────────────────────
  const { plan, version } = await api.post<{ plan: { id: string }; version: { id: string } }>(
    '/plans',
    {
      name: `E2E Partner Plan ${Date.now()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.3 },
    },
  );
  await api.post(`/plans/${plan.id}/versions/${version.id}/activate`);
  await api.post(`/plans/${plan.id}/assignments`, {
    producer_id: SEEDED.partnerId,
    plan_version_id: version.id,
  });

  // ── 2. Partner's own placement (with split) ──────────────────────────────
  const { id: partnerPlacementId } = await api.post<{ id: string }>('/placements', {
    candidate_id: crypto.randomUUID(),
    client_entity_id: crypto.randomUUID(),
    job_title: 'E2E Partner Deal',
    compensation_base: '100000',
    fee_amount: PARTNER.feeAmount,
    start_date: PARTNER.startDate,
    guarantee_days: null,
  });

  // ── 3. Unrelated placement — only the Producer is credited ──────────────
  const { id: unrelatedPlacementId } = await api.post<{ id: string }>('/placements', {
    candidate_id: crypto.randomUUID(),
    client_entity_id: crypto.randomUUID(),
    job_title: 'E2E Unrelated Deal',
    compensation_base: '90000',
    fee_amount: '7500',
    start_date: '2025-04-01',
    guarantee_days: null,
  });

  // Flip both placements to Active via a direct DB write.
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = ANY($1)`, [
      [partnerPlacementId, unrelatedPlacementId],
    ]);
  } finally {
    await sql.end({ timeout: 5 });
  }

  // ── 4. Add the External Partner as a contributor on the partner placement ─
  await api.post(`/placements/${partnerPlacementId}/contributors`, {
    producer_id: SEEDED.partnerId,
    role: 'CandidateOwner',
    split_pct: 1.0,
  });

  // ── 5. Add only the Producer to the unrelated placement ──────────────────
  await api.post(`/placements/${unrelatedPlacementId}/contributors`, {
    producer_id: SEEDED.producerId,
    role: 'CandidateOwner',
    split_pct: 1.0,
  });

  return { partnerPlacementId, unrelatedPlacementId };
}

/**
 * E2E producer-persona seed (Bun runtime helper, NOT a test file).
 *
 * Field-level encryption uses a per-process random DEK (FieldEncryptor caches
 * it in memory; it is never persisted in a form another process can reuse), so
 * encrypted columns can only be decrypted by the SAME process that wrote them.
 * The seed therefore runs in two phases:
 *
 *   1. migrateAndSeedIdentities() — pre-server, direct DB writes of the
 *      unencrypted identity rows (org, Producer + FinanceAdmin users and their
 *      memberships) plus schema migration.
 *   2. seedViaHttp() — AFTER the server is up, drives the real HTTP API as the
 *      admin (demo login → create plan/placement/contributors → calculate →
 *      approve a commission run) so every encrypted value is written by the
 *      server process and is decryptable by the `/me/*` reads the test makes.
 *
 * The fixed producer id (ids.ts) lets the test demo-login as exactly this user
 * so the `/me/*` reads (scoped to contributor_id = user_id) return the data.
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import postgres from 'postgres';
import { migrate } from 'db/index';
import { SEEDED } from './ids';

export { SEEDED } from './ids';

/** Phase 1: migrate the schema and insert the (unencrypted) identity rows. */
export async function migrateAndSeedIdentities(databaseUrl: string): Promise<void> {
  await migrate({ databaseUrl, auditDatabaseUrl: databaseUrl, analyticsDatabaseUrl: null });
  const sql = postgres(databaseUrl, { max: 2 });
  try {
    await sql.unsafe(`INSERT INTO orgs (id, name) VALUES ('${SEEDED.orgId}', 'E2E Demo Org')
                      ON CONFLICT (id) DO NOTHING`);
    await sql.unsafe(`INSERT INTO users (id, email, display_name)
                      VALUES ('${SEEDED.producerId}', '${SEEDED.producerEmail}', 'E2E Producer')
                      ON CONFLICT (id) DO NOTHING`);
    await sql.unsafe(`INSERT INTO users (id, email, display_name)
                      VALUES ('${SEEDED.adminId}', 'e2e-admin@demo.example', 'E2E Finance Admin')
                      ON CONFLICT (id) DO NOTHING`);
    await sql.unsafe(`INSERT INTO users (id, email, display_name)
                      VALUES ('${SEEDED.executiveId}', '${SEEDED.executiveEmail}', 'E2E Executive')
                      ON CONFLICT (id) DO NOTHING`);
    await sql.unsafe(`INSERT INTO org_memberships (user_id, org_id, role)
                      VALUES ('${SEEDED.producerId}', '${SEEDED.orgId}', 'Producer')
                      ON CONFLICT (user_id, org_id) DO NOTHING`);
    await sql.unsafe(`INSERT INTO org_memberships (user_id, org_id, role)
                      VALUES ('${SEEDED.adminId}', '${SEEDED.orgId}', 'FinanceAdmin')
                      ON CONFLICT (user_id, org_id) DO NOTHING`);
    await sql.unsafe(`INSERT INTO org_memberships (user_id, org_id, role)
                      VALUES ('${SEEDED.executiveId}', '${SEEDED.orgId}', 'Executive')
                      ON CONFLICT (user_id, org_id) DO NOTHING`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Minimal HTTP client that carries the admin session cookie. */
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

/**
 * Phase 2: seed the producer's encrypted commission data through the running
 * server's real API. `baseUrl` is the server root (no /api prefix);
 * `databaseUrl` is used only to flip the placement to Active (status column is
 * not encrypted, so a direct write is safe and avoids needing an extra route).
 */
export async function seedViaHttp(baseUrl: string, databaseUrl: string): Promise<typeof SEEDED> {
  const api = new ApiSession(baseUrl);
  await api.login(SEEDED.adminId);

  // Active plan assigned to the producer (drives tier progress + tier rate).
  const { plan, version } = await api.post<{ plan: { id: string }; version: { id: string } }>(
    '/plans',
    {
      name: `E2E Plan ${Date.now()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.25 },
    },
  );
  await api.post(`/plans/${plan.id}/versions/${version.id}/activate`);
  await api.post(`/plans/${plan.id}/assignments`, {
    producer_id: SEEDED.producerId,
    plan_version_id: version.id,
  });

  // Placement crediting the producer.
  const { id: placementId } = await api.post<{ id: string }>('/placements', {
    candidate_id: crypto.randomUUID(),
    client_entity_id: crypto.randomUUID(),
    job_title: 'Senior Recruiter',
    compensation_base: '120000',
    fee_amount: '20000',
    start_date: '2025-04-01',
    guarantee_days: null,
  });

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);
  } finally {
    await sql.end({ timeout: 5 });
  }

  await api.post(`/placements/${placementId}/contributors`, {
    producer_id: SEEDED.producerId,
    role: 'CandidateOwner',
    split_pct: 1.0,
  });

  // Calculate commission records (server-process encryption).
  const { commission_records } = await api.post<{ commission_records: Array<{ id: string }> }>(
    `/placements/${placementId}/calculate`,
  );

  // Approve a commission run so GET /me/payouts returns the producer's payout.
  const { id: runId } = await api.post<{ id: string }>('/commission-runs', {
    period_start: '2025-04-01',
    period_end: '2025-04-30',
    placement_ids: [placementId],
  });
  for (const rec of commission_records) {
    await api.post(`/commission-runs/${runId}/records/${rec.id}/approve`);
  }
  await api.post(`/commission-runs/${runId}/approve`);

  return SEEDED;
}

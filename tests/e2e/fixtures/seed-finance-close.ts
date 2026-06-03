/**
 * E2E finance-close seed (Bun runtime helper, NOT a test file).
 *
 * Bootstraps the data required for the Finance Admin month-end close E2E:
 *
 *   1. migrateAndSeedIdentities() — already called by global-setup; this seed
 *      reuses the same identities (adminId + producerId from ids.ts).
 *
 *   2. seedFinanceClose() — called via HTTP AFTER the server is up:
 *       a. Create an INCOMPLETE placement (missing fee_amount) so the
 *          data-gap queue has at least one item.
 *       b. Create a COMPLETE placement, calculate commissions, start a run,
 *          individually-approve every record, and batch-approve the run so
 *          the CommissionRunReview surface has a real approved run to finalize.
 *       c. Create a ledger invoice for the complete placement
 *          (POST /invoices) so the reconciliation report has a ledger entry.
 *       d. Insert an AR record with a deliberately wrong amount via the DB
 *          directly so the reconciliation engine generates an
 *          `amount_mismatch` discrepancy — the finalize gate then blocks
 *          until the Finance Admin acknowledges it.
 *
 * Fixed IDs use a separate namespace (fc-…) to avoid colliding with the
 * producer-portal seed that runs in the same ephemeral Postgres.
 *
 * Issue: test: E2E — Finance Admin month-end close (headless Chromium) (#117)
 */

import postgres from 'postgres';
import { upsertArIngestedRecord } from 'db/reconciliation';
import { SEEDED, CLOSE } from './ids';

// Re-export so callers that previously imported CLOSE from this file still work.
export { CLOSE } from './ids';

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

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { cookie: this.cookie },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text}`);
    return JSON.parse(text) as T;
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: this.cookie },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}

export interface FinanceCloseFixture {
  /** The incomplete placement id (for gap-queue assertion). */
  incompletePlacementId: string;
  /** The approved commission run id. */
  runId: string;
  /** Invoice id created in the ledger. */
  invoiceId: string;
}

/**
 * Seeds the finance-close fixture via the running server.
 *
 * @param baseUrl    Server root without /api prefix (e.g. http://localhost:31999).
 * @param databaseUrl Postgres URL — used only for the direct AR upsert and
 *                   placement status flip.
 */
export async function seedFinanceClose(
  baseUrl: string,
  databaseUrl: string,
): Promise<FinanceCloseFixture> {
  const api = new ApiSession(baseUrl);
  await api.login(SEEDED.adminId);

  // ── a. Incomplete placement (fee_amount resolves to 0 via fee_pct: '0') ──
  // The API requires fee_amount OR fee_pct. We pass fee_pct: '0' so the server
  // accepts the request, but resolves fee_amount to 0 (Math.round(80000 * 0 / 100)).
  // The DB incompleteness check treats fee_amount === 0 as missing, so this
  // placement appears in the DataGapQueue.
  const { id: incompletePlacementId } = await api.post<{ id: string }>('/placements', {
    candidate_id: crypto.randomUUID(),
    client_entity_id: crypto.randomUUID(),
    job_title: 'E2E Gap Placement',
    compensation_base: '80000',
    fee_pct: '0', // resolves to fee_amount=0 → treated as missing by DataGapQueue
    start_date: '2025-05-01',
    guarantee_days: null,
  });

  // ── b. Complete placement → commission run ───────────────────────────────

  // Active plan for the producer.
  const { plan, version } = await api.post<{ plan: { id: string }; version: { id: string } }>(
    '/plans',
    {
      name: `E2E Close Plan ${Date.now()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    },
  );
  await api.post(`/plans/${plan.id}/versions/${version.id}/activate`);
  await api.post(`/plans/${plan.id}/assignments`, {
    producer_id: SEEDED.producerId,
    plan_version_id: version.id,
  });

  const { id: completePlacementId } = await api.post<{ id: string }>('/placements', {
    candidate_id: crypto.randomUUID(),
    client_entity_id: crypto.randomUUID(),
    job_title: 'E2E Close Placement',
    compensation_base: '120000',
    fee_amount: CLOSE.ledgerAmount,
    start_date: CLOSE.periodStart,
    guarantee_days: null,
  });

  // Flip to Active so calculate works (same direct-DB pattern as seed-producer).
  const sql = postgres(databaseUrl, { max: 2 });
  try {
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      completePlacementId,
    ]);
  } finally {
    await sql.end({ timeout: 5 });
  }

  await api.post(`/placements/${completePlacementId}/contributors`, {
    producer_id: SEEDED.producerId,
    role: 'CandidateOwner',
    split_pct: 1.0,
  });

  const { commission_records } = await api.post<{
    commission_records: Array<{ id: string }>;
  }>(`/placements/${completePlacementId}/calculate`);

  // Create the run covering the close period.
  const { id: runId } = await api.post<{ id: string }>('/commission-runs', {
    period_start: CLOSE.periodStart,
    period_end: CLOSE.periodEnd,
    placement_ids: [completePlacementId],
  });

  // Individually approve every record (required by the finalize gate).
  // We do NOT call batch-approve (/commission-runs/:id/approve) because that
  // would transition the run to 'Approved' status and a subsequent finalize
  // call would return 409 "already finalized". The finalize endpoint is the
  // reconciliation-gated path that both individually-approves and finalizes.
  const { queue } = await api.get<{ queue: Array<{ commission_record_id: string }> }>(
    `/commission-runs/${runId}/queue`,
  );
  for (const item of queue) {
    await api.post(`/commission-runs/${runId}/records/${item.commission_record_id}/approve`);
  }
  // Also individually-approve via commission_records list in case queue differs.
  for (const rec of commission_records) {
    try {
      await api.post(`/commission-runs/${runId}/records/${rec.id}/approve`);
    } catch {
      // already individually-approved — ignore 409
    }
  }
  // Run remains in 'Open' status (not batch-approved) so that the test can
  // exercise the finalize gate: first a 422 (unacknowledged discrepancy),
  // then a 200 after the discrepancy is acknowledged.

  // ── c. Ledger invoice ────────────────────────────────────────────────────
  const { id: invoiceId } = await api.post<{ id: string }>('/invoices', {
    placement_id: completePlacementId,
    invoice_number: CLOSE.invoiceNumber,
    amount_billed: CLOSE.ledgerAmount,
    issued_at: `${CLOSE.periodStart}T00:00:00.000Z`,
  });

  // ── d. AR record with mismatched amount (amount_mismatch discrepancy) ────
  const sql2 = postgres(databaseUrl, { max: 1 });
  try {
    await upsertArIngestedRecord(sql2, {
      orgId: SEEDED.orgId,
      invoiceNumber: CLOSE.invoiceNumber,
      amountBilled: CLOSE.arAmount, // intentionally wrong → amount_mismatch
      billedDate: CLOSE.periodStart,
    });
  } finally {
    await sql2.end({ timeout: 5 });
  }

  // ── e. Pre-generate the reconciliation report ────────────────────────────
  // The finalize gate reads from reconciliation_discrepancies, which is only
  // populated when GET /reconciliation is called (the report call runs the
  // reconciliation engine and inserts discrepancy rows into the DB). We fetch
  // the report here so those rows exist when the browser-side test calls
  // finalize and expects a 422 (unacknowledged_discrepancy_count > 0).
  await api.get<unknown>(
    `/reconciliation?period_start=${CLOSE.periodStart}&period_end=${CLOSE.periodEnd}`,
  );

  return { incompletePlacementId, runId, invoiceId };
}

/**
 * E2E executive-persona seed (Bun runtime helper, NOT a test file).
 *
 * Extends the existing seeded data with an escalated dispute that the Executive
 * can review and resolve via the ExecDisputeApproval surface. The dispute is
 * seeded in the `UnderReview` state (the escalated state for executive approval)
 * so that the ExecDisputeApproval component renders it in the escalated queue.
 *
 * Strategy:
 *   seedExecutiveViaHttp() — called via HTTP AFTER the server is up:
 *     1. Create a placement with commission records through the real API.
 *     2. Have a producer open a dispute against one commission record.
 *     3. Promote the dispute to UnderReview state via a direct SQL update
 *        (no HTTP endpoint exists for Manager-to-Executive escalation yet).
 *
 * The analytics data is provided by the existing producer + manager seed data
 * (same org); the executive analytics endpoint aggregates all placements.
 *
 * Issue: test: E2E — Executive visibility and dispute final-approval (#119)
 */

import postgres from 'postgres';
import { SEEDED } from './ids';

export { SEEDED } from './ids';

/** Stable seeded identifiers set during seedExecutiveViaHttp(). */
export const EXEC_SEEDED = {
  /** Placement whose commission record has an escalated (UnderReview) dispute. */
  escalatedPlacementId: '',
  /** Commission record ID targeted by the escalated dispute. */
  escalatedRecordId: '',
  /** Dispute ID in UnderReview state — awaiting executive final approval. */
  escalatedDisputeId: '',
  /** Period start/end used for analytics assertions. */
  periodStart: '2025-05-01',
  periodEnd: '2025-05-31',
};

/** Minimal HTTP session helper. */
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

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { cookie: this.cookie },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text}`);
    return JSON.parse(text) as T;
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
 * Seed executive E2E data through the running server's real HTTP API.
 *
 * Must be called AFTER the server is ready and after seedManagerViaHttp()
 * completes (reuses the same plan/producer identities).
 */
export async function seedExecutiveViaHttp(
  baseUrl: string,
  databaseUrl: string,
): Promise<typeof EXEC_SEEDED> {
  const admin = new ApiSession(baseUrl);
  await admin.login(SEEDED.adminId);

  // -------------------------------------------------------------------------
  // Create a plan and assignment for the executive-test placement.
  // We create a separate plan to avoid colliding with the manager-seed plan.
  // -------------------------------------------------------------------------
  const { plan, version } = await admin.post<{ plan: { id: string }; version: { id: string } }>(
    '/plans',
    {
      name: `E2E Executive Plan ${Date.now()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    },
  );
  await admin.post(`/plans/${plan.id}/versions/${version.id}/activate`);
  await admin.post(`/plans/${plan.id}/assignments`, {
    producer_id: SEEDED.producerId,
    plan_version_id: version.id,
  });

  // -------------------------------------------------------------------------
  // Create a placement that will carry an escalated dispute.
  // Flow:
  //   1. Create placement (Draft).
  //   2. Add producer as contributor.
  //   3. Activate placement via SQL so commission can be calculated.
  //   4. Calculate commission records.
  //   5. Producer opens a dispute.
  //   6. Escalate the dispute to UnderReview via SQL (no HTTP endpoint yet).
  // -------------------------------------------------------------------------
  const { id: escalatedPlacementId } = await admin.post<{ id: string }>('/placements', {
    candidate_id: crypto.randomUUID(),
    client_entity_id: crypto.randomUUID(),
    job_title: 'VP Engineering (Escalated)',
    compensation_base: '250000',
    fee_amount: '50000',
    start_date: '2025-05-01',
    guarantee_days: null,
  });

  // Add producer as primary contributor.
  await admin.post(`/placements/${escalatedPlacementId}/contributors`, {
    producer_id: SEEDED.producerId,
    role: 'CandidateOwner',
    split_pct: 1.0,
  });

  const sql = postgres(databaseUrl, { max: 2 });

  try {
    // Activate the placement so commission calculation is allowed.
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      escalatedPlacementId,
    ]);

    // Calculate commission records.
    const { commission_records } = await admin.post<{
      commission_records: Array<{ id: string }>;
    }>(`/placements/${escalatedPlacementId}/calculate`);

    if (!commission_records || commission_records.length === 0) {
      throw new Error('No commission records created for executive escalation placement');
    }

    const targetRecordId = commission_records[0].id;

    // Producer opens a dispute against their commission record.
    const producer = new ApiSession(baseUrl);
    await producer.login(SEEDED.producerId);

    const dispute = await producer.post<{ id: string }>('/disputes', {
      commission_record_id: targetRecordId,
      description:
        'Attribution dispute — executive escalation test. The split allocation does not match the agreed terms for VP Engineering placement.',
    });

    // Escalate the dispute to UnderReview (models a manager escalating to exec).
    // No HTTP endpoint exists for this transition yet — the Manager UI escalation
    // surface passes the dispute to the executive for final approval. We model
    // this by directly updating the dispute state in the DB.
    await sql.unsafe(
      `UPDATE disputes SET state = 'UnderReview' WHERE id = $1 AND org_id = $2`,
      [dispute.id, SEEDED.orgId],
    );

    EXEC_SEEDED.escalatedPlacementId = escalatedPlacementId;
    EXEC_SEEDED.escalatedRecordId = targetRecordId;
    EXEC_SEEDED.escalatedDisputeId = dispute.id;
  } finally {
    await sql.end({ timeout: 5 });
  }

  return EXEC_SEEDED;
}

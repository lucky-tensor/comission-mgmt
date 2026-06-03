/**
 * E2E manager-persona seed (Bun runtime helper, NOT a test file).
 *
 * Extends the producer seed with two Manager users and their team data:
 *
 *   Manager 1 (managerId) oversees producer 1 (producerId).
 *     - One placement in PendingApproval state (for split-approval flow).
 *     - One placement with a seeded producer dispute (for escalation flow).
 *       A contested split is modelled as a commission record with an active
 *       dispute in Submitted state, which blocks that placement from being
 *       included in a commission run that already has it approved.
 *
 *   Manager 2 (manager2Id) oversees producer 2 (producer2Id).
 *     - One separate placement — team isolation asserts manager 1 CANNOT see
 *       manager 2's team data.
 *
 * Seed strategy:
 *   migrateAndSeedManagerIdentities() — pre-server direct DB writes for the
 *     new identity rows (manager/producer users + memberships).
 *   seedManagerViaHttp()              — post-server HTTP calls to create
 *     placements, transitions, contributors, and disputes through real API
 *     endpoints so encryption is owned by the server process.
 *
 * Issue: test: E2E — Manager split-approval and dispute resolution (#118)
 */

import postgres from 'postgres';
import { SEEDED } from './ids';

export { SEEDED } from './ids';

/** Insert manager and second-team identity rows directly into the DB. */
export async function migrateAndSeedManagerIdentities(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 2 });
  try {
    // Manager 1
    await sql.unsafe(
      `INSERT INTO users (id, email, display_name)
       VALUES ('${SEEDED.managerId}', '${SEEDED.managerEmail}', 'E2E Manager')
       ON CONFLICT (id) DO NOTHING`,
    );
    await sql.unsafe(
      `INSERT INTO org_memberships (user_id, org_id, role)
       VALUES ('${SEEDED.managerId}', '${SEEDED.orgId}', 'Manager')
       ON CONFLICT (user_id, org_id) DO NOTHING`,
    );

    // Manager 2
    await sql.unsafe(
      `INSERT INTO users (id, email, display_name)
       VALUES ('${SEEDED.manager2Id}', '${SEEDED.manager2Email}', 'E2E Manager 2')
       ON CONFLICT (id) DO NOTHING`,
    );
    await sql.unsafe(
      `INSERT INTO org_memberships (user_id, org_id, role)
       VALUES ('${SEEDED.manager2Id}', '${SEEDED.orgId}', 'Manager')
       ON CONFLICT (user_id, org_id) DO NOTHING`,
    );

    // Producer 2 (under Manager 2's team)
    await sql.unsafe(
      `INSERT INTO users (id, email, display_name)
       VALUES ('${SEEDED.producer2Id}', '${SEEDED.producer2Email}', 'E2E Producer 2')
       ON CONFLICT (id) DO NOTHING`,
    );
    await sql.unsafe(
      `INSERT INTO org_memberships (user_id, org_id, role)
       VALUES ('${SEEDED.producer2Id}', '${SEEDED.orgId}', 'Producer')
       ON CONFLICT (user_id, org_id) DO NOTHING`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Minimal HTTP client that carries a session cookie. */
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
      method: 'GET',
      headers: { cookie: this.cookie },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
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
 * Seeded placement IDs shared with the E2E test.
 * Set during seedManagerViaHttp() so the browser-side test knows which IDs to
 * operate on without guessing.
 */
export const MANAGER_SEEDED = {
  /** Placement under Manager 1's team, in PendingApproval state (for split-approval flow). */
  pendingPlacementId: '',
  /** Placement under Manager 1's team with a seeded dispute (for escalation flow). */
  disputedPlacementId: '',
  /** Commission record ID on the disputed placement (the one the dispute is against). */
  disputedRecordId: '',
  /** Dispute ID (Submitted state — models an escalated/contested split). */
  disputeId: '',
  /** Placement under Manager 2's team (for team isolation assertion). */
  isolationPlacementId: '',
};

/**
 * Seed manager team data through the running server's real HTTP API.
 * Must be called AFTER the server is ready and after seedViaHttp() completes.
 */
export async function seedManagerViaHttp(
  baseUrl: string,
  databaseUrl: string,
): Promise<typeof MANAGER_SEEDED> {
  // Admin session: creates plans and placements.
  const admin = new ApiSession(baseUrl);
  await admin.login(SEEDED.adminId);

  // -----------------------------------------------------------------------
  // Shared plan for all manager-team placements.
  // -----------------------------------------------------------------------
  const { plan, version } = await admin.post<{ plan: { id: string }; version: { id: string } }>(
    '/plans',
    {
      name: `E2E Manager Plan ${Date.now()}`,
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    },
  );
  await admin.post(`/plans/${plan.id}/versions/${version.id}/activate`);
  await admin.post(`/plans/${plan.id}/assignments`, {
    producer_id: SEEDED.producerId,
    plan_version_id: version.id,
  });
  await admin.post(`/plans/${plan.id}/assignments`, {
    producer_id: SEEDED.producer2Id,
    plan_version_id: version.id,
  });

  const sql = postgres(databaseUrl, { max: 2 });

  try {
    // -----------------------------------------------------------------------
    // Placement A: Manager 1's team — PendingApproval (split-approval flow).
    //
    // Flow:
    //   1. Create placement (Draft).
    //   2. Set status to ContributorsAssigned directly via SQL (so submit works).
    //   3. Add producer 1 as contributor + Manager 1 as ManagerOverride.
    //   4. Submit attribution → PendingApproval.
    // -----------------------------------------------------------------------
    const { id: pendingPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Recruiter (Pending)',
      compensation_base: '150000',
      fee_amount: '30000',
      start_date: '2025-05-01',
      guarantee_days: null,
    });

    // Add producer 1 as main contributor.
    await admin.post(`/placements/${pendingPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 0.7,
    });
    // Add manager 1 as ManagerOverride contributor (defines their team).
    await admin.post(`/placements/${pendingPlacementId}/contributors`, {
      producer_id: SEEDED.managerId,
      role: 'ManagerOverride',
      split_pct: 0.3,
    });

    // Transition to ContributorsAssigned so submit works.
    await sql.unsafe(`UPDATE placements SET status = 'ContributorsAssigned' WHERE id = $1`, [
      pendingPlacementId,
    ]);

    // Submit attribution — transitions to PendingApproval.
    await admin.post(`/placements/${pendingPlacementId}/attribution/submit`, {});

    MANAGER_SEEDED.pendingPlacementId = pendingPlacementId;

    // -----------------------------------------------------------------------
    // Placement B: Manager 1's team — Active, with a Submitted dispute.
    //
    // Flow:
    //   1. Create placement → activate → add contributors → calculate → approve run.
    //   2. Producer 1 creates a dispute against the commission record.
    //   3. Dispute in Submitted state models a contested/escalated split.
    //   A commission run that includes this placement after a dispute is raised
    //   will fail to approve the disputed record, effectively blocking payroll
    //   for that placement (the dispute must be resolved first).
    // -----------------------------------------------------------------------
    const { id: disputedPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Engineering Manager (Disputed)',
      compensation_base: '200000',
      fee_amount: '40000',
      start_date: '2025-05-01',
      guarantee_days: null,
    });

    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      disputedPlacementId,
    ]);

    // Add producer 1 as contributor.
    await admin.post(`/placements/${disputedPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 0.6,
    });
    // Add manager 1 as ManagerOverride so the placement appears in their team.
    await admin.post(`/placements/${disputedPlacementId}/contributors`, {
      producer_id: SEEDED.managerId,
      role: 'ManagerOverride',
      split_pct: 0.4,
    });

    // Calculate commission records so a dispute can be filed.
    const { commission_records } = await admin.post<{
      commission_records: Array<{ id: string }>;
    }>(`/placements/${disputedPlacementId}/calculate`);

    // Producer 1 creates a dispute against their record.
    const producer = new ApiSession(baseUrl);
    await producer.login(SEEDED.producerId);

    const producerRecords = commission_records.filter((r) => r.id);
    if (producerRecords.length === 0) throw new Error('No commission records found for dispute');
    const targetRecordId = producerRecords[0].id;

    const dispute = await producer.post<{ id: string }>('/disputes', {
      commission_record_id: targetRecordId,
      description: 'Split allocation does not reflect my contribution to this placement.',
    });

    MANAGER_SEEDED.disputedPlacementId = disputedPlacementId;
    MANAGER_SEEDED.disputedRecordId = targetRecordId;
    MANAGER_SEEDED.disputeId = dispute.id;

    // -----------------------------------------------------------------------
    // Placement C: Manager 2's team — for team isolation assertion.
    // Manager 1 must NOT see this placement in their team views.
    // -----------------------------------------------------------------------
    const { id: isolationPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Finance Director (Isolated)',
      compensation_base: '180000',
      fee_amount: '36000',
      start_date: '2025-05-01',
      guarantee_days: null,
    });

    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      isolationPlacementId,
    ]);

    // Add producer 2 as the primary contributor (CandidateOwner).
    await admin.post(`/placements/${isolationPlacementId}/contributors`, {
      producer_id: SEEDED.producer2Id,
      role: 'CandidateOwner',
      split_pct: 0.9,
    });
    // Add manager 2 as ManagerOverride — defines this placement as part of
    // Manager 2's team (not Manager 1's). split_pct must be > 0 per API
    // validation; 0.1 is a minimal valid value.
    await admin.post(`/placements/${isolationPlacementId}/contributors`, {
      producer_id: SEEDED.manager2Id,
      role: 'ManagerOverride',
      split_pct: 0.1,
    });

    MANAGER_SEEDED.isolationPlacementId = isolationPlacementId;
  } finally {
    await sql.end({ timeout: 5 });
  }

  return MANAGER_SEEDED;
}

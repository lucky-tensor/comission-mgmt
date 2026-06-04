#!/usr/bin/env bun
import postgres from 'postgres';
import { SEEDED, CLOSE, PARTNER } from '../../tests/e2e/fixtures/ids.js';
import { upsertArIngestedRecord } from 'db/reconciliation';

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
      method: 'GET',
      headers: { cookie: this.cookie },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}

export interface SharedSeedFixture {
  closeRunId: string;
  closeIncompletePlacementId: string;
  closeCompletePlacementId: string;
  partnerPlacementId: string;
  unrelatedPlacementId: string;
}

export async function seedEncrypted(
  baseUrl: string,
  databaseUrl: string,
): Promise<SharedSeedFixture> {
  const admin = new ApiSession(baseUrl);
  await admin.login(SEEDED.adminId);

  const sql = postgres(databaseUrl, { max: 3 });

  try {
    // ── 1. Plans ──────────────────────────────────────────────────────────
    const { plan: lifecyclePlan, version: lifecycleVersion } = await admin.post<{
      plan: { id: string }; version: { id: string };
    }>('/plans', {
      name: 'Standard Plan', effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.15 },
    });
    await admin.post(`/plans/${lifecyclePlan.id}/versions/${lifecycleVersion.id}/activate`);
    await admin.post(`/plans/${lifecyclePlan.id}/assignments`, {
      producer_id: SEEDED.producerId, plan_version_id: lifecycleVersion.id,
    });
    await admin.post(`/plans/${lifecyclePlan.id}/assignments`, {
      producer_id: SEEDED.producer2Id, plan_version_id: lifecycleVersion.id,
    });

    // Tiered plan for ExternalPartner (demo lifecycle)
    const { plan: tieredPlan, version: tieredVersion } = await admin.post<{
      plan: { id: string }; version: { id: string };
    }>('/plans', {
      name: 'Tiered Plan', effective_from: '2025-01-01',
      rules: { type: 'tiered', tiers: [{ threshold: 0, rate: 0.12 }, { threshold: 50000, rate: 0.15 }, { threshold: 100000, rate: 0.18 }], basis: 'gross_fee' },
    });
    await admin.post(`/plans/${tieredPlan.id}/versions/${tieredVersion.id}/activate`);
    await admin.post(`/plans/${tieredPlan.id}/assignments`, {
      producer_id: SEEDED.partnerId, plan_version_id: tieredVersion.id,
    });

    // Manager team plan
    const { plan: mgrPlan, version: mgrVersion } = await admin.post<{
      plan: { id: string }; version: { id: string };
    }>('/plans', {
      name: 'Manager Team Plan', effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    });
    await admin.post(`/plans/${mgrPlan.id}/versions/${mgrVersion.id}/activate`);
    await admin.post(`/plans/${mgrPlan.id}/assignments`, {
      producer_id: SEEDED.producerId, plan_version_id: mgrVersion.id,
    });
    await admin.post(`/plans/${mgrPlan.id}/assignments`, {
      producer_id: SEEDED.producer2Id, plan_version_id: mgrVersion.id,
    });

    // Finance close plan
    const { plan: closePlan, version: closeVersion } = await admin.post<{
      plan: { id: string }; version: { id: string };
    }>('/plans', {
      name: 'Close Plan', effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    });
    await admin.post(`/plans/${closePlan.id}/versions/${closeVersion.id}/activate`);
    await admin.post(`/plans/${closePlan.id}/assignments`, {
      producer_id: SEEDED.producerId, plan_version_id: closeVersion.id,
    });

    // Executive / escalation plan
    const { plan: execPlan, version: execVersion } = await admin.post<{
      plan: { id: string }; version: { id: string };
    }>('/plans', {
      name: 'Executive Escalation Plan', effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    });
    await admin.post(`/plans/${execPlan.id}/versions/${execVersion.id}/activate`);
    await admin.post(`/plans/${execPlan.id}/assignments`, {
      producer_id: SEEDED.producerId, plan_version_id: execVersion.id,
    });

    // Partner plan
    const { plan: partnerPlan, version: partnerVersion } = await admin.post<{
      plan: { id: string }; version: { id: string };
    }>('/plans', {
      name: 'Partner Plan', effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.3 },
    });
    await admin.post(`/plans/${partnerPlan.id}/versions/${partnerVersion.id}/activate`);
    await admin.post(`/plans/${partnerPlan.id}/assignments`, {
      producer_id: SEEDED.partnerId, plan_version_id: partnerVersion.id,
    });

    // ── 2. Lifecycle placements (8, across all states) ────────────────────
    type PlacementDef = { title: string; base: string; fee: string; start: string; days: number | null };

    const lifecycleDefs: PlacementDef[] = [
      { title: 'Software Engineer (Demo)', base: '120000', fee: '18000', start: '2026-06-01', days: 90 },
      { title: 'Product Manager (Demo)', base: '150000', fee: '22500', start: '2026-03-15', days: 90 },
      { title: 'Director of Marketing (Demo)', base: '175000', fee: '26250', start: '2026-02-01', days: 90 },
      { title: 'VP of Sales (Demo)', base: '200000', fee: '30000', start: '2025-12-01', days: 90 },
      { title: 'Senior Data Analyst (Demo)', base: '130000', fee: '19500', start: '2026-04-01', days: 90 },
      { title: 'DevOps Lead (Demo)', base: '160000', fee: '24000', start: '2025-10-01', days: 90 },
      { title: 'CFO (Demo)', base: '280000', fee: '42000', start: '2025-09-01', days: 90 },
      { title: 'Operations Manager (Demo)', base: '110000', fee: '16500', start: '2025-11-01', days: 90 },
    ];

    const lifecycleStatuses: string[] = [
      'Created', 'Active', 'Invoiced', 'Collected',
      'GuaranteeActive', 'GuaranteeExpired', 'Closed', 'ClawbackTriggered',
    ];

    const lifecyclePlacementIds: string[] = [];

    for (let i = 0; i < lifecycleDefs.length; i++) {
      const d = lifecycleDefs[i];
      const { id: pid } = await admin.post<{ id: string }>('/placements', {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: d.title,
        compensation_base: d.base,
        fee_amount: d.fee,
        start_date: d.start,
        guarantee_days: d.days,
      });
      lifecyclePlacementIds.push(pid);

      const status = lifecycleStatuses[i];

      if (status !== 'Created') {
        await sql.unsafe(`UPDATE placements SET status = '${status}' WHERE id = $1`, [pid]);
      }

      if (status === 'Active' || status === 'Invoiced' || status === 'Collected' || status === 'Closed' || status === 'ClawbackTriggered') {
        await admin.post(`/placements/${pid}/contributors`, {
          producer_id: SEEDED.producerId, role: 'CandidateOwner', split_pct: status === 'Active' ? 0.7 : status === 'Invoiced' ? 0.6 : 0.5,
        });
        await admin.post(`/placements/${pid}/contributors`, {
          producer_id: SEEDED.managerId, role: 'ManagerOverride', split_pct: status === 'Active' ? 0.3 : status === 'Invoiced' ? 0.4 : 0.25,
        });

        if (status === 'Collected' || status === 'Closed') {
          await admin.post(`/placements/${pid}/contributors`, {
            producer_id: SEEDED.partnerId, role: 'ExternalPartner', split_pct: 0.25,
          });
          try {
            await admin.post(`/placements/${pid}/calculate`);
          } catch {
            // calculate may fail if no active plan or period mismatch — non-fatal
          }
        }
      } else if (status === 'GuaranteeActive' || status === 'GuaranteeExpired') {
        await admin.post(`/placements/${pid}/contributors`, {
          producer_id: SEEDED.producerId, role: 'CandidateOwner', split_pct: 1.0,
        });
      }
    }

    // ── 3. E2E: Producer payout placement (PR-1, PR-2 via lifecycle Active) ──
    // Already covered by lifecycleDefs[1] (Product Manager, Active, $22500 fee)
    // The producer sees this placement in their payout portal.

    // ── 4. E2E: Manager — PendingApproval placement (MG-1, MG-2) ─────────
    const { id: pendingPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(), client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Recruiter (Pending)', compensation_base: '150000',
      fee_amount: '30000', start_date: '2025-05-01', guarantee_days: null,
    });

    await admin.post(`/placements/${pendingPlacementId}/contributors`, {
      producer_id: SEEDED.producerId, role: 'CandidateOwner', split_pct: 0.7,
    });
    await admin.post(`/placements/${pendingPlacementId}/contributors`, {
      producer_id: SEEDED.managerId, role: 'ManagerOverride', split_pct: 0.3,
    });

    await sql.unsafe(`UPDATE placements SET status = 'ContributorsAssigned' WHERE id = $1`, [
      pendingPlacementId,
    ]);
    await admin.post(`/placements/${pendingPlacementId}/attribution/submit`, {});

    // ── 5. E2E: Manager — disputed placement (MG-3, MG-4) ────────────────
    const { id: disputedPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(), client_entity_id: crypto.randomUUID(),
      job_title: 'Engineering Manager (Disputed)', compensation_base: '200000',
      fee_amount: '40000', start_date: '2025-05-01', guarantee_days: null,
    });

    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      disputedPlacementId,
    ]);

    await admin.post(`/placements/${disputedPlacementId}/contributors`, {
      producer_id: SEEDED.producer2Id, role: 'CandidateOwner', split_pct: 0.6,
    });
    await admin.post(`/placements/${disputedPlacementId}/contributors`, {
      producer_id: SEEDED.managerId, role: 'ManagerOverride', split_pct: 0.4,
    });

    const { commission_records: disputeRecords } = await admin.post<{
      commission_records: Array<{ id: string }>;
    }>(`/placements/${disputedPlacementId}/calculate`);

    // Producer2 opens a dispute
    const producer = new ApiSession(baseUrl);
    await producer.login(SEEDED.producer2Id);

    const targetRecordId = disputeRecords[0].id;
    await producer.post('/disputes', {
      commission_record_id: targetRecordId,
      description: 'Split allocation does not reflect my contribution to this placement.',
    });

    // Second dispute (for separate escalation test)
    if (disputeRecords.length >= 2) {
      await producer.post('/disputes', {
        commission_record_id: disputeRecords[1].id,
        description: 'Second split dispute for escalation state test.',
      });
    } else {
      await producer.post('/disputes', {
        commission_record_id: targetRecordId,
        description: 'Second split dispute for escalation state test.',
      });
    }

    // ── 6. E2E: Manager — team isolation placement (MG-3) ─────────────────
    const { id: isolationPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(), client_entity_id: crypto.randomUUID(),
      job_title: 'Finance Director (Isolated)', compensation_base: '180000',
      fee_amount: '36000', start_date: '2025-05-01', guarantee_days: null,
    });

    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      isolationPlacementId,
    ]);

    await admin.post(`/placements/${isolationPlacementId}/contributors`, {
      producer_id: SEEDED.producer2Id, role: 'CandidateOwner', split_pct: 0.9,
    });
    await admin.post(`/placements/${isolationPlacementId}/contributors`, {
      producer_id: SEEDED.manager2Id, role: 'ManagerOverride', split_pct: 0.1,
    });

    // ── 7. E2E: Finance Close — incomplete placement (FA-1) ──────────────
    const { id: incompletePlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(), client_entity_id: crypto.randomUUID(),
      job_title: 'Gap Placement', compensation_base: '80000',
      fee_pct: '0', start_date: '2025-05-01', guarantee_days: null,
    });

    // ── 8. E2E: Finance Close — complete placement (FA-2, FA-3, FA-4, FA-5) ──
    const { id: completePlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(), client_entity_id: crypto.randomUUID(),
      job_title: 'Close Placement', compensation_base: '120000',
      fee_amount: CLOSE.ledgerAmount, start_date: CLOSE.periodStart, guarantee_days: null,
    });

    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      completePlacementId,
    ]);

    await admin.post(`/placements/${completePlacementId}/contributors`, {
      producer_id: SEEDED.producerId, role: 'CandidateOwner', split_pct: 1.0,
    });

    const { commission_records: closeRecords } = await admin.post<{
      commission_records: Array<{ id: string }>;
    }>(`/placements/${completePlacementId}/calculate`);

    const { id: closeRunId } = await admin.post<{ id: string }>('/commission-runs', {
      period_start: CLOSE.periodStart, period_end: CLOSE.periodEnd,
      placement_ids: [completePlacementId],
    });

    // Individually approve each record (don't batch-approve — leaves run in Open
    // for the test to exercise the finalize gate).
    const { queue } = await admin.get<{ queue: Array<{ commission_record_id: string }> }>(
      `/commission-runs/${closeRunId}/queue`,
    );
    const approvedRecordIds = new Set<string>();
    for (const item of queue) {
      try {
        await admin.post(`/commission-runs/${closeRunId}/records/${item.commission_record_id}/approve`);
        approvedRecordIds.add(item.commission_record_id);
      } catch {
        // already approved
      }
    }
    for (const rec of closeRecords) {
      if (!approvedRecordIds.has(rec.id)) {
        try {
          await admin.post(`/commission-runs/${closeRunId}/records/${rec.id}/approve`);
        } catch {
          // already approved
        }
      }
    }

    // ── 9. E2E: Finance Close — ledger invoice (FA-4) ────────────────────
    await admin.post('/invoices', {
      placement_id: completePlacementId,
      invoice_number: CLOSE.invoiceNumber,
      amount_billed: CLOSE.ledgerAmount,
      issued_at: `${CLOSE.periodStart}T00:00:00.000Z`,
    });

    // ── 10. E2E: Finance Close — AR discrepancy ───────────────────────────
    await upsertArIngestedRecord(sql, {
      orgId: SEEDED.orgId,
      invoiceNumber: CLOSE.invoiceNumber,
      amountBilled: CLOSE.arAmount,
      billedDate: CLOSE.periodStart,
    });

    // Pre-generate reconciliation report so discrepancies exist for the test
    try {
      await admin.get<unknown>(
        `/reconciliation?period_start=${CLOSE.periodStart}&period_end=${CLOSE.periodEnd}`,
      );
    } catch {
      // non-fatal — the test may encounter a fresh state
    }

    // ── 11. E2E: Partner — own placement + unrelated placement (EP-1) ─────
    const { id: partnerPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(), client_entity_id: crypto.randomUUID(),
      job_title: 'Partner Deal', compensation_base: '100000',
      fee_amount: PARTNER.feeAmount, start_date: PARTNER.startDate, guarantee_days: null,
    });

    const { id: unrelatedPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(), client_entity_id: crypto.randomUUID(),
      job_title: 'Unrelated Deal', compensation_base: '90000',
      fee_amount: '7500', start_date: '2025-04-01', guarantee_days: null,
    });

    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = ANY($1)`, [
      [partnerPlacementId, unrelatedPlacementId],
    ]);

    await admin.post(`/placements/${partnerPlacementId}/contributors`, {
      producer_id: SEEDED.partnerId, role: 'CandidateOwner', split_pct: 1.0,
    });
    await admin.post(`/placements/${unrelatedPlacementId}/contributors`, {
      producer_id: SEEDED.producerId, role: 'CandidateOwner', split_pct: 1.0,
    });

    // ── 12. E2E: Executive — escalated dispute (EX-4) ────────────────────
    const { id: escalatedPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(), client_entity_id: crypto.randomUUID(),
      job_title: 'VP Engineering (Escalated)', compensation_base: '250000',
      fee_amount: '50000', start_date: '2025-05-01', guarantee_days: null,
    });

    await admin.post(`/placements/${escalatedPlacementId}/contributors`, {
      producer_id: SEEDED.producerId, role: 'CandidateOwner', split_pct: 1.0,
    });

    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      escalatedPlacementId,
    ]);

    const { commission_records: execRecords } = await admin.post<{
      commission_records: Array<{ id: string }>;
    }>(`/placements/${escalatedPlacementId}/calculate`);

    const execTargetRecordId = execRecords[0].id;

    const execProducer = new ApiSession(baseUrl);
    await execProducer.login(SEEDED.producerId);

    const execDispute = await execProducer.post<{ id: string }>('/disputes', {
      commission_record_id: execTargetRecordId,
      description: 'Attribution dispute for executive escalation test.',
    });

    await sql.unsafe(`UPDATE disputes SET state = 'UnderReview' WHERE id = $1 AND org_id = $2`, [
      execDispute.id, SEEDED.orgId,
    ]);

    return {
      closeRunId,
      closeIncompletePlacementId: incompletePlacementId,
      closeCompletePlacementId: completePlacementId,
      partnerPlacementId,
      unrelatedPlacementId,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

#!/usr/bin/env bun
import postgres from 'postgres';
import { SEEDED, CLOSE, PARTNER, DEMO_HETERO } from '../../tests/e2e/fixtures/ids.js';
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
    await res.json();
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) throw new Error('demo login returned no cookie');
    this.cookie = setCookie.split(';')[0];
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: this.cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST /api${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/api${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: this.cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`PATCH /api${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}/api${path}`, {
      method: 'GET',
      headers: { cookie: this.cookie },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET /api${path} → ${res.status}: ${text}`);
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
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Standard Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.15 },
    });
    await admin.post(`/plans/${lifecyclePlan.id}/versions/${lifecycleVersion.id}/activate`);
    await admin.post(`/plans/${lifecyclePlan.id}/assignments`, {
      producer_id: SEEDED.producerId,
      plan_version_id: lifecycleVersion.id,
    });
    await admin.post(`/plans/${lifecyclePlan.id}/assignments`, {
      producer_id: SEEDED.producer2Id,
      plan_version_id: lifecycleVersion.id,
    });

    // Tiered plan for ExternalPartner (demo lifecycle)
    const { plan: tieredPlan, version: tieredVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Tiered Plan',
      effective_from: '2025-01-01',
      rules: {
        rate_type: 'gross_fee',
        base_rate: 0.12,
        tiers: [
          { threshold: 0, rate: 0.12 },
          { threshold: 50000, rate: 0.15 },
          { threshold: 100000, rate: 0.18 },
        ],
      },
    });
    await admin.post(`/plans/${tieredPlan.id}/versions/${tieredVersion.id}/activate`);
    await admin.post(`/plans/${tieredPlan.id}/assignments`, {
      producer_id: SEEDED.partnerId,
      plan_version_id: tieredVersion.id,
    });

    // Manager team plan
    const { plan: mgrPlan, version: mgrVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Manager Team Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    });
    await admin.post(`/plans/${mgrPlan.id}/versions/${mgrVersion.id}/activate`);
    await admin.post(`/plans/${mgrPlan.id}/assignments`, {
      producer_id: SEEDED.producerId,
      plan_version_id: mgrVersion.id,
    });
    await admin.post(`/plans/${mgrPlan.id}/assignments`, {
      producer_id: SEEDED.producer2Id,
      plan_version_id: mgrVersion.id,
    });

    // Finance close plan
    const { plan: closePlan, version: closeVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Close Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    });
    await admin.post(`/plans/${closePlan.id}/versions/${closeVersion.id}/activate`);
    await admin.post(`/plans/${closePlan.id}/assignments`, {
      producer_id: SEEDED.producerId,
      plan_version_id: closeVersion.id,
    });

    // Executive / escalation plan
    const { plan: execPlan, version: execVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Executive Escalation Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    });
    await admin.post(`/plans/${execPlan.id}/versions/${execVersion.id}/activate`);
    await admin.post(`/plans/${execPlan.id}/assignments`, {
      producer_id: SEEDED.producerId,
      plan_version_id: execVersion.id,
    });

    // Partner plan
    const { plan: partnerPlan, version: partnerVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Partner Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.3 },
    });
    await admin.post(`/plans/${partnerPlan.id}/versions/${partnerVersion.id}/activate`);
    await admin.post(`/plans/${partnerPlan.id}/assignments`, {
      producer_id: SEEDED.partnerId,
      plan_version_id: partnerVersion.id,
    });

    // ── 2. Lifecycle placements (8, across all states) ────────────────────
    type PlacementDef = {
      title: string;
      base: string;
      fee: string;
      start: string;
      days: number | null;
    };

    const lifecycleDefs: PlacementDef[] = [
      {
        title: 'Software Engineer (Demo)',
        base: '120000',
        fee: '18000',
        start: '2026-06-01',
        days: 90,
      },
      {
        title: 'Product Manager (Demo)',
        base: '150000',
        fee: '22500',
        start: '2026-03-15',
        days: 90,
      },
      {
        title: 'Director of Marketing (Demo)',
        base: '175000',
        fee: '26250',
        start: '2026-02-01',
        days: 90,
      },
      { title: 'VP of Sales (Demo)', base: '200000', fee: '30000', start: '2025-12-01', days: 90 },
      {
        title: 'Senior Data Analyst (Demo)',
        base: '130000',
        fee: '19500',
        start: '2026-04-01',
        days: 90,
      },
      { title: 'DevOps Lead (Demo)', base: '160000', fee: '24000', start: '2025-10-01', days: 90 },
      { title: 'CFO (Demo)', base: '280000', fee: '42000', start: '2025-09-01', days: 90 },
      {
        title: 'Operations Manager (Demo)',
        base: '110000',
        fee: '16500',
        start: '2025-11-01',
        days: 90,
      },
    ];

    const lifecycleStatuses: string[] = [
      'Created',
      'Active',
      'Invoiced',
      'Collected',
      'GuaranteeActive',
      'GuaranteeExpired',
      'Closed',
      'ClawbackTriggered',
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

      if (
        status === 'Active' ||
        status === 'Invoiced' ||
        status === 'Collected' ||
        status === 'Closed' ||
        status === 'ClawbackTriggered'
      ) {
        await admin.post(`/placements/${pid}/contributors`, {
          producer_id: SEEDED.producerId,
          role: 'CandidateOwner',
          split_pct: status === 'Active' ? 0.7 : status === 'Invoiced' ? 0.6 : 0.5,
        });
        await admin.post(`/placements/${pid}/contributors`, {
          producer_id: SEEDED.managerId,
          role: 'ManagerOverride',
          split_pct: status === 'Active' ? 0.3 : status === 'Invoiced' ? 0.4 : 0.25,
        });

        if (status === 'Collected' || status === 'Closed') {
          await admin.post(`/placements/${pid}/contributors`, {
            producer_id: SEEDED.partnerId,
            role: 'ExternalPartner',
            split_pct: 0.25,
          });
          try {
            await admin.post(`/placements/${pid}/calculate`);
          } catch {
            // calculate may fail if no active plan or period mismatch — non-fatal
          }
        }
      } else if (status === 'GuaranteeActive' || status === 'GuaranteeExpired') {
        await admin.post(`/placements/${pid}/contributors`, {
          producer_id: SEEDED.producerId,
          role: 'CandidateOwner',
          split_pct: 1.0,
        });
      }
    }

    // ── 3. E2E: Producer payout placement (PR-1) ────────────────────────────
    const { plan: prodPlan, version: prodVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Producer Payout Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.25 },
    });
    await admin.post(`/plans/${prodPlan.id}/versions/${prodVersion.id}/activate`);
    await admin.post(`/plans/${prodPlan.id}/assignments`, {
      producer_id: SEEDED.producerId,
      plan_version_id: prodVersion.id,
    });

    const { id: prodPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Recruiter',
      compensation_base: '120000',
      fee_amount: '20000',
      start_date: '2025-04-01',
      guarantee_days: null,
    });
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [prodPlacementId]);
    await admin.post(`/placements/${prodPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
    });
    const { commission_records: prodRecords } = await admin.post<{
      commission_records: Array<{ id: string }>;
    }>(`/placements/${prodPlacementId}/calculate`);
    const { id: prodRunId } = await admin.post<{ id: string }>('/commission-runs', {
      period_start: '2025-04-01',
      period_end: '2025-04-30',
      placement_ids: [prodPlacementId],
    });
    for (const rec of prodRecords) {
      await admin.post(`/commission-runs/${prodRunId}/records/${rec.id}/approve`);
    }
    await admin.post(`/commission-runs/${prodRunId}/approve`);

    // ── 4. E2E: Manager — PendingApproval placement (MG-1, MG-2) ─────────
    const { id: pendingPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Recruiter (Pending)',
      compensation_base: '150000',
      fee_amount: '30000',
      start_date: '2025-05-01',
      guarantee_days: null,
    });

    await admin.post(`/placements/${pendingPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 0.7,
    });
    await admin.post(`/placements/${pendingPlacementId}/contributors`, {
      producer_id: SEEDED.managerId,
      role: 'ManagerOverride',
      split_pct: 0.3,
    });

    await sql.unsafe(`UPDATE placements SET status = 'ContributorsAssigned' WHERE id = $1`, [
      pendingPlacementId,
    ]);
    await admin.post(`/placements/${pendingPlacementId}/attribution/submit`, {});

    // ── 5. E2E: Manager — disputed placement (MG-3, MG-4) ────────────────
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

    await admin.post(`/placements/${disputedPlacementId}/contributors`, {
      producer_id: SEEDED.producer2Id,
      role: 'CandidateOwner',
      split_pct: 0.6,
    });
    await admin.post(`/placements/${disputedPlacementId}/contributors`, {
      producer_id: SEEDED.managerId,
      role: 'ManagerOverride',
      split_pct: 0.4,
    });

    const { commission_records: disputeRecords } = await admin.post<{
      commission_records: Array<{ id: string }>;
    }>(`/placements/${disputedPlacementId}/calculate`);

    // Producer2 opens a dispute
    const producer = new ApiSession(baseUrl);
    await producer.login(SEEDED.producer2Id);

    const targetRecordId = disputeRecords[0].id;
    await producer.post('/me/disputes', {
      commission_record_id: targetRecordId,
      description: 'Split allocation does not reflect my contribution to this placement.',
    });

    // Second dispute (for separate escalation test)
    if (disputeRecords.length >= 2) {
      await producer.post('/me/disputes', {
        commission_record_id: disputeRecords[1].id,
        description: 'Second split dispute for escalation state test.',
      });
    } else {
      await producer.post('/me/disputes', {
        commission_record_id: targetRecordId,
        description: 'Second split dispute for escalation state test.',
      });
    }

    // ── 6. E2E: Manager — team isolation placement (MG-3) ─────────────────
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

    await admin.post(`/placements/${isolationPlacementId}/contributors`, {
      producer_id: SEEDED.producer2Id,
      role: 'CandidateOwner',
      split_pct: 0.9,
    });
    await admin.post(`/placements/${isolationPlacementId}/contributors`, {
      producer_id: SEEDED.manager2Id,
      role: 'ManagerOverride',
      split_pct: 0.1,
    });

    // ── 7. E2E: Finance Close — incomplete placement (FA-1) ──────────────
    const { id: incompletePlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Gap Placement',
      compensation_base: '80000',
      fee_pct: '0',
      start_date: '2025-05-01',
      guarantee_days: null,
    });

    // ── 8. E2E: Finance Close — complete placement (FA-2, FA-3, FA-4, FA-5) ──
    const { id: completePlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Close Placement',
      compensation_base: '120000',
      fee_amount: CLOSE.ledgerAmount,
      start_date: CLOSE.periodStart,
      guarantee_days: null,
    });

    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      completePlacementId,
    ]);

    await admin.post(`/placements/${completePlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
    });

    const { commission_records: closeRecords } = await admin.post<{
      commission_records: Array<{ id: string }>;
    }>(`/placements/${completePlacementId}/calculate`);

    const { id: closeRunId } = await admin.post<{ id: string }>('/commission-runs', {
      period_start: CLOSE.periodStart,
      period_end: CLOSE.periodEnd,
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
        await admin.post(
          `/commission-runs/${closeRunId}/records/${item.commission_record_id}/approve`,
        );
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
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Partner Deal',
      compensation_base: '100000',
      fee_amount: PARTNER.feeAmount,
      start_date: PARTNER.startDate,
      guarantee_days: null,
    });

    const { id: unrelatedPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Unrelated Deal',
      compensation_base: '90000',
      fee_amount: '7500',
      start_date: '2025-04-01',
      guarantee_days: null,
    });

    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = ANY($1)`, [
      [partnerPlacementId, unrelatedPlacementId],
    ]);

    await admin.post(`/placements/${partnerPlacementId}/contributors`, {
      producer_id: SEEDED.partnerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
    });
    await admin.post(`/placements/${unrelatedPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
    });

    // ── 12. E2E: Executive — escalated dispute (EX-4) ────────────────────
    const { id: escalatedPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'VP Engineering (Escalated)',
      compensation_base: '250000',
      fee_amount: '50000',
      start_date: '2025-05-01',
      guarantee_days: null,
    });

    await admin.post(`/placements/${escalatedPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
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

    const execDispute = await execProducer.post<{ id: string }>('/me/disputes', {
      commission_record_id: execTargetRecordId,
      description: 'Attribution dispute for executive escalation test.',
    });

    await sql.unsafe(`UPDATE disputes SET state = 'UnderReview' WHERE id = $1 AND org_id = $2`, [
      execDispute.id,
      SEEDED.orgId,
    ]);

    // ── 13. Demo: heterogeneous producer commission examples (issue #196) ──
    //
    // The existing E2E producer placement leaves the producer portal showing a
    // calculated amount with a $0 net (held for collection). These appended
    // placements demonstrate the calculation engine across realistic lifecycle
    // states: a fully Payable collected payout, a held-for-collection $0, a
    // tiered effective rate, a manager-override split reduction, a
    // guarantee-held $0, and a retained-search placement with phase-level
    // collection gating (PRD §5.1, §5.5). All belong to SEEDED.producerId so
    // they surface in the Producer Payout Portal.
    //
    // resolveActivePlanVersion picks the producer's MOST RECENTLY assigned
    // active plan (ORDER BY assigned_at DESC). Because the producer already
    // holds several plan assignments, each scenario (re)assigns the plan it
    // needs immediately before calling /calculate so the intended rules apply.

    /** Assign `planVersionId` to the producer so it becomes the most-recent active plan. */
    const assignProducerPlan = async (planId: string, planVersionId: string): Promise<void> => {
      await admin.post(`/plans/${planId}/assignments`, {
        producer_id: SEEDED.producerId,
        plan_version_id: planVersionId,
      });
    };

    // (a) Fully collected — 25% gross-fee payout, Payable.
    //     fee 30000 × 25% = $7,500 gross; split 1.0; invoice Paid releases the
    //     collection gate so the record transitions Held → Payable.
    const { plan: collectedPlan, version: collectedVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Demo Collected Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.25 },
    });
    await admin.post(`/plans/${collectedPlan.id}/versions/${collectedVersion.id}/activate`);
    await assignProducerPlan(collectedPlan.id, collectedVersion.id);

    const { id: collectedPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: DEMO_HETERO.collectedTitle,
      compensation_base: '240000',
      fee_amount: '30000',
      start_date: '2025-06-01',
      guarantee_days: null,
    });
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      collectedPlacementId,
    ]);
    await admin.post(`/placements/${collectedPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
    });
    const collectedInvoice = await admin.post<{ id: string }>('/invoices', {
      placement_id: collectedPlacementId,
      invoice_number: 'INV-DEMO-COLLECTED-196',
      amount_billed: '30000',
      issued_at: '2025-06-01T00:00:00.000Z',
    });
    // Mark the invoice Paid → releases the collection gate (Held → Payable).
    await admin.patch(`/invoices/${collectedInvoice.id}`, {
      status: 'Paid',
      amount_collected: '30000',
    });
    // Calculate commission after invoice is marked Paid so net_payable is released.
    await admin.post(`/placements/${collectedPlacementId}/calculate`);

    // (b) Held for collection — Active + calculated, no paid invoice → $0 net,
    //     "held for collection" explanation. fee 20000 × 25% = $5,000 gross held.
    const { id: heldCollPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: DEMO_HETERO.heldCollectionTitle,
      compensation_base: '160000',
      fee_amount: '20000',
      start_date: '2026-01-01',
      guarantee_days: null,
    });
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      heldCollPlacementId,
    ]);
    await admin.post(`/placements/${heldCollPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
    });
    // No invoice → collection gate holds the full amount (conservative gate).
    await admin.post(`/placements/${heldCollPlacementId}/calculate`);

    // (c) Tiered rate — a tiered plan whose effective tier rate differs from the
    //     base rate. fee 120000 × split 1.0 = 120000 commissionable; the
    //     100000-threshold tier (0.18) applies instead of base_rate 0.12.
    //     Invoice Paid so the non-zero tiered amount is Payable and visible.
    const { plan: demoTieredPlan, version: demoTieredVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Demo Tiered Plan',
      effective_from: '2025-01-01',
      rules: {
        rate_type: 'gross_fee',
        base_rate: 0.12,
        tiers: [
          { threshold: 0, rate: 0.12 },
          { threshold: 50000, rate: 0.15 },
          { threshold: 100000, rate: 0.18 },
        ],
      },
    });
    await admin.post(`/plans/${demoTieredPlan.id}/versions/${demoTieredVersion.id}/activate`);
    await assignProducerPlan(demoTieredPlan.id, demoTieredVersion.id);

    const { id: tieredPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: DEMO_HETERO.tieredTitle,
      compensation_base: '300000',
      fee_amount: '120000',
      start_date: '2025-07-01',
      guarantee_days: null,
    });
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [tieredPlacementId]);
    await admin.post(`/placements/${tieredPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
    });
    const tieredInvoice = await admin.post<{ id: string }>('/invoices', {
      placement_id: tieredPlacementId,
      invoice_number: 'INV-DEMO-TIERED-196',
      amount_billed: '120000',
      issued_at: '2025-07-01T00:00:00.000Z',
    });
    await admin.patch(`/invoices/${tieredInvoice.id}`, {
      status: 'Paid',
      amount_collected: '120000',
    });
    // Calculate commission after invoice is marked Paid so net_payable is released.
    await admin.post(`/placements/${tieredPlacementId}/calculate`);

    // (d) Manager-override split — split_pct < 1.0 demonstrates a split-based
    //     reduction. The producer takes 0.6 of the credit; a manager override
    //     takes the remaining 0.4. Flat 0.2 plan, invoice Paid → Payable.
    //     fee 50000 × 0.6 × 0.2 = $6,000 net for the producer (vs $10,000 at full credit).
    const { plan: demoSplitPlan, version: demoSplitVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Demo Split Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    });
    await admin.post(`/plans/${demoSplitPlan.id}/versions/${demoSplitVersion.id}/activate`);
    await assignProducerPlan(demoSplitPlan.id, demoSplitVersion.id);
    await admin.post(`/plans/${demoSplitPlan.id}/assignments`, {
      producer_id: SEEDED.managerId,
      plan_version_id: demoSplitVersion.id,
    });

    const { id: splitPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: DEMO_HETERO.splitTitle,
      compensation_base: '250000',
      fee_amount: '50000',
      start_date: '2025-08-01',
      guarantee_days: null,
    });
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [splitPlacementId]);
    await admin.post(`/placements/${splitPlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 0.6,
    });
    await admin.post(`/placements/${splitPlacementId}/contributors`, {
      producer_id: SEEDED.managerId,
      role: 'ManagerOverride',
      split_pct: 0.4,
    });
    const splitInvoice = await admin.post<{ id: string }>('/invoices', {
      placement_id: splitPlacementId,
      invoice_number: 'INV-DEMO-SPLIT-196',
      amount_billed: '50000',
      issued_at: '2025-08-01T00:00:00.000Z',
    });
    await admin.patch(`/invoices/${splitInvoice.id}`, {
      status: 'Paid',
      amount_collected: '50000',
    });
    // Calculate commission after invoice is marked Paid so net_payable is released.
    await admin.post(`/placements/${splitPlacementId}/calculate`);

    // (e) Guarantee-held — placement inside an active guarantee window shows $0
    //     net with a guarantee-hold explanation. We insert an Active
    //     guarantee_periods row with a future end date so resolveInsideGuaranteeWindow
    //     gates the amount. risk_amount is BYTEA NOT NULL — an empty buffer sentinel
    //     is acceptable (the demo never decrypts it). Invoice is Paid so the
    //     guarantee hold (not the collection gate) is unambiguously the reason.
    const { plan: demoGuarPlan, version: demoGuarVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Demo Guarantee Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    });
    await admin.post(`/plans/${demoGuarPlan.id}/versions/${demoGuarVersion.id}/activate`);
    await assignProducerPlan(demoGuarPlan.id, demoGuarVersion.id);

    const { id: guaranteePlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: DEMO_HETERO.guaranteeTitle,
      compensation_base: '300000',
      fee_amount: '45000',
      start_date: '2026-04-01',
      guarantee_days: 90,
    });
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      guaranteePlacementId,
    ]);
    await admin.post(`/placements/${guaranteePlacementId}/contributors`, {
      producer_id: SEEDED.producerId,
      role: 'CandidateOwner',
      split_pct: 1.0,
    });
    // Create the paid invoice.
    const guarInvoice = await admin.post<{ id: string }>('/invoices', {
      placement_id: guaranteePlacementId,
      invoice_number: 'INV-DEMO-GUARANTEE-196',
      amount_billed: '45000',
      issued_at: '2026-04-01T00:00:00.000Z',
    });
    await admin.patch(`/invoices/${guarInvoice.id}`, { status: 'Paid', amount_collected: '45000' });
    // Set up the active guarantee window before calculating (so the calculation detects it).
    await sql.unsafe(
      `INSERT INTO guarantee_periods (org_id, placement_id, guarantee_ends, status, risk_amount)
       VALUES ($1, $2, $3, 'Active', $4)`,
      [SEEDED.orgId, guaranteePlacementId, '2026-12-31', Buffer.alloc(0)],
    );
    // Calculate commission (it will be held due to the guarantee window, not collection gate).
    await admin.post(`/placements/${guaranteePlacementId}/calculate`);

    // (f) Retained search — phase-level collection gating (PRD §5.5).
    //     Two billing phases: retainer (invoice Paid → Payable) and delivery
    //     (invoice unpaid → Held). A paid retainer does NOT release held delivery
    //     commission. Calculated via /calculate-phases (one record per phase).
    const { plan: demoRetainedPlan, version: demoRetainedVersion } = await admin.post<{
      plan: { id: string };
      version: { id: string };
    }>('/plans', {
      name: 'Demo Retained Plan',
      effective_from: '2025-01-01',
      rules: { rate_type: 'gross_fee', base_rate: 0.2 },
    });
    await admin.post(`/plans/${demoRetainedPlan.id}/versions/${demoRetainedVersion.id}/activate`);
    await assignProducerPlan(demoRetainedPlan.id, demoRetainedVersion.id);

    const { id: retainedPlacementId } = await admin.post<{ id: string }>('/placements', {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: DEMO_HETERO.retainedTitle,
      compensation_base: '350000',
      fee_amount: '70000',
      start_date: '2025-09-01',
      guarantee_days: null,
    });
    await sql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [
      retainedPlacementId,
    ]);
    // The producer must be a placement-level contributor before being assigned
    // to a billing phase (phase-contributor create verifies placement membership).
    const retainedContributor = await admin.post<{ id: string }>(
      `/placements/${retainedPlacementId}/contributors`,
      { producer_id: SEEDED.producerId, role: 'CandidateOwner', split_pct: 1.0 },
    );

    // Retainer phase — invoice issued then Paid (commission releases to Payable).
    const retainerInvoice = await admin.post<{ id: string }>('/invoices', {
      placement_id: retainedPlacementId,
      invoice_number: 'INV-DEMO-RETAINER-196',
      amount_billed: '20000',
      issued_at: '2025-09-01T00:00:00.000Z',
    });
    const { billing_phase: retainerPhase } = await admin.post<{ billing_phase: { id: string } }>(
      `/placements/${retainedPlacementId}/billing-phases`,
      { phase_name: 'retainer', projected_amount: '20000', invoice_id: retainerInvoice.id },
    );
    await admin.post(
      `/placements/${retainedPlacementId}/billing-phases/${retainerPhase.id}/contributors`,
      {
        contributor_id: retainedContributor.id,
        split_pct: 1.0,
      },
    );

    // Delivery phase — invoice issued but left UNPAID (commission stays Held).
    const deliveryInvoice = await admin.post<{ id: string }>('/invoices', {
      placement_id: retainedPlacementId,
      invoice_number: 'INV-DEMO-DELIVERY-196',
      amount_billed: '50000',
      issued_at: '2025-10-01T00:00:00.000Z',
    });
    const { billing_phase: deliveryPhase } = await admin.post<{ billing_phase: { id: string } }>(
      `/placements/${retainedPlacementId}/billing-phases`,
      { phase_name: 'delivery', projected_amount: '50000', invoice_id: deliveryInvoice.id },
    );
    await admin.post(
      `/placements/${retainedPlacementId}/billing-phases/${deliveryPhase.id}/contributors`,
      {
        contributor_id: retainedContributor.id,
        split_pct: 1.0,
      },
    );

    // Calculate per-phase: delivery is Held (unpaid), retainer is Held pending its
    // invoice. Marking the retainer invoice Paid releases ONLY the retainer-phase
    // record (Held → Payable) and leaves delivery Held — phase-level gating.
    await admin.post(`/placements/${retainedPlacementId}/calculate-phases`);
    await admin.patch(`/invoices/${retainerInvoice.id}`, {
      status: 'Paid',
      amount_collected: '20000',
    });

    // Create an approved commission run for the demo heterogeneous placements so they
    // appear in the Payout Statement (GET /me/payouts). This demonstrates the difference
    // between Credited Placements (all commission records) and Payouts (approved runs).
    const heteroRunPlacementIds = [
      collectedPlacementId,
      heldCollPlacementId,
      tieredPlacementId,
      splitPlacementId,
      guaranteePlacementId,
      retainedPlacementId,
    ];

    const { id: heteroRunId } = await admin.post<{ id: string }>('/commission-runs', {
      period_start: '2025-06-01',
      period_end: '2026-05-31',
      placement_ids: heteroRunPlacementIds,
    });

    // Approve all records in the hetero run so they appear as payouts.
    const { queue: heteroQueue } = await admin.get<{
      queue: Array<{ commission_record_id: string }>;
    }>(`/commission-runs/${heteroRunId}/queue`);

    for (const item of heteroQueue) {
      try {
        await admin.post(
          `/commission-runs/${heteroRunId}/records/${item.commission_record_id}/approve`,
        );
      } catch {
        // already approved or error — non-fatal
      }
    }

    // Approve the entire run.
    try {
      await admin.post(`/commission-runs/${heteroRunId}/approve`);
    } catch {
      // non-fatal if already approved
    }

    // ── 14. Demo: Producer Deal Simulator history (issue #262) ────────────
    //
    // The Deal Simulator "Actual Deals" tab derives the producer's registered
    // deals from prior simulation_run input_params, so the demo Producer needs
    // at least one simulation_run row per deal to have deals to (re)simulate
    // end-to-end. We seed completed forecasts for several of the producer's own
    // placements so the surface is populated; the producer can re-run any of
    // them live (which spawns the `claude` CLI worker). Rows carry a 30-day TTL.
    //
    // These INSERTs are additive and touch only simulation_run (an ephemeral,
    // forecast-only table) — they never create or alter a placement, commission,
    // or payout, preserving the read-only simulation guarantee.
    const simDealIds = [collectedPlacementId, tieredPlacementId, splitPlacementId];
    const simForecasts: Array<{ payout: number; risk: string; reasoning: string }> = [
      {
        payout: 7500,
        risk: 'low',
        reasoning:
          'Based on your Demo Collected Plan (25% gross-fee rate) the collected $30,000 fee yields a $7,500 payout. Low dispute risk: a single full-credit split with a paid invoice.',
      },
      {
        payout: 21600,
        risk: 'moderate',
        reasoning:
          'Under your Demo Tiered Plan the $120,000 fee reaches the 18% tier, projecting a $21,600 payout. Moderate dispute risk: tier-boundary placements are more often questioned.',
      },
      {
        payout: 6000,
        risk: 'moderate',
        reasoning:
          'Your Demo Split Plan (20% gross-fee) credits 60% of the $50,000 fee to you: $6,000. Moderate dispute risk because of the manager-override split.',
      },
    ];
    const simTtl = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < simDealIds.length; i++) {
      const f = simForecasts[i];
      await sql.unsafe(
        `INSERT INTO simulation_run
           (org_id, producer_id, job_id, input_params, result_json, ttl_expires_at)
         VALUES ($1, $2, NULL, $3::jsonb, $4::jsonb, $5)`,
        [
          SEEDED.orgId,
          SEEDED.producerId,
          JSON.stringify({ kind: 'actual', deal_id: simDealIds[i] }),
          JSON.stringify({
            payout_estimate: f.payout,
            dispute_risk: f.risk,
            reasoning: f.reasoning,
          }),
          simTtl,
        ],
      );
    }

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

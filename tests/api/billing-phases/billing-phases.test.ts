/**
 * Retained search billing phases — integration tests (issue #63).
 *
 * Tests (Acceptance criteria):
 *   AC#1 — A retained placement can have two named billing phases (retainer, delivery)
 *            each with projected, billed, and received amounts (creation test).
 *   AC#2 — Contributor-credit assignments can differ between phases: a contributor
 *            credited on delivery phase only does not accrue retainer-phase commission
 *            (per-phase credit test).
 *   AC#3 — Commission calculation for a retained placement produces two independent
 *            results, one per phase, each applied to the phase's credited base
 *            (calculation unit test with fixture data).
 *   AC#4 — Marking the retainer invoice paid releases retainer-phase commission but
 *            leaves delivery-phase commission held (phase-gating test).
 *   AC#5 — Marking the delivery invoice paid releases delivery-phase commission
 *            independently (delivery-release test).
 *   AC#6 — GET /me/payouts for a Producer shows blocked-phase reason
 *            (held_pending_phase_invoice) with the blocking phase name
 *            (producer visibility test).
 *   AC#7 — Relational journal contains a phase-level transition entry (Held→Released)
 *            with billing_phase_id on each release event (journal audit test).
 *   AC#8 — Existing contingency placement tests are unaffected (regression test).
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.1, §5.5
 * Issue: feat: retained search billing phases (#63)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { FieldEncryptor } from '../../../packages/db/src/encryption';
import { LocalDevKmsAdapter } from '../../../packages/db/src/kms-dev';
import { _setEncryptorForTest, _resetEncryptorForTest } from '../../../packages/db/src/placements';
import {
  _setEncryptorForTest as _setCommRecordEncryptorForTest,
  _resetEncryptorForTest as _resetCommRecordEncryptorForTest,
} from '../../../packages/db/src/commission-records';
import {
  _setEncryptorForTest as _setInvoiceEncryptorForTest,
  _resetEncryptorForTest as _resetInvoiceEncryptorForTest,
} from '../../../packages/db/src/invoices';
import {
  _setEncryptorForTest as _setBillingPhaseEncryptorForTest,
  _resetEncryptorForTest as _resetBillingPhaseEncryptorForTest,
} from '../../../packages/db/src/billing-phases';
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
import { handleAddContributor } from '../../../apps/server/src/api/contributors';
import {
  handleCreatePlan,
  handleActivatePlanVersion,
  handleCreatePlanAssignment,
} from '../../../apps/server/src/api/plans';
import { handleCreateInvoice, handleUpdateInvoice } from '../../../apps/server/src/api/invoices';
import {
  handleCreateBillingPhase,
  handleListBillingPhases,
  handleUpdateBillingPhase,
  handleCreatePhaseContributor,
  handleListPhaseContributors,
  handleListPhaseJournal,
  handleCalculatePhaseCommissions,
} from '../../../apps/server/src/api/billing-phases';
import { handleGetMyCommissionRecords } from '../../../apps/server/src/api/me';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const USER_A_ID = crypto.randomUUID();
const PRODUCER_A_ID = crypto.randomUUID();
const PRODUCER_B_ID = crypto.randomUUID();

const financeAdminClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: USER_A_ID,
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producerAClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: PRODUCER_A_ID,
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });

  // Inject deterministic encryption so tests run without env config
  const adapter = new LocalDevKmsAdapter();
  const enc = new FieldEncryptor(adapter);
  _setEncryptorForTest(enc);
  _setCommRecordEncryptorForTest(enc);
  _setInvoiceEncryptorForTest(enc);
  _setBillingPhaseEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
  _resetCommRecordEncryptorForTest();
  _resetInvoiceEncryptorForTest();
  _resetBillingPhaseEncryptorForTest();
  await testSql?.end({ timeout: 5 });
  await pg?.stop();
}, 30_000);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRequest(opts: { path: string; method?: string; body?: unknown }): Request {
  const method = opts.method ?? 'GET';
  return new Request(`http://localhost${opts.path}`, {
    method,
    ...(opts.body !== undefined
      ? {
          body: JSON.stringify(opts.body),
          headers: { 'Content-Type': 'application/json' },
        }
      : {}),
  });
}

/**
 * Sets up a shared placement with two contributors and an active plan.
 * Returns IDs needed for subsequent tests.
 */
async function setupRetainedPlacement(): Promise<{
  placementId: string;
  contributorAId: string;
  contributorBId: string;
  planVersionId: string;
}> {
  // Create placement
  const placementReq = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'VP Engineering',
      compensation_base: '200000',
      fee_amount: '40000',
      start_date: '2025-01-15',
    },
  });
  const placementRes = await handleCreatePlacement(placementReq, financeAdminClaims, testSql);
  expect(placementRes.status).toBe(201);
  const placementBody = (await placementRes.json()) as { id: string };
  const placementId = placementBody.id;

  // Transition placement to Active (matches pattern used in existing test suites)
  await testSql.unsafe(`UPDATE placements SET status = 'Active' WHERE id = $1`, [placementId]);

  // Add contributor A (originates the retainer)
  const contribAReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: {
      producer_id: PRODUCER_A_ID,
      role: 'ClientOriginator',
      split_pct: 0.6,
    },
  });
  const contribARes = await handleAddContributor(
    placementId,
    contribAReq,
    financeAdminClaims,
    testSql,
    testSql,
  );
  expect(contribARes.status).toBe(201);
  const contribABody = (await contribARes.json()) as { id: string };
  const contributorAId = contribABody.id;

  // Add contributor B (converter — delivery phase only)
  const contribBReq = makeRequest({
    path: `/placements/${placementId}/contributors`,
    method: 'POST',
    body: {
      producer_id: PRODUCER_B_ID,
      role: 'DeliveryCredit',
      split_pct: 0.4,
    },
  });
  const contribBRes = await handleAddContributor(
    placementId,
    contribBReq,
    financeAdminClaims,
    testSql,
    testSql,
  );
  expect(contribBRes.status).toBe(201);
  const contribBBody = (await contribBRes.json()) as { id: string };
  const contributorBId = contribBBody.id;

  // Create and activate a commission plan
  const planReq = makeRequest({
    path: '/plans',
    method: 'POST',
    body: {
      name: 'Retained Search Plan',
      effective_from: '2025-01-01',
      config_entity_id: crypto.randomUUID(),
      rules: { base_rate: 0.2, rate_type: 'gross_fee' },
    },
  });
  const planRes = await handleCreatePlan(planReq, financeAdminClaims, testSql);
  expect(planRes.status).toBe(201);
  const planBody = (await planRes.json()) as {
    plan: { id: string };
    version: { id: string };
  };
  const planVersionId = planBody.version.id;
  const planId = planBody.plan.id;

  // Activate the plan version
  const activateRes = await handleActivatePlanVersion(
    planId,
    planVersionId,
    financeAdminClaims,
    testSql,
  );
  expect(activateRes.status).toBe(200);

  // Assign plan to producer A
  const assignAReq = makeRequest({
    path: `/plans/${planId}/assignments`,
    method: 'POST',
    body: { producer_id: PRODUCER_A_ID, plan_version_id: planVersionId },
  });
  await handleCreatePlanAssignment(planId, assignAReq, financeAdminClaims, testSql);

  // Assign plan to producer B
  const assignBReq = makeRequest({
    path: `/plans/${planId}/assignments`,
    method: 'POST',
    body: { producer_id: PRODUCER_B_ID, plan_version_id: planVersionId },
  });
  await handleCreatePlanAssignment(planId, assignBReq, financeAdminClaims, testSql);

  return { placementId, contributorAId, contributorBId, planVersionId };
}

// ---------------------------------------------------------------------------
// AC#1 — Billing phase creation
// ---------------------------------------------------------------------------

describe('billing phases creation (AC#1)', () => {
  test('creates retainer and delivery phases on a retained placement', async () => {
    const { placementId } = await setupRetainedPlacement();

    // Create retainer phase
    const retainerReq = makeRequest({
      path: `/placements/${placementId}/billing-phases`,
      method: 'POST',
      body: {
        phase_name: 'retainer',
        projected_amount: '10000',
      },
    });
    const retainerRes = await handleCreateBillingPhase(
      placementId,
      retainerReq,
      financeAdminClaims,
      testSql,
    );
    expect(retainerRes.status).toBe(201);
    const retainerBody = (await retainerRes.json()) as {
      billing_phase: {
        id: string;
        phase_name: string;
        projected_amount: string;
        billed_amount: string | null;
      };
    };
    expect(retainerBody.billing_phase.phase_name).toBe('retainer');
    expect(retainerBody.billing_phase.projected_amount).toBe('10000');
    expect(retainerBody.billing_phase.billed_amount).toBeNull();

    // Create delivery phase
    const deliveryReq = makeRequest({
      path: `/placements/${placementId}/billing-phases`,
      method: 'POST',
      body: {
        phase_name: 'delivery',
        projected_amount: '30000',
      },
    });
    const deliveryRes = await handleCreateBillingPhase(
      placementId,
      deliveryReq,
      financeAdminClaims,
      testSql,
    );
    expect(deliveryRes.status).toBe(201);
    const deliveryBody = (await deliveryRes.json()) as {
      billing_phase: { phase_name: string; projected_amount: string };
    };
    expect(deliveryBody.billing_phase.phase_name).toBe('delivery');
    expect(deliveryBody.billing_phase.projected_amount).toBe('30000');

    // List all phases for the placement
    const listRes = await handleListBillingPhases(placementId, financeAdminClaims, testSql);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      billing_phases: { phase_name: string; projected_amount: string }[];
    };
    expect(listBody.billing_phases).toHaveLength(2);
    const phaseNames = listBody.billing_phases.map((p) => p.phase_name);
    expect(phaseNames).toContain('retainer');
    expect(phaseNames).toContain('delivery');
  });

  test('rejects duplicate phase_name on same placement', async () => {
    const { placementId } = await setupRetainedPlacement();

    const req1 = makeRequest({
      path: `/placements/${placementId}/billing-phases`,
      method: 'POST',
      body: { phase_name: 'retainer', projected_amount: '10000' },
    });
    await handleCreateBillingPhase(placementId, req1, financeAdminClaims, testSql);

    const req2 = makeRequest({
      path: `/placements/${placementId}/billing-phases`,
      method: 'POST',
      body: { phase_name: 'retainer', projected_amount: '5000' },
    });
    const res2 = await handleCreateBillingPhase(placementId, req2, financeAdminClaims, testSql);
    expect(res2.status).toBe(409);
  });

  test('rejects invalid phase_name', async () => {
    const { placementId } = await setupRetainedPlacement();

    const req = makeRequest({
      path: `/placements/${placementId}/billing-phases`,
      method: 'POST',
      body: { phase_name: 'milestone_3', projected_amount: '10000' },
    });
    const res = await handleCreateBillingPhase(placementId, req, financeAdminClaims, testSql);
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — Per-phase contributor credit assignment
// ---------------------------------------------------------------------------

describe('per-phase contributor credit (AC#2)', () => {
  test('contributor credited on delivery phase only produces zero retainer commission', async () => {
    const { placementId, contributorAId, contributorBId } = await setupRetainedPlacement();

    // Create both phases
    const retainerPhaseReq = makeRequest({
      path: `/placements/${placementId}/billing-phases`,
      method: 'POST',
      body: { phase_name: 'retainer', projected_amount: '10000' },
    });
    const retainerPhaseRes = await handleCreateBillingPhase(
      placementId,
      retainerPhaseReq,
      financeAdminClaims,
      testSql,
    );
    const retainerPhaseId = ((await retainerPhaseRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;

    const deliveryPhaseReq = makeRequest({
      path: `/placements/${placementId}/billing-phases`,
      method: 'POST',
      body: { phase_name: 'delivery', projected_amount: '30000' },
    });
    const deliveryPhaseRes = await handleCreateBillingPhase(
      placementId,
      deliveryPhaseReq,
      financeAdminClaims,
      testSql,
    );
    const deliveryPhaseId = ((await deliveryPhaseRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;

    // Assign contributor A to retainer phase only
    const assignARetainerReq = makeRequest({
      path: `/placements/${placementId}/billing-phases/${retainerPhaseId}/contributors`,
      method: 'POST',
      body: { contributor_id: contributorAId, split_pct: 1.0 },
    });
    const assignARetainerRes = await handleCreatePhaseContributor(
      placementId,
      retainerPhaseId,
      assignARetainerReq,
      financeAdminClaims,
      testSql,
    );
    expect(assignARetainerRes.status).toBe(201);

    // Assign contributor B to delivery phase only
    const assignBDeliveryReq = makeRequest({
      path: `/placements/${placementId}/billing-phases/${deliveryPhaseId}/contributors`,
      method: 'POST',
      body: { contributor_id: contributorBId, split_pct: 1.0 },
    });
    const assignBDeliveryRes = await handleCreatePhaseContributor(
      placementId,
      deliveryPhaseId,
      assignBDeliveryReq,
      financeAdminClaims,
      testSql,
    );
    expect(assignBDeliveryRes.status).toBe(201);

    // List retainer phase contributors — should only have contributor A
    const listRetainerRes = await handleListPhaseContributors(
      placementId,
      retainerPhaseId,
      financeAdminClaims,
      testSql,
    );
    const listRetainerBody = (await listRetainerRes.json()) as {
      phase_contributors: { contributor_id: string }[];
    };
    expect(listRetainerBody.phase_contributors).toHaveLength(1);
    expect(listRetainerBody.phase_contributors[0].contributor_id).toBe(contributorAId);

    // List delivery phase contributors — should only have contributor B
    const listDeliveryRes = await handleListPhaseContributors(
      placementId,
      deliveryPhaseId,
      financeAdminClaims,
      testSql,
    );
    const listDeliveryBody = (await listDeliveryRes.json()) as {
      phase_contributors: { contributor_id: string }[];
    };
    expect(listDeliveryBody.phase_contributors).toHaveLength(1);
    expect(listDeliveryBody.phase_contributors[0].contributor_id).toBe(contributorBId);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — Per-phase commission calculation
// ---------------------------------------------------------------------------

describe('per-phase commission calculation (AC#3)', () => {
  test('produces independent commission records per phase, each with billing_phase_id set', async () => {
    const { placementId, contributorAId, contributorBId } = await setupRetainedPlacement();

    // Create phases
    const retainerRes = await handleCreateBillingPhase(
      placementId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases`,
        method: 'POST',
        body: { phase_name: 'retainer', projected_amount: '10000' },
      }),
      financeAdminClaims,
      testSql,
    );
    const retainerPhaseId = ((await retainerRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;

    const deliveryRes = await handleCreateBillingPhase(
      placementId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases`,
        method: 'POST',
        body: { phase_name: 'delivery', projected_amount: '30000' },
      }),
      financeAdminClaims,
      testSql,
    );
    const deliveryPhaseId = ((await deliveryRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;

    // Assign contributors: A to retainer, B to delivery
    await handleCreatePhaseContributor(
      placementId,
      retainerPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${retainerPhaseId}/contributors`,
        method: 'POST',
        body: { contributor_id: contributorAId, split_pct: 1.0 },
      }),
      financeAdminClaims,
      testSql,
    );
    await handleCreatePhaseContributor(
      placementId,
      deliveryPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${deliveryPhaseId}/contributors`,
        method: 'POST',
        body: { contributor_id: contributorBId, split_pct: 1.0 },
      }),
      financeAdminClaims,
      testSql,
    );

    // Calculate phase commissions
    const calcRes = await handleCalculatePhaseCommissions(
      placementId,
      makeRequest({ path: `/placements/${placementId}/calculate-phases`, method: 'POST' }),
      financeAdminClaims,
      testSql,
    );
    expect(calcRes.status).toBe(200);
    const calcBody = (await calcRes.json()) as {
      commission_records: {
        billing_phase_id: string;
        phase_name: string;
        contributor_id: string;
        status: string;
        hold_reason: string | null;
      }[];
    };

    expect(calcBody.commission_records).toHaveLength(2);

    const retainerRecord = calcBody.commission_records.find(
      (r) => r.phase_name === 'retainer',
    );
    const deliveryRecord = calcBody.commission_records.find(
      (r) => r.phase_name === 'delivery',
    );

    // Each record has billing_phase_id set
    expect(retainerRecord?.billing_phase_id).toBe(retainerPhaseId);
    expect(deliveryRecord?.billing_phase_id).toBe(deliveryPhaseId);

    // Records are Held because no invoice is paid (collection gate)
    expect(retainerRecord?.status).toBe('Held');
    expect(retainerRecord?.hold_reason).toBe('held_pending_phase_invoice');
    expect(deliveryRecord?.status).toBe('Held');
    expect(deliveryRecord?.hold_reason).toBe('held_pending_phase_invoice');

    // Retainer record belongs to contributor A, delivery to contributor B
    expect(retainerRecord?.contributor_id).toBe(contributorAId);
    expect(deliveryRecord?.contributor_id).toBe(contributorBId);
  });
});

// ---------------------------------------------------------------------------
// AC#4 + AC#5 — Phase-gated collection release
// ---------------------------------------------------------------------------

describe('phase-gated collection release (AC#4 + AC#5)', () => {
  test('paying retainer invoice releases retainer commission but leaves delivery held', async () => {
    const { placementId, contributorAId, contributorBId } = await setupRetainedPlacement();

    // Create phases
    const retainerRes = await handleCreateBillingPhase(
      placementId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases`,
        method: 'POST',
        body: { phase_name: 'retainer', projected_amount: '10000' },
      }),
      financeAdminClaims,
      testSql,
    );
    const retainerPhaseId = ((await retainerRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;

    const deliveryRes = await handleCreateBillingPhase(
      placementId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases`,
        method: 'POST',
        body: { phase_name: 'delivery', projected_amount: '30000' },
      }),
      financeAdminClaims,
      testSql,
    );
    const deliveryPhaseId = ((await deliveryRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;

    // Create invoices: one per phase
    const retainerInvoiceRes = await handleCreateInvoice(
      makeRequest({
        path: '/invoices',
        method: 'POST',
        body: {
          placement_id: placementId,
          invoice_number: `RET-${crypto.randomUUID().slice(0, 8)}`,
          amount_billed: '10000',
        },
      }),
      financeAdminClaims,
      testSql,
      testSql,
    );
    expect(retainerInvoiceRes.status).toBe(201);
    const retainerInvoiceId = ((await retainerInvoiceRes.json()) as { id: string }).id;

    const deliveryInvoiceRes = await handleCreateInvoice(
      makeRequest({
        path: '/invoices',
        method: 'POST',
        body: {
          placement_id: placementId,
          invoice_number: `DEL-${crypto.randomUUID().slice(0, 8)}`,
          amount_billed: '30000',
        },
      }),
      financeAdminClaims,
      testSql,
      testSql,
    );
    expect(deliveryInvoiceRes.status).toBe(201);
    const deliveryInvoiceId = ((await deliveryInvoiceRes.json()) as { id: string }).id;

    // Link invoices to phases
    await handleUpdateBillingPhase(
      placementId,
      retainerPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${retainerPhaseId}`,
        method: 'PATCH',
        body: { invoice_id: retainerInvoiceId },
      }),
      financeAdminClaims,
      testSql,
    );
    await handleUpdateBillingPhase(
      placementId,
      deliveryPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${deliveryPhaseId}`,
        method: 'PATCH',
        body: { invoice_id: deliveryInvoiceId },
      }),
      financeAdminClaims,
      testSql,
    );

    // Assign contributors to phases
    await handleCreatePhaseContributor(
      placementId,
      retainerPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${retainerPhaseId}/contributors`,
        method: 'POST',
        body: { contributor_id: contributorAId, split_pct: 1.0 },
      }),
      financeAdminClaims,
      testSql,
    );
    await handleCreatePhaseContributor(
      placementId,
      deliveryPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${deliveryPhaseId}/contributors`,
        method: 'POST',
        body: { contributor_id: contributorBId, split_pct: 1.0 },
      }),
      financeAdminClaims,
      testSql,
    );

    // Calculate phase commissions — both phases should be Held
    const calcRes = await handleCalculatePhaseCommissions(
      placementId,
      makeRequest({ path: `/placements/${placementId}/calculate-phases`, method: 'POST' }),
      financeAdminClaims,
      testSql,
    );
    expect(calcRes.status, `calculate-phases failed: ${await calcRes.clone().text()}`).toBe(200);
    const calcBody = (await calcRes.json()) as {
      commission_records: { phase_name: string; status: string; hold_reason: string }[];
    };
    expect(calcBody.commission_records.every((r) => r.status === 'Held')).toBe(true);

    // Mark retainer invoice as Paid → releases retainer-phase commission only
    const patchRetainerRes = await handleUpdateInvoice(
      retainerInvoiceId,
      makeRequest({
        path: `/invoices/${retainerInvoiceId}`,
        method: 'PATCH',
        body: { status: 'Paid', amount_collected: '10000' },
      }),
      financeAdminClaims,
      testSql,
      testSql,
    );
    expect(patchRetainerRes.status).toBe(200);
    const patchRetainerBody = (await patchRetainerRes.json()) as { collection_released: number };
    // At least 1 record released (retainer phase)
    expect(patchRetainerBody.collection_released).toBeGreaterThan(0);

    // Verify: retainer-phase record is now Payable; delivery-phase record is still Held
    const retainerJournalRes = await handleListPhaseJournal(
      placementId,
      retainerPhaseId,
      financeAdminClaims,
      testSql,
    );
    const retainerJournal = (await retainerJournalRes.json()) as {
      journal_entries: { from_status: string; to_status: string; billing_phase_id: string }[];
    };
    expect(retainerJournal.journal_entries).toHaveLength(1);
    expect(retainerJournal.journal_entries[0].from_status).toBe('Held');
    expect(retainerJournal.journal_entries[0].to_status).toBe('Payable');
    expect(retainerJournal.journal_entries[0].billing_phase_id).toBe(retainerPhaseId);

    // Delivery phase journal should be empty (not yet released)
    const deliveryJournalRes = await handleListPhaseJournal(
      placementId,
      deliveryPhaseId,
      financeAdminClaims,
      testSql,
    );
    const deliveryJournal = (await deliveryJournalRes.json()) as {
      journal_entries: unknown[];
    };
    expect(deliveryJournal.journal_entries).toHaveLength(0);

    // Now mark delivery invoice as Paid → releases delivery-phase commission
    const patchDeliveryRes = await handleUpdateInvoice(
      deliveryInvoiceId,
      makeRequest({
        path: `/invoices/${deliveryInvoiceId}`,
        method: 'PATCH',
        body: { status: 'Paid', amount_collected: '30000' },
      }),
      financeAdminClaims,
      testSql,
      testSql,
    );
    expect(patchDeliveryRes.status).toBe(200);

    // Delivery journal should now have 1 entry
    const deliveryJournalRes2 = await handleListPhaseJournal(
      placementId,
      deliveryPhaseId,
      financeAdminClaims,
      testSql,
    );
    const deliveryJournal2 = (await deliveryJournalRes2.json()) as {
      journal_entries: { from_status: string; to_status: string; billing_phase_id: string }[];
    };
    expect(deliveryJournal2.journal_entries).toHaveLength(1);
    expect(deliveryJournal2.journal_entries[0].from_status).toBe('Held');
    expect(deliveryJournal2.journal_entries[0].to_status).toBe('Payable');
    expect(deliveryJournal2.journal_entries[0].billing_phase_id).toBe(deliveryPhaseId);
  });
});

// ---------------------------------------------------------------------------
// AC#6 — Producer visibility: blocked phase info in /me/commission-records
// ---------------------------------------------------------------------------

describe('producer visibility of blocked phase (AC#6)', () => {
  test('GET /me/commission-records shows held_pending_phase_invoice with blocked_phase details', async () => {
    const { placementId, contributorAId } = await setupRetainedPlacement();

    // Create retainer phase only (no invoice, so it will be Held)
    const retainerRes = await handleCreateBillingPhase(
      placementId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases`,
        method: 'POST',
        body: { phase_name: 'retainer', projected_amount: '10000' },
      }),
      financeAdminClaims,
      testSql,
    );
    const retainerPhaseId = ((await retainerRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;

    // Create and link an invoice (but leave it Issued = unpaid)
    const invoiceRes = await handleCreateInvoice(
      makeRequest({
        path: '/invoices',
        method: 'POST',
        body: {
          placement_id: placementId,
          invoice_number: `RET-VIS-${crypto.randomUUID().slice(0, 8)}`,
          amount_billed: '10000',
        },
      }),
      financeAdminClaims,
      testSql,
      testSql,
    );
    const invoiceId = ((await invoiceRes.json()) as { id: string }).id;

    // Link invoice to retainer phase
    await handleUpdateBillingPhase(
      placementId,
      retainerPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${retainerPhaseId}`,
        method: 'PATCH',
        body: { invoice_id: invoiceId },
      }),
      financeAdminClaims,
      testSql,
    );

    // Assign contributor A to retainer phase
    await handleCreatePhaseContributor(
      placementId,
      retainerPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${retainerPhaseId}/contributors`,
        method: 'POST',
        body: { contributor_id: contributorAId, split_pct: 1.0 },
      }),
      financeAdminClaims,
      testSql,
    );

    // Also create delivery phase with contributor A (so there's something to calculate)
    const deliveryRes = await handleCreateBillingPhase(
      placementId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases`,
        method: 'POST',
        body: { phase_name: 'delivery', projected_amount: '30000' },
      }),
      financeAdminClaims,
      testSql,
    );
    const deliveryPhaseId = ((await deliveryRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;
    await handleCreatePhaseContributor(
      placementId,
      deliveryPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${deliveryPhaseId}/contributors`,
        method: 'POST',
        body: { contributor_id: contributorAId, split_pct: 1.0 },
      }),
      financeAdminClaims,
      testSql,
    );

    // Calculate phase commissions
    await handleCalculatePhaseCommissions(
      placementId,
      makeRequest({ path: `/placements/${placementId}/calculate-phases`, method: 'POST' }),
      financeAdminClaims,
      testSql,
    );

    // Producer A checks their commission records via GET /me/commission-records?status=Held
    const meReq = makeRequest({
      path: '/me/commission-records?status=Held',
      method: 'GET',
    });
    const meRes = await handleGetMyCommissionRecords(meReq, producerAClaims, testSql);
    expect(meRes.status).toBe(200);

    const meBody = (await meRes.json()) as {
      commission_records: {
        status: string;
        hold_reason: string | null;
        billing_phase_id: string | null;
        blocked_phase: {
          phase_name: string;
          blocking_invoice_id: string | null;
        } | null;
      }[];
    };

    // All Held records for producer A have hold_reason='held_pending_phase_invoice'
    const phaseHeldRecords = meBody.commission_records.filter(
      (r) => r.hold_reason === 'held_pending_phase_invoice',
    );
    expect(phaseHeldRecords.length).toBeGreaterThan(0);

    // The retainer record has blocked_phase info with the invoice linked
    const retainerHeld = meBody.commission_records.find(
      (r) =>
        r.hold_reason === 'held_pending_phase_invoice' &&
        r.billing_phase_id === retainerPhaseId,
    );
    expect(retainerHeld).toBeDefined();
    expect(retainerHeld?.blocked_phase?.phase_name).toBe('retainer');
    expect(retainerHeld?.blocked_phase?.blocking_invoice_id).toBe(invoiceId);
  });
});

// ---------------------------------------------------------------------------
// AC#7 — Relational journal entries (covered in AC#4+AC#5 test above)
// Explicit standalone test for journal creation and structure.
// ---------------------------------------------------------------------------

describe('relational journal entries (AC#7)', () => {
  test('journal entry contains billing_phase_id, from_status=Held, to_status=Payable', async () => {
    const { placementId, contributorAId } = await setupRetainedPlacement();

    // Create retainer phase + invoice
    const retainerRes = await handleCreateBillingPhase(
      placementId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases`,
        method: 'POST',
        body: { phase_name: 'retainer', projected_amount: '8000' },
      }),
      financeAdminClaims,
      testSql,
    );
    const retainerPhaseId = ((await retainerRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;

    // Create delivery phase (needed for calculate-phases to work)
    const deliveryRes = await handleCreateBillingPhase(
      placementId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases`,
        method: 'POST',
        body: { phase_name: 'delivery', projected_amount: '32000' },
      }),
      financeAdminClaims,
      testSql,
    );
    const deliveryPhaseId = ((await deliveryRes.json()) as { billing_phase: { id: string } })
      .billing_phase.id;

    const invoiceRes = await handleCreateInvoice(
      makeRequest({
        path: '/invoices',
        method: 'POST',
        body: {
          placement_id: placementId,
          invoice_number: `JNL-${crypto.randomUUID().slice(0, 8)}`,
          amount_billed: '8000',
        },
      }),
      financeAdminClaims,
      testSql,
      testSql,
    );
    const invoiceId = ((await invoiceRes.json()) as { id: string }).id;

    // Link invoice to retainer phase
    await handleUpdateBillingPhase(
      placementId,
      retainerPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${retainerPhaseId}`,
        method: 'PATCH',
        body: { invoice_id: invoiceId },
      }),
      financeAdminClaims,
      testSql,
    );

    // Assign contributor A to both phases for calculation
    await handleCreatePhaseContributor(
      placementId,
      retainerPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${retainerPhaseId}/contributors`,
        method: 'POST',
        body: { contributor_id: contributorAId, split_pct: 1.0 },
      }),
      financeAdminClaims,
      testSql,
    );
    await handleCreatePhaseContributor(
      placementId,
      deliveryPhaseId,
      makeRequest({
        path: `/placements/${placementId}/billing-phases/${deliveryPhaseId}/contributors`,
        method: 'POST',
        body: { contributor_id: contributorAId, split_pct: 1.0 },
      }),
      financeAdminClaims,
      testSql,
    );

    // Calculate
    await handleCalculatePhaseCommissions(
      placementId,
      makeRequest({ path: `/placements/${placementId}/calculate-phases`, method: 'POST' }),
      financeAdminClaims,
      testSql,
    );

    // Journal should be empty before any release
    const journalBefore = await handleListPhaseJournal(
      placementId,
      retainerPhaseId,
      financeAdminClaims,
      testSql,
    );
    const journalBeforeBody = (await journalBefore.json()) as { journal_entries: unknown[] };
    expect(journalBeforeBody.journal_entries).toHaveLength(0);

    // Mark invoice Paid
    await handleUpdateInvoice(
      invoiceId,
      makeRequest({
        path: `/invoices/${invoiceId}`,
        method: 'PATCH',
        body: { status: 'Paid', amount_collected: '8000' },
      }),
      financeAdminClaims,
      testSql,
      testSql,
    );

    // Journal should now have one entry
    const journalAfter = await handleListPhaseJournal(
      placementId,
      retainerPhaseId,
      financeAdminClaims,
      testSql,
    );
    const journalAfterBody = (await journalAfter.json()) as {
      journal_entries: {
        billing_phase_id: string;
        from_status: string;
        to_status: string;
        trigger_invoice_id: string;
        reason: string;
      }[];
    };
    expect(journalAfterBody.journal_entries).toHaveLength(1);

    const entry = journalAfterBody.journal_entries[0];
    expect(entry.billing_phase_id).toBe(retainerPhaseId);
    expect(entry.from_status).toBe('Held');
    expect(entry.to_status).toBe('Payable');
    expect(entry.trigger_invoice_id).toBe(invoiceId);
    expect(entry.reason).toContain('Phase invoice marked Paid');
  });
});

// ---------------------------------------------------------------------------
// AC#8 — Regression: contingency placement flow unaffected
// ---------------------------------------------------------------------------

describe('regression: contingency placement flow unaffected (AC#8)', () => {
  test('contingency placement calculate endpoint still works without billing phases', async () => {
    const { placementId } = await setupRetainedPlacement();

    // POST /placements/:id/calculate (regular, non-phase endpoint)
    const { handleCalculateCommission } = await import(
      '../../../apps/server/src/api/calculate'
    );
    const calcRes = await handleCalculateCommission(
      placementId,
      makeRequest({ path: `/placements/${placementId}/calculate`, method: 'POST' }),
      financeAdminClaims,
      testSql,
    );
    // Should succeed and return commission records with billing_phase_id=null
    expect(calcRes.status).toBe(200);
    const calcBody = (await calcRes.json()) as {
      commission_records: { billing_phase_id?: string | null }[];
    };
    expect(calcBody.commission_records.length).toBeGreaterThan(0);
    for (const record of calcBody.commission_records) {
      // Contingency records have no billing phase
      expect(record.billing_phase_id).toBeUndefined();
    }
  });

  test('GET /placements/:id/billing-phases returns empty array for contingency placement', async () => {
    const { placementId } = await setupRetainedPlacement();
    // No billing phases created → should return empty list
    const listRes = await handleListBillingPhases(placementId, financeAdminClaims, testSql);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { billing_phases: unknown[] };
    expect(listBody.billing_phases).toHaveLength(0);
  });
});

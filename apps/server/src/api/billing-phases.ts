/**
 * Billing Phases API routes.
 *
 * Routes:
 *   POST  /placements/:id/billing-phases            — create a billing phase on a retained placement
 *   GET   /placements/:id/billing-phases            — list billing phases for a placement
 *   PATCH /placements/:id/billing-phases/:phaseId   — update a billing phase (link invoice, amounts)
 *   POST  /placements/:id/billing-phases/:phaseId/contributors  — assign a contributor to a phase
 *   GET   /placements/:id/billing-phases/:phaseId/contributors  — list phase contributors
 *   GET   /placements/:id/billing-phases/:phaseId/journal       — list journal entries for a phase
 *   POST  /placements/:id/calculate-phases          — calculate per-phase commissions
 *
 * Per-phase calculation flow:
 *   For each billing phase on the placement:
 *     1. Resolve phase contributors (phase_contributors table).
 *     2. Determine invoiceCollected from the phase's linked invoice (not the placement-level invoice).
 *     3. Run the five-stage pipeline for each phase contributor independently.
 *     4. Persist CommissionRecord rows with billing_phase_id set and hold_reason=
 *        'held_pending_phase_invoice' when the phase invoice is unpaid.
 *
 * Collection gating (phase-scoped):
 *   When a billing phase's invoice is marked Paid, the invoice PATCH handler calls
 *   releasePhaseCollectionGate to release only that phase's Held records.
 *   The other phase's records remain Held until its invoice is paid.
 *
 * Producer visibility:
 *   GET /me/payouts returns blocked_phase (phase_name) and blocking_invoice_id when
 *   the record's hold_reason is 'held_pending_phase_invoice'.
 *
 * Canonical docs:
 *   - docs/prd.md §5.1, §5.5 — Retained Search Billing Phases
 *   - docs/architecture.md §4 — property-graph registry, relational journal
 *
 * Issue: feat: retained search billing phases (#63)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql } from 'db/index';
import { getPlacement } from 'db/placements';
import { listContributors } from 'db/contributors';
import {
  createBillingPhase,
  listBillingPhases,
  getBillingPhase,
  updateBillingPhase,
  createPhaseContributor,
  listPhaseContributors,
  listCommissionJournalEntries,
  BILLING_PHASE_NAMES,
  type BillingPhaseName,
} from 'db/billing-phases';
import { createCommissionRecord, type CreateCommissionRecordInput } from 'db/index';
import type { SessionClaims } from 'core/auth';
import {
  CommissionCalculationEngine,
  runCalculationPipeline,
  type CalculationInput,
  type PlanRulesSnapshot,
} from 'core/calculation-engine';

type SqlClient = Sql;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number, fields?: Record<string, string>): Response {
  return jsonResponse({ error: message, ...(fields ? { fields } : {}) }, status);
}

function formatPhase(phase: {
  id: string;
  orgId: string;
  placementId: string;
  phaseName: string;
  invoiceId: string | null;
  projectedAmount: string;
  billedAmount: string | null;
  receivedAmount: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: phase.id,
    org_id: phase.orgId,
    placement_id: phase.placementId,
    phase_name: phase.phaseName,
    invoice_id: phase.invoiceId,
    projected_amount: phase.projectedAmount,
    billed_amount: phase.billedAmount,
    received_amount: phase.receivedAmount,
    created_at: phase.createdAt,
    updated_at: phase.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// POST /placements/:id/billing-phases
// ---------------------------------------------------------------------------

/**
 * Creates a billing phase on a retained placement.
 *
 * Body: { phase_name: 'retainer' | 'delivery', projected_amount: string, invoice_id?: string }
 *
 * Returns 201 with the created phase.
 * Returns 404 if placement not found.
 * Returns 422 if phase_name is invalid or projected_amount is missing.
 * Returns 409 if a phase with the same name already exists on the placement.
 *
 * @param placementId - Placement UUID from the route.
 * @param req         - HTTP request with JSON body.
 * @param claims      - Session claims.
 * @param sqlClient   - Optional injectable SQL client for testing.
 */
export async function handleCreateBillingPhase(
  placementId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Request body must be valid JSON', 400);
  }

  const { phase_name, projected_amount, invoice_id } = body;

  if (!phase_name || !BILLING_PHASE_NAMES.includes(phase_name as BillingPhaseName)) {
    return errorResponse(`phase_name must be one of: ${BILLING_PHASE_NAMES.join(', ')}`, 422, {
      phase_name: 'invalid',
    });
  }

  if (!projected_amount || isNaN(Number(projected_amount))) {
    return errorResponse('projected_amount is required and must be numeric', 422, {
      projected_amount: 'required',
    });
  }

  // Verify placement exists and belongs to this org
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[billing-phases] get placement error:', err);
    return errorResponse('Failed to retrieve placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  try {
    const phase = await createBillingPhase(db, {
      orgId: claims.org_id,
      placementId,
      phaseName: phase_name as BillingPhaseName,
      invoiceId: typeof invoice_id === 'string' ? invoice_id : null,
      projectedAmount: String(projected_amount),
    });
    return jsonResponse({ billing_phase: formatPhase(phase) }, 201);
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return errorResponse(
        `A billing phase with name '${phase_name}' already exists on this placement`,
        409,
      );
    }
    console.error('[billing-phases] create error:', err);
    return errorResponse('Failed to create billing phase', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /placements/:id/billing-phases
// ---------------------------------------------------------------------------

/**
 * Lists all billing phases for a placement.
 *
 * Returns 200 with { billing_phases: [...] } (at most two rows: retainer, delivery).
 */
export async function handleListBillingPhases(
  placementId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[billing-phases] get placement error:', err);
    return errorResponse('Failed to retrieve placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  try {
    const phases = await listBillingPhases(db, claims.org_id, placementId);
    return jsonResponse({ billing_phases: phases.map(formatPhase) });
  } catch (err) {
    console.error('[billing-phases] list error:', err);
    return errorResponse('Failed to list billing phases', 500);
  }
}

// ---------------------------------------------------------------------------
// PATCH /placements/:id/billing-phases/:phaseId
// ---------------------------------------------------------------------------

/**
 * Updates a billing phase — links an invoice, updates projected/billed/received amounts.
 *
 * Body: { invoice_id?: string | null, projected_amount?: string,
 *          billed_amount?: string | null, received_amount?: string | null }
 */
export async function handleUpdateBillingPhase(
  placementId: string,
  phaseId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Request body must be valid JSON', 400);
  }

  // Verify placement
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[billing-phases] get placement error:', err);
    return errorResponse('Failed to retrieve placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  // Verify phase belongs to this placement
  let phase;
  try {
    phase = await getBillingPhase(db, claims.org_id, phaseId);
  } catch (err) {
    console.error('[billing-phases] get phase error:', err);
    return errorResponse('Failed to retrieve billing phase', 500);
  }

  if (!phase || phase.placementId !== placementId) {
    return errorResponse('Billing phase not found', 404);
  }

  const updateInput: {
    invoiceId?: string | null;
    projectedAmount?: string;
    billedAmount?: string | null;
    receivedAmount?: string | null;
  } = {};

  if ('invoice_id' in body) {
    updateInput.invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : null;
  }
  if (body.projected_amount !== undefined) {
    updateInput.projectedAmount = String(body.projected_amount);
  }
  if ('billed_amount' in body) {
    updateInput.billedAmount = body.billed_amount != null ? String(body.billed_amount) : null;
  }
  if ('received_amount' in body) {
    updateInput.receivedAmount = body.received_amount != null ? String(body.received_amount) : null;
  }

  try {
    const updated = await updateBillingPhase(db, claims.org_id, phaseId, updateInput);
    if (!updated) {
      return errorResponse('Billing phase not found', 404);
    }
    return jsonResponse({ billing_phase: formatPhase(updated) });
  } catch (err) {
    console.error('[billing-phases] update error:', err);
    return errorResponse('Failed to update billing phase', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /placements/:id/billing-phases/:phaseId/contributors
// ---------------------------------------------------------------------------

/**
 * Assigns a contributor to a billing phase with a split_pct.
 *
 * A contributor assigned to the delivery phase only will not accrue any
 * retainer-phase commission, and vice versa.
 *
 * Body: { contributor_id: string, split_pct: number }
 */
export async function handleCreatePhaseContributor(
  placementId: string,
  phaseId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Request body must be valid JSON', 400);
  }

  const { contributor_id, split_pct } = body;

  if (!contributor_id || typeof contributor_id !== 'string') {
    return errorResponse('contributor_id is required', 422, { contributor_id: 'required' });
  }

  const splitPctNum = Number(split_pct);
  if (isNaN(splitPctNum) || splitPctNum <= 0 || splitPctNum > 1) {
    return errorResponse('split_pct must be a decimal fraction in range (0, 1]', 422, {
      split_pct: 'invalid',
    });
  }

  // Verify placement
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[billing-phases] get placement error:', err);
    return errorResponse('Failed to retrieve placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  // Verify phase
  let phase;
  try {
    phase = await getBillingPhase(db, claims.org_id, phaseId);
  } catch (err) {
    console.error('[billing-phases] get phase error:', err);
    return errorResponse('Failed to retrieve billing phase', 500);
  }

  if (!phase || phase.placementId !== placementId) {
    return errorResponse('Billing phase not found', 404);
  }

  // Verify contributor belongs to this placement
  let contributors;
  try {
    contributors = await listContributors(db, placementId);
  } catch (err) {
    console.error('[billing-phases] list contributors error:', err);
    return errorResponse('Failed to list contributors', 500);
  }

  const contributor = contributors.find((c) => c.id === contributor_id);
  if (!contributor) {
    return errorResponse(
      'Contributor not found on this placement — assign the contributor to the placement first',
      422,
      { contributor_id: 'not_on_placement' },
    );
  }

  try {
    const phaseContributor = await createPhaseContributor(db, {
      orgId: claims.org_id,
      billingPhaseId: phaseId,
      contributorId: contributor_id,
      splitPct: splitPctNum,
    });
    return jsonResponse(
      {
        phase_contributor: {
          id: phaseContributor.id,
          org_id: phaseContributor.orgId,
          billing_phase_id: phaseContributor.billingPhaseId,
          contributor_id: phaseContributor.contributorId,
          split_pct: phaseContributor.splitPct,
          created_at: phaseContributor.createdAt,
        },
      },
      201,
    );
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return errorResponse('This contributor is already assigned to this billing phase', 409);
    }
    console.error('[billing-phases] create phase contributor error:', err);
    return errorResponse('Failed to create phase contributor', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /placements/:id/billing-phases/:phaseId/contributors
// ---------------------------------------------------------------------------

export async function handleListPhaseContributors(
  placementId: string,
  phaseId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // Verify placement
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[billing-phases] get placement error:', err);
    return errorResponse('Failed to retrieve placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  // Verify phase
  let phase;
  try {
    phase = await getBillingPhase(db, claims.org_id, phaseId);
  } catch (err) {
    console.error('[billing-phases] get phase error:', err);
    return errorResponse('Failed to retrieve billing phase', 500);
  }

  if (!phase || phase.placementId !== placementId) {
    return errorResponse('Billing phase not found', 404);
  }

  try {
    const pcs = await listPhaseContributors(db, claims.org_id, phaseId);
    return jsonResponse({
      phase_contributors: pcs.map((pc) => ({
        id: pc.id,
        org_id: pc.orgId,
        billing_phase_id: pc.billingPhaseId,
        contributor_id: pc.contributorId,
        split_pct: pc.splitPct,
        created_at: pc.createdAt,
      })),
    });
  } catch (err) {
    console.error('[billing-phases] list phase contributors error:', err);
    return errorResponse('Failed to list phase contributors', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /placements/:id/billing-phases/:phaseId/journal
// ---------------------------------------------------------------------------

/**
 * Lists commission journal entries for a billing phase.
 * Returns Held→Released transition records for audit and reconciliation.
 */
export async function handleListPhaseJournal(
  placementId: string,
  phaseId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // Verify placement
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[billing-phases] get placement error:', err);
    return errorResponse('Failed to retrieve placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  // Verify phase
  let phase;
  try {
    phase = await getBillingPhase(db, claims.org_id, phaseId);
  } catch (err) {
    console.error('[billing-phases] get phase error:', err);
    return errorResponse('Failed to retrieve billing phase', 500);
  }

  if (!phase || phase.placementId !== placementId) {
    return errorResponse('Billing phase not found', 404);
  }

  try {
    const entries = await listCommissionJournalEntries(db, claims.org_id, {
      billingPhaseId: phaseId,
    });
    return jsonResponse({
      journal_entries: entries.map((e) => ({
        id: e.id,
        org_id: e.orgId,
        commission_record_id: e.commissionRecordId,
        billing_phase_id: e.billingPhaseId,
        from_status: e.fromStatus,
        to_status: e.toStatus,
        trigger_invoice_id: e.triggerInvoiceId,
        actor_id: e.actorId,
        reason: e.reason,
        created_at: e.createdAt,
      })),
    });
  } catch (err) {
    console.error('[billing-phases] list journal error:', err);
    return errorResponse('Failed to list journal entries', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /placements/:id/calculate-phases — per-phase commission calculation
// ---------------------------------------------------------------------------

/**
 * Calculates commissions per billing phase for a retained placement.
 *
 * For each billing phase:
 *   1. Resolves phase contributors from phase_contributors table.
 *   2. Determines collection gate from the phase's own invoice status (not the
 *      placement-level invoice). A phase with no linked invoice is treated as
 *      not yet collected (conservative gate).
 *   3. Runs the five-stage pipeline for each phase contributor independently.
 *   4. Persists CommissionRecord rows with billing_phase_id set.
 *
 * This produces two independent sets of commission records — one per phase.
 * A contributor credited on delivery phase only produces zero retainer-phase
 * commission because they have no retainer phase_contributors row.
 *
 * Returns 200 with { commission_records: [...] } grouping results by phase.
 * Returns 404 if placement not found.
 * Returns 409 if placement is not Active.
 * Returns 422 if the placement has no billing phases.
 *
 * @param placementId - Placement UUID from the route.
 * @param _req        - HTTP request (no body required).
 * @param claims      - Session claims.
 * @param sqlClient   - Optional injectable SQL client for testing.
 */
export async function handleCalculatePhaseCommissions(
  placementId: string,
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // 1. Fetch placement
  let placement;
  try {
    placement = await getPlacement(db, placementId);
  } catch (err) {
    console.error('[billing-phases] get placement error:', err);
    return errorResponse('Failed to retrieve placement', 500);
  }

  if (!placement || placement.orgId !== claims.org_id) {
    return errorResponse('Placement not found', 404);
  }

  if (placement.status !== 'Active') {
    return errorResponse(
      `Placement is not Active (status: ${placement.status}). Only Active placements can be calculated.`,
      409,
    );
  }

  // 2. Fetch billing phases
  let phases;
  try {
    phases = await listBillingPhases(db, claims.org_id, placementId);
  } catch (err) {
    console.error('[billing-phases] list phases error:', err);
    return errorResponse('Failed to retrieve billing phases', 500);
  }

  if (phases.length === 0) {
    return errorResponse(
      'Placement has no billing phases — create retainer and delivery phases before calculating',
      422,
    );
  }

  const engine = new CommissionCalculationEngine();
  const allCreatedRecords: unknown[] = [];

  for (const phase of phases) {
    // 3. Resolve phase contributors
    let phaseContributors;
    try {
      phaseContributors = await listPhaseContributors(db, claims.org_id, phase.id);
    } catch (err) {
      console.error('[billing-phases] list phase contributors error:', err);
      return errorResponse('Failed to retrieve phase contributors', 500);
    }

    if (phaseContributors.length === 0) {
      // A phase with no contributors produces no commission records
      continue;
    }

    // 4. Determine collection gate from this phase's invoice
    const phaseInvoiceCollected = await resolvePhaseInvoiceCollected(db, phase.invoiceId);

    // 5. Resolve guarantee window (same as regular placement calc)
    const guaranteeResult = await resolveInsideGuaranteeWindow(db, claims.org_id, placementId);
    const { insideWindow: insideGuaranteeWindow, guaranteeExpiry } = guaranteeResult;

    // 6. For each phase contributor: resolve plan, run pipeline, persist record
    for (const phaseContributor of phaseContributors) {
      // Resolve the contributor's producer_id via the contributors table
      const producerId = await resolveContributorProducerId(db, phaseContributor.contributorId);
      if (!producerId) {
        return errorResponse(
          `Contributor ${phaseContributor.contributorId} not found on placement`,
          422,
        );
      }

      const planResult = await resolveActivePlanVersion(db, claims.org_id, producerId);
      if (!planResult) {
        return errorResponse(
          `No active plan version found for contributor ${phaseContributor.contributorId}`,
          422,
        );
      }

      const { planVersionId, rules } = planResult;

      const rateType = rules.rate_type ?? 'gross_fee';
      const commissionableBase =
        rateType === 'net_fee_income'
          ? Number(placement.compensationBase)
          : Number(placement.feeAmount);

      const ytdGross = await resolveYtdGross(db, claims.org_id, phaseContributor.contributorId);
      const drawBalance = await resolveDrawBalance(db, claims.org_id, producerId);

      const input: CalculationInput = {
        orgId: claims.org_id,
        contributorId: phaseContributor.contributorId,
        placementId,
        commissionableBase,
        splitPct: phaseContributor.splitPct,
        planRules: rules,
        ytdGross,
        invoiceCollected: phaseInvoiceCollected,
        insideGuaranteeWindow,
        drawBalance,
      };

      let record;
      try {
        record = await runCalculationPipeline(engine, input, planVersionId, guaranteeExpiry);
      } catch (err) {
        console.error('[billing-phases] pipeline error:', err);
        return errorResponse(
          `Calculation pipeline failed for phase ${phase.phaseName}, contributor ${phaseContributor.contributorId}: ${(err as Error).message}`,
          422,
        );
      }

      // Determine hold_reason for Held records
      let holdReason: string | null = null;
      if (record.status === 'Held') {
        if (record.heldForCollection) {
          holdReason = 'held_pending_phase_invoice';
        } else if (record.heldForGuarantee) {
          holdReason = 'guarantee_hold';
        }
      }

      const createInput: CreateCommissionRecordInput = {
        orgId: claims.org_id,
        placementId,
        contributorId: phaseContributor.contributorId,
        planVersionId,
        grossAmount: record.grossCommission.toFixed(4),
        netPayable: record.netPayable.toFixed(4),
        tierRate: record.tierRate,
        status: record.status === 'Held' ? 'Held' : 'Accrued',
        explanation: record.explanation,
        holdReason,
        billingPhaseId: phase.id,
      };

      let dbRecord;
      try {
        dbRecord = await createCommissionRecord(db, createInput);
      } catch (err) {
        console.error('[billing-phases] persist record error:', err);
        return errorResponse('Failed to persist commission record', 500);
      }

      allCreatedRecords.push({
        id: dbRecord.id,
        org_id: dbRecord.orgId,
        placement_id: dbRecord.placementId,
        billing_phase_id: phase.id,
        phase_name: phase.phaseName,
        contributor_id: dbRecord.contributorId,
        plan_version_id: dbRecord.planVersionId,
        gross_commission: dbRecord.grossAmount,
        net_payable: dbRecord.netPayable,
        tier_rate: dbRecord.tierRate,
        status: dbRecord.status,
        held_for_collection: record.heldForCollection,
        held_for_guarantee: record.heldForGuarantee,
        hold_reason: holdReason,
        draw_deducted: record.drawDeducted,
        explanation: record.explanation,
        created_at: dbRecord.createdAt,
      });
    }
  }

  return jsonResponse({ commission_records: allCreatedRecords });
}

// ---------------------------------------------------------------------------
// Internal resolution helpers (mirroring calculate.ts patterns)
// ---------------------------------------------------------------------------

/**
 * Determines whether a phase's invoice is collected (status = 'Paid').
 * Returns false when no invoice is linked (conservative collection gate).
 */
async function resolvePhaseInvoiceCollected(
  sql: SqlClient,
  invoiceId: string | null,
): Promise<boolean> {
  if (!invoiceId) return false;

  const rows = await sql.unsafe(`SELECT status FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);

  if (!rows || rows.length === 0) return false;
  return (rows[0] as unknown as { status: string }).status === 'Paid';
}

/**
 * Resolves the producer_id for a given contributor_id.
 */
async function resolveContributorProducerId(
  sql: SqlClient,
  contributorId: string,
): Promise<string | null> {
  const rows = await sql.unsafe(`SELECT producer_id FROM contributors WHERE id = $1 LIMIT 1`, [
    contributorId,
  ]);

  if (!rows || rows.length === 0) return null;
  return (rows[0] as unknown as { producer_id: string }).producer_id;
}

/**
 * Resolves the active plan version for a producer.
 */
async function resolveActivePlanVersion(
  sql: SqlClient,
  orgId: string,
  producerId: string,
): Promise<{ planVersionId: string; rules: PlanRulesSnapshot } | null> {
  const assignedRows = await sql.unsafe(
    `
    SELECT pv.id AS plan_version_id, pv.rules_snapshot
    FROM plan_assignments pa
    JOIN plan_versions pv ON pv.id = pa.plan_version_id
    WHERE pa.org_id = $1
      AND pa.producer_id = $2
      AND pv.status = 'Active'
      AND (pa.expires_at IS NULL OR pa.expires_at > NOW())
    ORDER BY pa.assigned_at DESC
    LIMIT 1
    `,
    [orgId, producerId],
  );

  if (assignedRows && assignedRows.length > 0) {
    const row = assignedRows[0] as unknown as {
      plan_version_id: string;
      rules_snapshot: PlanRulesSnapshot;
    };
    return { planVersionId: row.plan_version_id, rules: row.rules_snapshot };
  }

  // Fallback: most recent Active plan for the org
  const fallbackRows = await sql.unsafe(
    `
    SELECT pv.id AS plan_version_id, pv.rules_snapshot
    FROM plan_versions pv
    WHERE pv.org_id = $1 AND pv.status = 'Active'
    ORDER BY pv.effective_at DESC
    LIMIT 1
    `,
    [orgId],
  );

  if (fallbackRows && fallbackRows.length > 0) {
    const row = fallbackRows[0] as unknown as {
      plan_version_id: string;
      rules_snapshot: PlanRulesSnapshot;
    };
    return { planVersionId: row.plan_version_id, rules: row.rules_snapshot };
  }

  return null;
}

/**
 * Resolves the contributor's YTD gross commission.
 */
async function resolveYtdGross(
  sql: SqlClient,
  orgId: string,
  contributorId: string,
): Promise<number> {
  // YTD gross is the sum of prior commission_records gross amounts for this contributor.
  // gross_amount is BYTEA-encrypted; decrypting all rows for sum is expensive at scale.
  // For the billing-phases phase, we return 0 (conservative — no tier advancement applied),
  // matching the behaviour of the stub in calculate.ts resolveYtdGross.
  // The full implementation will decrypt and SUM in a future iteration.
  // This is the same pattern used in the core calculate.ts handler.
  const rows = await sql.unsafe(
    `SELECT COUNT(*) AS cnt FROM commission_records
     WHERE org_id = $1 AND contributor_id = $2
       AND status NOT IN ('ClawbackInitiated', 'Recovered')
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())`,
    [orgId, contributorId],
  );
  void rows; // count used only for tracing; not decrypted
  return 0;
}

/**
 * Resolves the draw balance for a producer.
 */
async function resolveDrawBalance(
  sql: SqlClient,
  orgId: string,
  producerId: string,
): Promise<number> {
  const rows = await sql.unsafe(
    `
    SELECT balance FROM draw_balances
    WHERE org_id = $1 AND producer_id = $2 AND status = 'Active'
    LIMIT 1
    `,
    [orgId, producerId],
  );

  if (!rows || rows.length === 0) return 0;
  // draw_balances.balance is BYTEA encrypted — simplified: treat as 0 (draw not configured)
  return 0;
}

/**
 * Checks whether the placement is inside an active guarantee window.
 */
async function resolveInsideGuaranteeWindow(
  sql: SqlClient,
  orgId: string,
  placementId: string,
): Promise<{ insideWindow: boolean; guaranteeExpiry: string | undefined }> {
  const rows = await sql.unsafe(
    `
    SELECT guarantee_ends FROM guarantee_periods
    WHERE org_id = $1
      AND placement_id = $2
      AND status = 'Active'
      AND guarantee_ends >= CURRENT_DATE
    LIMIT 1
    `,
    [orgId, placementId],
  );

  if (!rows || rows.length === 0) {
    return { insideWindow: false, guaranteeExpiry: undefined };
  }

  const row = rows[0] as unknown as { guarantee_ends: Date | string };
  const expiryDate = row.guarantee_ends;
  const expiryStr =
    expiryDate instanceof Date
      ? expiryDate.toISOString().slice(0, 10)
      : String(expiryDate).slice(0, 10);

  return { insideWindow: true, guaranteeExpiry: expiryStr };
}

/**
 * Commission Run API routes — Finance Admin commission close workflow.
 *
 * Routes:
 *   POST   /commission-runs                            — open a new commission run for a period
 *   GET    /commission-runs/:id/queue                  — review queue: ready, held, exception-pending records
 *   POST   /commission-runs/:id/records/:rid/approve   — individually approve a commission record
 *   POST   /commission-runs/:id/approve                — approve entire run (requires all records approved)
 *   POST   /commission-runs/:id/finalize               — finalize run (gate: zero unacknowledged reconciliation discrepancies)
 *
 * Business rules:
 *   - POST /commission-runs pre-flight: rejects with 422 if any placement in scope is incomplete.
 *   - POST /commission-runs/:id/approve: rejects with 422 if any record is not individually approved.
 *   - An approved run is immutable — PATCH on included CommissionRecords returns 409 Conflict.
 *   - POST /commission-runs/:id/finalize: rejects with 422 if unacknowledged reconciliation
 *     discrepancies exist unless an override_reason is supplied.
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 *
 * Injectable sql (for testing): all handler functions accept an optional SqlClient.
 *
 * Canonical docs: docs/prd.md §5.4, §5.8, §9
 * Issue: feat: finance admin commission run and review queue (#13)
 * Issue: feat: financial reconciliation report (#65)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import { checkPlacementsComplete } from 'db/placements';
import { listCommissionRecords } from 'db/commission-records';
import {
  createCommissionRun,
  getCommissionRun,
  getCommissionRunRecords,
  approveRunRecord,
  approveCommissionRun,
} from 'db/commission-runs';
import { countUnacknowledgedDiscrepancies } from 'db/reconciliation';
import type { SessionClaims } from 'core/auth';

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

// ---------------------------------------------------------------------------
// POST /commission-runs — open a run with pre-flight check
// ---------------------------------------------------------------------------

export interface CreateCommissionRunBody {
  period_start: string;
  period_end: string;
  /** Placement IDs whose commission records should be included in this run */
  placement_ids: string[];
}

/**
 * POST /commission-runs — opens a new commission run for the given period and placement IDs.
 *
 * Pre-flight: if any placement in placement_ids is incomplete, rejects with 422 and
 * returns the list of blocking placement IDs with their missing fields.
 *
 * On success, creates the run in Open status and links all existing commission records
 * for the given placements. Returns 201 with the created run.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleCreateCommissionRun(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<CreateCommissionRunBody>;
  try {
    body = (await req.json()) as Partial<CreateCommissionRunBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const errors: Record<string, string> = {};
  if (!body.period_start) errors['period_start'] = 'period_start is required (YYYY-MM-DD)';
  if (!body.period_end) errors['period_end'] = 'period_end is required (YYYY-MM-DD)';
  if (
    !body.placement_ids ||
    !Array.isArray(body.placement_ids) ||
    body.placement_ids.length === 0
  ) {
    errors['placement_ids'] = 'placement_ids must be a non-empty array';
  }
  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  const db = sqlClient ?? defaultSql;

  // Pre-flight: check all placements are complete
  let incompleteMap: Map<string, string[]>;
  try {
    incompleteMap = await checkPlacementsComplete(db, claims.org_id, body.placement_ids!);
  } catch (err: unknown) {
    console.error('[commission-runs] pre-flight error:', err);
    return errorResponse('Failed to validate placements', 500);
  }

  if (incompleteMap.size > 0) {
    const incompleteList = Array.from(incompleteMap.entries()).map(([id, missingFields]) => ({
      placement_id: id,
      missing_fields: missingFields,
    }));
    return jsonResponse(
      {
        error: 'Commission run blocked: incomplete placements',
        incomplete_placements: incompleteList,
      },
      422,
    );
  }

  // Collect all commission record IDs for the given placements
  const allRecordIds: string[] = [];
  try {
    for (const placementId of body.placement_ids!) {
      const records = await listCommissionRecords(db, claims.org_id, placementId);
      for (const r of records) {
        allRecordIds.push(r.id);
      }
    }
  } catch (err: unknown) {
    console.error('[commission-runs] collect records error:', err);
    return errorResponse('Failed to collect commission records', 500);
  }

  // Create the run
  try {
    const run = await createCommissionRun(db, {
      orgId: claims.org_id,
      periodStart: body.period_start!,
      periodEnd: body.period_end!,
      createdBy: claims.user_id,
      commissionRecordIds: allRecordIds,
    });

    return jsonResponse(
      {
        id: run.id,
        org_id: run.orgId,
        period_start: run.periodStart,
        period_end: run.periodEnd,
        status: run.status,
        created_by: run.createdBy,
        created_at: run.createdAt,
      },
      201,
    );
  } catch (err: unknown) {
    console.error('[commission-runs] create error:', err);
    return errorResponse('Failed to create commission run', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /commission-runs/:id/queue — review queue
// ---------------------------------------------------------------------------

/**
 * GET /commission-runs/:id/queue — returns the review queue for the run.
 *
 * The queue lists all commission records included in the run, each annotated with:
 *   - status (from commission_records.status)
 *   - individually_approved (from commission_run_records)
 *   - queue_category: 'ready' | 'held' | 'exception_pending' | 'approved'
 *
 * Returns 404 if the run is not found.
 *
 * @param runId     - Commission run UUID from the route.
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleGetCommissionRunQueue(
  runId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  let run;
  try {
    run = await getCommissionRun(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[commission-runs] get run error:', err);
    return errorResponse('Failed to retrieve commission run', 500);
  }

  if (!run) {
    return errorResponse('Commission run not found', 404);
  }

  // Get all junction records
  let runRecords;
  try {
    runRecords = await getCommissionRunRecords(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[commission-runs] get run records error:', err);
    return errorResponse('Failed to retrieve run records', 500);
  }

  // Build the queue by fetching each commission record's status
  // Fetch all commission records for the placements referenced in this run
  // We need the commission record details. Since we only have run_records, we query directly.
  interface QueueItem {
    commission_record_id: string;
    run_record_id: string;
    status: string;
    hold_reason: string | null;
    individually_approved: boolean;
    individually_approved_by: string | null;
    individually_approved_at: Date | null;
    queue_category: string;
  }
  const queueItems: QueueItem[] = [];
  for (const rr of runRecords) {
    let crStatus = 'Accrued';
    let crHoldReason: string | null = null;
    try {
      const rows = await db.unsafe(
        `SELECT status, hold_reason FROM commission_records WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [rr.commissionRecordId, claims.org_id],
      );
      if (rows && rows.length > 0) {
        const row = rows[0] as unknown as { status: string; hold_reason: string | null };
        crStatus = row.status;
        crHoldReason = row.hold_reason;
      }
    } catch {
      // non-fatal — use default
    }

    // Determine queue_category
    let queueCategory: string;
    if (rr.individuallyApproved) {
      queueCategory = 'approved';
    } else if (crStatus === 'Held') {
      queueCategory = 'held';
    } else if (crHoldReason !== null) {
      queueCategory = 'exception_pending';
    } else {
      queueCategory = 'ready';
    }

    queueItems.push({
      commission_record_id: rr.commissionRecordId,
      run_record_id: rr.id,
      status: crStatus,
      hold_reason: crHoldReason,
      individually_approved: rr.individuallyApproved,
      individually_approved_by: rr.individuallyApprovedBy,
      individually_approved_at: rr.individuallyApprovedAt,
      queue_category: queueCategory,
    });
  }

  return jsonResponse({
    run: {
      id: run.id,
      org_id: run.orgId,
      period_start: run.periodStart,
      period_end: run.periodEnd,
      status: run.status,
      created_by: run.createdBy,
      approved_by: run.approvedBy,
      approved_at: run.approvedAt,
      created_at: run.createdAt,
    },
    queue: queueItems,
    totals: {
      total: queueItems.length,
      ready: queueItems.filter((i) => i.queue_category === 'ready').length,
      held: queueItems.filter((i) => i.queue_category === 'held').length,
      exception_pending: queueItems.filter((i) => i.queue_category === 'exception_pending').length,
      approved: queueItems.filter((i) => i.queue_category === 'approved').length,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /commission-runs/:id/records/:rid/approve — individually approve a record
// ---------------------------------------------------------------------------

/**
 * POST /commission-runs/:id/records/:rid/approve — Finance Admin individually approves
 * a commission record within a run.
 *
 * Returns 200 with the updated run record.
 * Returns 404 if the run or run record is not found.
 * Returns 409 if the run is already Approved (immutable).
 *
 * @param runId     - Commission run UUID.
 * @param recordId  - Commission record UUID (the commission_records.id, not run_records.id).
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleApproveRunRecord(
  runId: string,
  recordId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // Verify run exists and is Open
  let run;
  try {
    run = await getCommissionRun(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[commission-runs] get run error:', err);
    return errorResponse('Failed to retrieve commission run', 500);
  }

  if (!run) {
    return errorResponse('Commission run not found', 404);
  }

  if (run.status === 'Approved') {
    return errorResponse('Commission run is already approved and immutable', 409);
  }

  try {
    const updated = await approveRunRecord(db, claims.org_id, runId, recordId, claims.user_id);

    if (!updated) {
      return errorResponse('Commission record not found in this run', 404);
    }

    return jsonResponse({
      run_id: updated.runId,
      commission_record_id: updated.commissionRecordId,
      individually_approved: updated.individuallyApproved,
      individually_approved_by: updated.individuallyApprovedBy,
      individually_approved_at: updated.individuallyApprovedAt,
    });
  } catch (err: unknown) {
    console.error('[commission-runs] approve record error:', err);
    return errorResponse('Failed to approve commission record', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /commission-runs/:id/approve — approve entire run
// ---------------------------------------------------------------------------

/**
 * POST /commission-runs/:id/approve — Finance Admin approves the entire commission run.
 *
 * Requires all included commission records to be individually approved first.
 * Returns 422 if any record is not yet individually approved.
 * Returns 404 if the run is not found.
 * Returns 409 if the run is already Approved.
 *
 * On success, transitions the run to Approved and all included commission_records
 * to status=Approved. The run is then immutable.
 *
 * @param runId     - Commission run UUID.
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleApproveCommissionRun(
  runId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // Verify run exists
  let run;
  try {
    run = await getCommissionRun(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[commission-runs] get run error:', err);
    return errorResponse('Failed to retrieve commission run', 500);
  }

  if (!run) {
    return errorResponse('Commission run not found', 404);
  }

  if (run.status === 'Approved') {
    return errorResponse('Commission run is already approved', 409);
  }

  // Check all records are individually approved
  let runRecords;
  try {
    runRecords = await getCommissionRunRecords(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[commission-runs] get records error:', err);
    return errorResponse('Failed to retrieve run records', 500);
  }

  const unapproved = runRecords.filter((r) => !r.individuallyApproved);
  if (unapproved.length > 0) {
    return jsonResponse(
      {
        error: 'Cannot approve run: some records are not yet individually approved',
        unapproved_record_ids: unapproved.map((r) => r.commissionRecordId),
      },
      422,
    );
  }

  try {
    const approved = await approveCommissionRun(db, claims.org_id, runId, claims.user_id);

    if (!approved) {
      return errorResponse('Failed to approve commission run', 500);
    }

    return jsonResponse({
      id: approved.id,
      org_id: approved.orgId,
      period_start: approved.periodStart,
      period_end: approved.periodEnd,
      status: approved.status,
      created_by: approved.createdBy,
      approved_by: approved.approvedBy,
      approved_at: approved.approvedAt,
      created_at: approved.createdAt,
    });
  } catch (err: unknown) {
    console.error('[commission-runs] approve run error:', err);
    return errorResponse('Failed to approve commission run', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /commission-runs/:id/finalize — finalization gate with reconciliation check
// ---------------------------------------------------------------------------

export interface FinalizeCommissionRunBody {
  /** If provided, bypasses the reconciliation gate with a documented reason. */
  override_reason?: string;
}

/**
 * POST /commission-runs/:id/finalize — Finance Admin finalizes a commission run.
 *
 * Pre-flight reconciliation gate:
 *   If any unacknowledged reconciliation discrepancies exist for the run's period,
 *   returns 422 with the unacknowledged count unless override_reason is supplied.
 *
 * On success, re-uses the approveCommissionRun logic to mark the run Approved
 * (finalize is the reconciliation-gated path to the same Approved terminal state).
 *
 * Writes an AuditLogEntry to commission_audit when a finalization override is used.
 *
 * @param runId          - Commission run UUID.
 * @param sqlClient      - Optional injectable SQL client (for testing).
 * @param auditSqlClient - Optional injectable audit SQL client (for testing).
 */
export async function handleFinalizeCommissionRun(
  runId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  let body: Partial<FinalizeCommissionRunBody> = {};
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      body = JSON.parse(text) as Partial<FinalizeCommissionRunBody>;
    }
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Verify run exists
  let run;
  try {
    run = await getCommissionRun(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[commission-runs] finalize get run error:', err);
    return errorResponse('Failed to retrieve commission run', 500);
  }

  if (!run) {
    return errorResponse('Commission run not found', 404);
  }

  if (run.status === 'Approved') {
    return errorResponse('Commission run is already finalized', 409);
  }

  // Reconciliation gate: check for unacknowledged discrepancies in the run period
  let unacknowledgedCount = 0;
  try {
    unacknowledgedCount = await countUnacknowledgedDiscrepancies(
      db,
      claims.org_id,
      run.periodStart,
      run.periodEnd,
    );
  } catch (err: unknown) {
    console.error('[commission-runs] finalize reconciliation check error:', err);
    return errorResponse('Failed to check reconciliation discrepancies', 500);
  }

  const hasOverride =
    typeof body.override_reason === 'string' && body.override_reason.trim().length > 0;

  if (unacknowledgedCount > 0 && !hasOverride) {
    return jsonResponse(
      {
        error:
          'Cannot finalize run: unacknowledged reconciliation discrepancies exist for the run period',
        unacknowledged_discrepancy_count: unacknowledgedCount,
        hint: 'Acknowledge all discrepancies via POST /reconciliation/:id/acknowledge, or supply override_reason to bypass.',
      },
      422,
    );
  }

  // Check all commission records are individually approved
  let runRecords;
  try {
    runRecords = await getCommissionRunRecords(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[commission-runs] finalize get records error:', err);
    return errorResponse('Failed to retrieve run records', 500);
  }

  const unapproved = runRecords.filter((r) => !r.individuallyApproved);
  if (unapproved.length > 0) {
    return jsonResponse(
      {
        error: 'Cannot finalize run: some records are not yet individually approved',
        unapproved_record_ids: unapproved.map((r) => r.commissionRecordId),
      },
      422,
    );
  }

  // Write override audit log if applicable
  if (hasOverride) {
    try {
      await adb.unsafe(
        `
        INSERT INTO audit_log_entries (
          org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
        ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
        `,
        [
          claims.org_id,
          claims.user_id,
          'User',
          'commission_run.finalization.override',
          'commission_run',
          runId,
          {
            run_id: runId,
            period_start: run.periodStart,
            period_end: run.periodEnd,
            override_reason: body.override_reason!.trim(),
            unacknowledged_discrepancy_count: unacknowledgedCount,
            finalized_by: claims.user_id,
          },
        ],
      );
    } catch (err: unknown) {
      console.error('[commission-runs] finalize override audit log error (non-fatal):', err);
    }
  }

  // Finalize (same terminal state as approve)
  try {
    const finalized = await approveCommissionRun(db, claims.org_id, runId, claims.user_id);

    if (!finalized) {
      return errorResponse('Failed to finalize commission run', 500);
    }

    return jsonResponse({
      id: finalized.id,
      org_id: finalized.orgId,
      period_start: finalized.periodStart,
      period_end: finalized.periodEnd,
      status: finalized.status,
      created_by: finalized.createdBy,
      approved_by: finalized.approvedBy,
      approved_at: finalized.approvedAt,
      created_at: finalized.createdAt,
      override_reason: hasOverride ? body.override_reason!.trim() : null,
    });
  } catch (err: unknown) {
    console.error('[commission-runs] finalize error:', err);
    return errorResponse('Failed to finalize commission run', 500);
  }
}

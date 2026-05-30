/**
 * Commission Run API routes — Finance Admin commission close workflow.
 *
 * Routes:
 *   POST   /commission-runs                            — open a new commission run for a period
 *   GET    /commission-runs/:id/queue                  — review queue: ready, held, exception-pending records
 *   POST   /commission-runs/:id/records/:rid/approve   — individually approve a commission record
 *   POST   /commission-runs/:id/approve                — approve entire run (requires all records approved)
 *
 * Business rules:
 *   - POST /commission-runs pre-flight: rejects with 422 if any placement in scope is incomplete.
 *   - POST /commission-runs/:id/approve: rejects with 422 if any record is not individually approved.
 *   - An approved run is immutable — PATCH on included CommissionRecords returns 409 Conflict.
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 *
 * Injectable sql (for testing): all handler functions accept an optional SqlClient.
 *
 * Canonical docs: docs/prd.md §5.4, §9
 * Issue: feat: finance admin commission run and review queue (#13)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql } from 'db/index';
import { checkPlacementsComplete } from 'db/placements';
import { listCommissionRecords } from 'db/commission-records';
import {
  createCommissionRun,
  getCommissionRun,
  getCommissionRunRecords,
  approveRunRecord,
  approveCommissionRun,
} from 'db/commission-runs';
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
  // Group runRecords by commission_record_id for O(n) lookup
  const runRecordMap = new Map(runRecords.map((r) => [r.commissionRecordId, r]));

  // Fetch all commission records for the placements referenced in this run
  // We need the commission record details. Since we only have run_records, we query directly.
  const queueItems = [];
  for (const rr of runRecords) {
    let crStatus = 'Accrued';
    let crHoldReason: string | null = null;
    try {
      const rows = await db.unsafe(
        `SELECT status, hold_reason FROM commission_records WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [rr.commissionRecordId, claims.org_id],
      );
      if (rows && rows.length > 0) {
        crStatus = (rows[0] as { status: string; hold_reason: string | null }).status;
        crHoldReason = (rows[0] as { status: string; hold_reason: string | null }).hold_reason;
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

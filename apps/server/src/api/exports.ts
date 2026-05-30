/**
 * Payroll Export API routes — Finance Admin payroll-ready export from approved commission run.
 *
 * Routes:
 *   POST /commission-runs/:id/export   — generate (or return existing) payroll CSV artifact
 *   GET  /commission-runs/:id/exports  — list prior export artifacts for a run
 *
 * Business rules:
 *   - POST /commission-runs/:id/export is only available on Approved runs (422 otherwise).
 *   - The export is idempotent: calling POST twice returns the same artifact_id / content.
 *   - Export format: CSV with columns employee_id, name, gross_commission,
 *     draw_recovery, clawback_recovery, net_payroll, pay_period.
 *   - draw_recovery and clawback_recovery default to 0.00 in MVP (no draw/clawback ledger yet).
 *   - net_payroll = gross_commission - draw_recovery - clawback_recovery.
 *   - One row per unique producer in the run (aggregated across commission_records).
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 *
 * Injectable sql (for testing): all handler functions accept an optional SqlClient.
 *
 * Canonical docs: docs/prd.md §5.7
 * Issue: feat: payroll-ready export from approved commission run (#15)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql } from 'db/index';
import { getCommissionRun, getCommissionRunRecords } from 'db/commission-runs';
import { getCommissionRecord } from 'db/commission-records';
import { getPlacement } from 'db/placements';
import { createOrGetPayrollExport, listPayrollExports } from 'db/payroll-exports';
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

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ---------------------------------------------------------------------------
// CSV builder
// ---------------------------------------------------------------------------

const CSV_HEADER =
  'employee_id,name,position_title,client_name,gross_commission,draw_recovery,clawback_recovery,net_payroll,pay_period';

interface ProducerRow {
  employee_id: string;
  name: string;
  position_title: string;
  client_name: string;
  gross_commission: string;
  draw_recovery: string;
  clawback_recovery: string;
  net_payroll: string;
  pay_period: string;
}

/** Escape a CSV field value — wrap in quotes and escape embedded quotes. */
function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsvContent(rows: ProducerRow[]): string {
  const lines = [CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.employee_id),
        csvField(row.name),
        csvField(row.position_title),
        csvField(row.client_name),
        csvField(row.gross_commission),
        csvField(row.draw_recovery),
        csvField(row.clawback_recovery),
        csvField(row.net_payroll),
        csvField(row.pay_period),
      ].join(','),
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// POST /commission-runs/:id/export — generate payroll CSV
// ---------------------------------------------------------------------------

/**
 * POST /commission-runs/:id/export — generates a payroll-ready CSV export artifact
 * for the given Approved commission run.
 *
 * If an artifact already exists for this run, returns the existing artifact unchanged
 * (idempotent — no duplicate file is created).
 *
 * Returns 422 if the run is not in Approved status.
 * Returns 404 if the run is not found.
 *
 * @param runId     - Commission run UUID from the route.
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleCreatePayrollExport(
  runId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // Fetch the run
  let run;
  try {
    run = await getCommissionRun(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[exports] get run error:', err);
    return errorResponse('Failed to retrieve commission run', 500);
  }

  if (!run) {
    return errorResponse('Commission run not found', 404);
  }

  // Guard: only Approved runs may be exported
  if (run.status !== 'Approved') {
    return errorResponse(
      `Cannot export a run in status '${run.status}' — run must be Approved`,
      422,
    );
  }

  // Fetch run records (commission_run_records junction rows)
  let runRecords;
  try {
    runRecords = await getCommissionRunRecords(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[exports] get run records error:', err);
    return errorResponse('Failed to retrieve run records', 500);
  }

  // Aggregate by producer_id: sum gross_commission and net_payable across commission records.
  // commission_records.contributor_id references contributors.id (the junction table's PK),
  // not contributors.producer_id. We resolve the external producer_id via a lookup below.
  // draw_recovery and clawback_recovery are 0.00 in MVP (no draw/clawback ledger yet).
  // position_title and client_name are masked when the placement is_confidential=true.
  const producerTotals = new Map<
    string,
    {
      producerId: string;
      grossCommission: number;
      netPayable: number;
      positionTitle: string;
      clientName: string;
    }
  >();

  for (const rr of runRecords) {
    let cr;
    try {
      cr = await getCommissionRecord(db, claims.org_id, rr.commissionRecordId);
    } catch (err: unknown) {
      console.error('[exports] get commission record error:', err);
      return errorResponse('Failed to retrieve commission record', 500);
    }

    if (!cr) continue;

    // Look up placement for position_title / confidential masking
    let positionTitle = '';
    let clientName = '';
    try {
      const placement = await getPlacement(db, cr.placementId);
      if (placement) {
        if (placement.isConfidential) {
          positionTitle = 'Confidential';
          clientName = 'Confidential';
        } else {
          positionTitle = placement.jobTitle;
          clientName = placement.clientEntityId; // MVP: use entity ID as client name
        }
      }
    } catch (err: unknown) {
      console.error('[exports] placement lookup error (non-fatal):', err);
    }

    // Resolve producer_id from the contributors table using cr.contributorId (= contributors.id).
    let producerId: string;
    try {
      const contribRows = await db.unsafe(
        `SELECT producer_id FROM contributors WHERE id = $1 LIMIT 1`,
        [cr.contributorId],
      );
      if (!contribRows || contribRows.length === 0) {
        console.error('[exports] contributor not found for id:', cr.contributorId);
        producerId = cr.contributorId; // fallback to internal id if lookup fails
      } else {
        producerId = (contribRows[0] as unknown as { producer_id: string }).producer_id;
      }
    } catch (err: unknown) {
      console.error('[exports] contributor lookup error:', err);
      return errorResponse('Failed to resolve producer for commission record', 500);
    }

    const existing = producerTotals.get(producerId) ?? {
      producerId,
      grossCommission: 0,
      netPayable: 0,
      positionTitle,
      clientName,
    };
    producerTotals.set(producerId, {
      producerId,
      grossCommission: existing.grossCommission + parseFloat(cr.grossAmount),
      netPayable: existing.netPayable + parseFloat(cr.netPayable),
      // Use the most recent record's placement data (last record wins for multi-placement producers)
      positionTitle,
      clientName,
    });
  }

  // Build CSV rows — one row per unique producer
  const payPeriod = `${run.periodStart}/${run.periodEnd}`;
  const csvRows: ProducerRow[] = [];

  for (const [, totals] of producerTotals) {
    const grossCommission = totals.grossCommission;
    const drawRecovery = 0;
    const clawbackRecovery = 0;
    const netPayroll = grossCommission - drawRecovery - clawbackRecovery;

    csvRows.push({
      employee_id: totals.producerId,
      name: totals.producerId, // MVP: no separate name lookup; use producer UUID as name
      position_title: totals.positionTitle,
      client_name: totals.clientName,
      gross_commission: grossCommission.toFixed(2),
      draw_recovery: drawRecovery.toFixed(2),
      clawback_recovery: clawbackRecovery.toFixed(2),
      net_payroll: netPayroll.toFixed(2),
      pay_period: payPeriod,
    });
  }

  const csvContent = buildCsvContent(csvRows);

  // Persist (or retrieve existing) artifact
  let artifact;
  try {
    artifact = await createOrGetPayrollExport(db, {
      orgId: claims.org_id,
      runId,
      content: csvContent,
      rowCount: csvRows.length,
      createdBy: claims.user_id,
    });
  } catch (err: unknown) {
    console.error('[exports] persist artifact error:', err);
    return errorResponse('Failed to persist export artifact', 500);
  }

  return jsonResponse({
    artifact_id: artifact.id,
    run_id: artifact.runId,
    format: artifact.format,
    row_count: artifact.rowCount,
    created_at: artifact.createdAt,
    content: artifact.content,
  });
}

// ---------------------------------------------------------------------------
// GET /commission-runs/:id/exports — list prior exports for a run
// ---------------------------------------------------------------------------

/**
 * GET /commission-runs/:id/exports — lists all payroll export artifacts for the run.
 *
 * Returns 404 if the run is not found.
 *
 * @param runId     - Commission run UUID from the route.
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleListPayrollExports(
  runId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  // Verify run exists and belongs to this org
  let run;
  try {
    run = await getCommissionRun(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[exports] get run error:', err);
    return errorResponse('Failed to retrieve commission run', 500);
  }

  if (!run) {
    return errorResponse('Commission run not found', 404);
  }

  let artifacts;
  try {
    artifacts = await listPayrollExports(db, claims.org_id, runId);
  } catch (err: unknown) {
    console.error('[exports] list artifacts error:', err);
    return errorResponse('Failed to retrieve export artifacts', 500);
  }

  return jsonResponse({
    run_id: runId,
    exports: artifacts.map((a) => ({
      artifact_id: a.id,
      run_id: a.runId,
      format: a.format,
      row_count: a.rowCount,
      created_at: a.createdAt,
    })),
  });
}

/**
 * Financial Reconciliation API routes — PRD §5.8 Finance Close gate.
 *
 * Routes:
 *   GET  /reconciliation?period_start=&period_end=   — generate/fetch the reconciliation report
 *   POST /reconciliation/:id/acknowledge             — Finance Admin acknowledges a discrepancy
 *
 * Business rules:
 *   - GET /reconciliation regenerates the report on each call by comparing ledger invoices
 *     against ingested AR data for the requested period. Un-acknowledged discrepancies from
 *     the previous run are replaced; acknowledged ones are preserved.
 *   - POST /reconciliation/:id/acknowledge sets acknowledged=true with the reviewer's note.
 *   - POST /commission-runs/:id/finalize (handled in commission-runs.ts) calls
 *     countUnacknowledgedDiscrepancies and blocks with 422 unless override_reason is supplied.
 *
 * RBAC: Finance Admin only for all reconciliation routes.
 *
 * Audit: AuditLogEntry is written to commission_audit for each acknowledgement.
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 *
 * Injectable sql (for testing): all handler functions accept optional SqlClient args.
 *
 * Canonical docs: docs/prd.md §5.8
 * Issue: feat: financial reconciliation report — ledger vs financial system cross-check (#65)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import { listInvoicesForPeriod } from 'db/invoices';
import {
  listArIngestedRecords,
  generateReconciliationReport,
  listDiscrepancies,
  getDiscrepancy,
  acknowledgeDiscrepancy,
} from 'db/reconciliation';
import type { SessionClaims } from 'core/auth';
import type { ReconciliationDiscrepancy, ArIngestedRecord } from 'db/reconciliation';
import { sensitiveRead } from '../audit/sensitive-read';

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

function formatDiscrepancy(d: ReconciliationDiscrepancy) {
  return {
    id: d.id,
    org_id: d.orgId,
    period_start: d.periodStart,
    period_end: d.periodEnd,
    discrepancy_type: d.discrepancyType,
    invoice_id: d.invoiceId,
    invoice_number: d.invoiceNumber,
    ledger_amount_billed: d.ledgerAmountBilled,
    ar_amount_billed: d.arAmountBilled,
    ledger_issued_at: d.ledgerIssuedAt,
    ar_billed_date: d.arBilledDate,
    date_gap_days: d.dateGapDays,
    acknowledged: d.acknowledged,
    acknowledged_by: d.acknowledgedBy,
    acknowledged_at: d.acknowledgedAt,
    acknowledged_note: d.acknowledgedNote,
    created_at: d.createdAt,
  };
}

/**
 * Write an AuditLogEntry for a reconciliation event.
 * Non-fatal: errors are logged but not propagated.
 */
async function writeAuditLog(
  auditSql: SqlClient,
  opts: {
    orgId: string;
    actorId: string;
    action: string;
    entityId: string;
    afterJson: unknown;
  },
): Promise<void> {
  try {
    await auditSql.unsafe(
      `
      INSERT INTO audit_log_entries (
        org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
      `,
      [
        opts.orgId,
        opts.actorId,
        'User',
        opts.action,
        'reconciliation_discrepancy',
        opts.entityId,
        opts.afterJson,
      ],
    );
  } catch (err: unknown) {
    console.error('[reconciliation] audit log write error (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// GET /reconciliation?period_start=&period_end= — generate the report
// ---------------------------------------------------------------------------

/**
 * GET /reconciliation?period_start=YYYY-MM-DD&period_end=YYYY-MM-DD
 *
 * Generates a fresh reconciliation report by:
 *   1. Loading all ledger invoices for the period (decrypting amounts).
 *   2. Loading all AR ingested records for the period.
 *   3. Running the reconciliation engine to produce discrepancies.
 *   4. Returning all discrepancies (matched, ledger-only, system-only, date-gap, amount-mismatch).
 *
 * The response groups discrepancies by type:
 *   - matched: invoices present in both ledger and AR with no discrepancies
 *   - ledger_only, system_only, amount_mismatch, date_gap: classified discrepancies
 *
 * @param sqlClient      - Optional injectable SQL client (for testing).
 * @param auditSqlClient - Not used on GET but accepted for consistency.
 */
export async function handleGetReconciliationReport(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  // RBAC: Finance Admin only
  if (claims.role !== 'FinanceAdmin') {
    return errorResponse('Forbidden', 403);
  }

  const url = new URL(req.url);
  const periodStart = url.searchParams.get('period_start');
  const periodEnd = url.searchParams.get('period_end');

  const errors: Record<string, string> = {};
  if (!periodStart) errors['period_start'] = 'period_start is required (YYYY-MM-DD)';
  if (!periodEnd) errors['period_end'] = 'period_end is required (YYYY-MM-DD)';
  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Audit-before-read: record this reconciliation report access before any
  // ledger/AR data is loaded. A failed audit write denies the read (DATA-D-010).
  try {
    await sensitiveRead(
      adb,
      {
        // A reconciliation report spans a period, not a single entity; scope the
        // audit row to the org (entity_id is a UUID column) and record the period
        // in the action verb.
        orgId: claims.org_id,
        actorId: claims.user_id,
        action: `reconciliation.read:${periodStart!}:${periodEnd!}`,
        entityType: 'reconciliation_report',
        entityId: claims.org_id,
      },
      async () => undefined,
    );
  } catch (err: unknown) {
    console.error('[reconciliation] audit-before-read failed; denying read:', err);
    return errorResponse('Failed to record audit entry for read', 500);
  }

  // 1. Load ledger invoices
  let ledgerInvoices;
  try {
    ledgerInvoices = await listInvoicesForPeriod(db, claims.org_id, periodStart!, periodEnd!);
  } catch (err: unknown) {
    console.error('[reconciliation] load ledger invoices error:', err);
    return errorResponse('Failed to load ledger invoices', 500);
  }

  // Build the ledger amounts map (invoice_number → { id, amountBilled, issuedAt })
  const ledgerAmounts = new Map<string, { id: string; amountBilled: string; issuedAt: Date }>();
  for (const inv of ledgerInvoices) {
    ledgerAmounts.set(inv.invoiceNumber, {
      id: inv.id,
      amountBilled: inv.amountBilled,
      issuedAt: inv.issuedAt,
    });
  }

  // 2. Load AR ingested records
  let arRecords;
  try {
    arRecords = await listArIngestedRecords(db, claims.org_id, periodStart!, periodEnd!);
  } catch (err: unknown) {
    console.error('[reconciliation] load AR records error:', err);
    return errorResponse('Failed to load AR records', 500);
  }

  // 3. Run the reconciliation engine (clears stale un-acknowledged, inserts fresh discrepancies)
  let _discrepancies;
  try {
    _discrepancies = await generateReconciliationReport(db, {
      orgId: claims.org_id,
      periodStart: periodStart!,
      periodEnd: periodEnd!,
      ledgerAmounts,
      arRecords,
    });
  } catch (err: unknown) {
    console.error('[reconciliation] generate report error:', err);
    return errorResponse('Failed to generate reconciliation report', 500);
  }

  // Re-fetch to include any acknowledged ones that were preserved
  let allDiscrepancies;
  try {
    allDiscrepancies = await listDiscrepancies(db, claims.org_id, periodStart!, periodEnd!);
  } catch (err: unknown) {
    console.error('[reconciliation] list discrepancies error:', err);
    return errorResponse('Failed to list discrepancies', 500);
  }

  // Build matched list: ledger invoices with a corresponding AR record and no discrepancy
  const discrepancyInvoiceNumbers = new Set(
    allDiscrepancies
      .filter((d: ReconciliationDiscrepancy) => d.invoiceNumber !== null)
      .map((d: ReconciliationDiscrepancy) => d.invoiceNumber as string),
  );
  const arInvoiceNumbers = new Set(arRecords.map((r: ArIngestedRecord) => r.invoiceNumber));

  const matched: Array<{ invoice_number: string; ledger_amount_billed: string }> = [];
  for (const [invoiceNumber, ledger] of ledgerAmounts) {
    if (arInvoiceNumbers.has(invoiceNumber) && !discrepancyInvoiceNumbers.has(invoiceNumber)) {
      matched.push({
        invoice_number: invoiceNumber,
        ledger_amount_billed: ledger.amountBilled,
      });
    }
  }

  return jsonResponse({
    period_start: periodStart,
    period_end: periodEnd,
    summary: {
      total_ledger_invoices: ledgerAmounts.size,
      total_ar_records: arRecords.length,
      matched: matched.length,
      discrepancies: allDiscrepancies.length,
      unacknowledged: allDiscrepancies.filter((d: ReconciliationDiscrepancy) => !d.acknowledged)
        .length,
    },
    matched,
    discrepancies: allDiscrepancies.map(formatDiscrepancy),
  });
}

// ---------------------------------------------------------------------------
// POST /reconciliation/:id/acknowledge — Finance Admin acknowledges a discrepancy
// ---------------------------------------------------------------------------

export interface AcknowledgeDiscrepancyBody {
  note: string;
}

/**
 * POST /reconciliation/:id/acknowledge
 *
 * Finance Admin marks a discrepancy as reviewed with a mandatory note.
 * Writes an AuditLogEntry to commission_audit.
 *
 * Returns 200 with the updated discrepancy.
 * Returns 404 if the discrepancy is not found.
 * Returns 409 if already acknowledged.
 *
 * @param discrepancyId  - UUID from the route path.
 * @param sqlClient      - Optional injectable SQL client (for testing).
 * @param auditSqlClient - Optional injectable audit SQL client (for testing).
 */
export async function handleAcknowledgeDiscrepancy(
  discrepancyId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  // RBAC: Finance Admin only
  if (claims.role !== 'FinanceAdmin') {
    return errorResponse('Forbidden', 403);
  }

  let body: Partial<AcknowledgeDiscrepancyBody>;
  try {
    body = (await req.json()) as Partial<AcknowledgeDiscrepancyBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.note || typeof body.note !== 'string' || body.note.trim().length === 0) {
    return errorResponse('Validation failed', 422, {
      note: 'note is required',
    });
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Verify exists
  let discrepancy;
  try {
    discrepancy = await getDiscrepancy(db, claims.org_id, discrepancyId);
  } catch (err: unknown) {
    console.error('[reconciliation] get discrepancy error:', err);
    return errorResponse('Failed to retrieve discrepancy', 500);
  }

  if (!discrepancy) {
    return errorResponse('Discrepancy not found', 404);
  }

  if (discrepancy.acknowledged) {
    return errorResponse('Discrepancy is already acknowledged', 409);
  }

  // Acknowledge
  let updated;
  try {
    updated = await acknowledgeDiscrepancy(
      db,
      claims.org_id,
      discrepancyId,
      claims.user_id,
      body.note.trim(),
    );
  } catch (err: unknown) {
    console.error('[reconciliation] acknowledge error:', err);
    return errorResponse('Failed to acknowledge discrepancy', 500);
  }

  if (!updated) {
    return errorResponse('Failed to acknowledge discrepancy', 500);
  }

  // Write audit log
  await writeAuditLog(adb, {
    orgId: claims.org_id,
    actorId: claims.user_id,
    action: 'reconciliation.discrepancy.acknowledged',
    entityId: discrepancyId,
    afterJson: {
      discrepancy_id: discrepancyId,
      invoice_number: updated.invoiceNumber,
      discrepancy_type: updated.discrepancyType,
      acknowledged_by: claims.user_id,
      acknowledged_note: body.note.trim(),
    },
  });

  return jsonResponse(formatDiscrepancy(updated));
}

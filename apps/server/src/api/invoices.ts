/**
 * Invoice API routes.
 *
 * Routes:
 *   POST   /invoices                  — create an invoice linked to a placement (status=Issued)
 *   PATCH  /invoices/:id              — update invoice status and paid_amount
 *   POST   /invoices/import           — batch CSV import of invoice status updates
 *   GET    /commission-records        — list Held commission records, filterable by ?reason=
 *
 * Invoice state lifecycle (PRD §6):
 *   Issued → PartiallyPaid → Paid
 *   Issued → Disputed
 *   Issued → WrittenOff
 *   CreditMemoApplied as an event
 *
 * When an invoice transitions to Paid, the collection gate is released:
 *   all commission_records for that placement with hold_reason='collection_gate'
 *   are updated to status='Payable'.
 *
 * When an invoice transitions to WrittenOff, an AuditLogEntry is created.
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 *
 * Injectable sql (for testing):
 *   All handler functions accept an optional SqlClient and optional auditSqlClient.
 *
 * Canonical docs: docs/prd.md §5.5, §7.2
 * Issue: feat: invoice and collection tracking (#12)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import { getPlacement } from 'db/placements';
import {
  createInvoice,
  getInvoice,
  updateInvoice,
  upsertInvoiceByNumber,
  releaseCollectionGate,
  listHeldCommissionRecordsByReason,
  INVOICE_STATES,
  type HeldCommissionRecordRow,
} from 'db/invoices';
import { releasePhaseCollectionGate } from 'db/billing-phases';
import type { SessionClaims } from 'core/auth';
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

/** Format an invoice row for API responses */
function formatInvoice(row: {
  id: string;
  orgId: string;
  placementId: string;
  invoiceNumber: string;
  amountBilled: string;
  amountCollected: string | null;
  status: string;
  issuedAt: Date;
  dueAt: Date | null;
  collectedAt: Date | null;
}) {
  return {
    id: row.id,
    org_id: row.orgId,
    placement_id: row.placementId,
    invoice_number: row.invoiceNumber,
    amount_billed: row.amountBilled,
    amount_collected: row.amountCollected,
    status: row.status,
    issued_at: row.issuedAt,
    due_at: row.dueAt,
    collected_at: row.collectedAt,
  };
}

/**
 * Write an AuditLogEntry for an invoice state change.
 * Failures are logged but do not propagate (audit writes are best-effort).
 */
async function writeInvoiceAuditLog(
  auditSql: SqlClient,
  opts: {
    orgId: string;
    actorId: string;
    action: string;
    entityId: string;
    beforeJson?: unknown;
    afterJson: unknown;
  },
): Promise<void> {
  try {
    const beforeJsonStr = opts.beforeJson != null ? JSON.stringify(opts.beforeJson) : null;
    const afterJsonStr = JSON.stringify(opts.afterJson);

    await auditSql.unsafe(
      `
      INSERT INTO audit_log_entries (
        org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      `,
      [
        opts.orgId,
        opts.actorId,
        'User',
        opts.action,
        'invoice',
        opts.entityId,
        beforeJsonStr,
        afterJsonStr,
      ],
    );
  } catch (err: unknown) {
    console.error('[invoices] audit log write error (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// POST /invoices — create an invoice linked to a placement
// ---------------------------------------------------------------------------

export interface CreateInvoiceBody {
  placement_id: string;
  invoice_number: string;
  amount_billed: string;
  issued_at?: string;
  due_at?: string | null;
}

/**
 * POST /invoices — creates a new invoice linked to a placement with status=Issued.
 *
 * Returns 201 with the created invoice.
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 * Returns 422 if required fields are missing or invalid.
 *
 * @param sqlClient      - Optional injectable SQL client (for testing).
 * @param auditSqlClient - Optional injectable audit SQL client (for testing).
 */
export async function handleCreateInvoice(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<CreateInvoiceBody>;
  try {
    body = (await req.json()) as Partial<CreateInvoiceBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const errors: Record<string, string> = {};
  if (!body.placement_id) errors['placement_id'] = 'placement_id is required';
  if (!body.invoice_number || String(body.invoice_number).trim() === '') {
    errors['invoice_number'] = 'invoice_number is required';
  }
  if (!body.amount_billed || isNaN(Number(body.amount_billed))) {
    errors['amount_billed'] = 'amount_billed must be a numeric string';
  }
  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Verify placement exists and belongs to the session org
  try {
    const placement = await getPlacement(db, body.placement_id!);
    if (!placement || placement.orgId !== claims.org_id) {
      return errorResponse('Placement not found', 404);
    }
  } catch (err: unknown) {
    console.error('[invoices] get placement error:', err);
    return errorResponse('Failed to verify placement', 500);
  }

  try {
    const invoice = await createInvoice(db, {
      orgId: claims.org_id,
      placementId: body.placement_id!,
      invoiceNumber: body.invoice_number!,
      amountBilled: body.amount_billed!,
      status: 'Issued',
      issuedAt: body.issued_at ?? new Date().toISOString(),
      dueAt: body.due_at ?? null,
    });

    // Audit the creation
    await writeInvoiceAuditLog(adb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      action: 'invoice.created',
      entityId: invoice.id,
      afterJson: { status: invoice.status, invoice_number: invoice.invoiceNumber },
    });

    return jsonResponse(formatInvoice(invoice), 201);
  } catch (err: unknown) {
    console.error('[invoices] create error:', err);
    return errorResponse('Failed to create invoice', 500);
  }
}

// ---------------------------------------------------------------------------
// PATCH /invoices/:id — update invoice status and paid amount
// ---------------------------------------------------------------------------

export interface UpdateInvoiceBody {
  status?: string;
  amount_collected?: string | null;
  due_at?: string | null;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  Issued: ['PartiallyPaid', 'Paid', 'Disputed', 'WrittenOff', 'CreditMemoApplied'],
  PartiallyPaid: ['Paid', 'Disputed', 'WrittenOff', 'CreditMemoApplied'],
  Paid: [],
  Disputed: ['Issued', 'WrittenOff'],
  WrittenOff: [],
  CreditMemoApplied: [],
};

/**
 * PATCH /invoices/:id — updates invoice status and optional paid amount.
 *
 * When status transitions to 'Paid', collection-gated commission records for the
 * associated placement are automatically released (status → Payable).
 *
 * When status transitions to 'WrittenOff', an AuditLogEntry is created.
 *
 * Returns 200 with the updated invoice and release count for Paid transitions.
 * Returns 404 if the invoice does not exist or belongs to a different tenant.
 * Returns 422 if the status transition is invalid.
 *
 * @param invoiceId      - Invoice UUID from the route.
 * @param sqlClient      - Optional injectable SQL client (for testing).
 * @param auditSqlClient - Optional injectable audit SQL client (for testing).
 */
export async function handleUpdateInvoice(
  invoiceId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<UpdateInvoiceBody>;
  try {
    body = (await req.json()) as Partial<UpdateInvoiceBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Fetch existing invoice
  let existing;
  try {
    existing = await getInvoice(db, claims.org_id, invoiceId);
  } catch (err: unknown) {
    console.error('[invoices] get invoice error:', err);
    return errorResponse('Failed to retrieve invoice', 500);
  }

  if (!existing) {
    return errorResponse('Invoice not found', 404);
  }

  // Validate state transition
  if (body.status !== undefined) {
    const validStatuses = INVOICE_STATES as ReadonlyArray<string>;
    if (!validStatuses.includes(body.status)) {
      return errorResponse(`Invalid status: ${body.status}`, 422, {
        status: `must be one of: ${INVOICE_STATES.join(', ')}`,
      });
    }

    const allowedTransitions = VALID_TRANSITIONS[existing.status] ?? [];
    if (body.status !== existing.status && !allowedTransitions.includes(body.status)) {
      return errorResponse(`Invalid status transition: ${existing.status} → ${body.status}`, 422, {
        status: `Cannot transition from ${existing.status} to ${body.status}`,
      });
    }
  }

  // Validate amount_collected if provided
  if (
    body.amount_collected !== undefined &&
    body.amount_collected !== null &&
    isNaN(Number(body.amount_collected))
  ) {
    return errorResponse('Validation failed', 422, {
      amount_collected: 'amount_collected must be a numeric string',
    });
  }

  try {
    const updated = await updateInvoice(db, claims.org_id, invoiceId, {
      status: body.status,
      amountCollected: body.amount_collected,
      dueAt: body.due_at,
    });

    if (!updated) {
      return errorResponse('Invoice not found', 404);
    }

    let collectionReleasedCount = 0;

    // When transitioning to Paid: release collection-gated commission records.
    // Step 1: release placement-level (contingency) collection gate records.
    // Step 2: release phase-level records where this invoice is the phase's linked invoice.
    if (body.status === 'Paid') {
      try {
        collectionReleasedCount = await releaseCollectionGate(
          db,
          claims.org_id,
          updated.placementId,
        );
      } catch (err: unknown) {
        console.error('[invoices] collection gate release error:', err);
        // Non-fatal — log but continue
      }

      // Phase-scoped release: find any billing_phases that link to this invoice and release
      // commission records held pending this phase's invoice payment.
      try {
        const phaseRows = await db.unsafe(
          `
          SELECT id FROM billing_phases
          WHERE org_id = $1 AND invoice_id = $2
          `,
          [claims.org_id, updated.id],
        );

        if (phaseRows && phaseRows.length > 0) {
          for (const phaseRow of phaseRows as unknown as { id: string }[]) {
            const phaseReleased = await releasePhaseCollectionGate(
              db,
              claims.org_id,
              phaseRow.id,
              updated.id,
            );
            collectionReleasedCount += phaseReleased;
          }
        }
      } catch (err: unknown) {
        console.error('[invoices] phase collection gate release error:', err);
        // Non-fatal — log but continue
      }
    }

    // Audit state changes for WrittenOff (and all transitions)
    const auditAction =
      body.status === 'WrittenOff'
        ? 'invoice.written_off'
        : body.status === 'Paid'
          ? 'invoice.paid'
          : body.status
            ? `invoice.status_changed`
            : 'invoice.updated';

    await writeInvoiceAuditLog(adb, {
      orgId: claims.org_id,
      actorId: claims.user_id,
      action: auditAction,
      entityId: updated.id,
      beforeJson: { status: existing.status },
      afterJson: {
        status: updated.status,
        amount_collected: updated.amountCollected,
        collection_released: collectionReleasedCount,
      },
    });

    return jsonResponse({
      ...formatInvoice(updated),
      collection_released: collectionReleasedCount,
    });
  } catch (err: unknown) {
    console.error('[invoices] update error:', err);
    return errorResponse('Failed to update invoice', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /invoices/import — batch CSV import
// ---------------------------------------------------------------------------

/**
 * Parse an invoice import CSV string.
 *
 * Expected headers (case-insensitive, trimmed):
 *   invoice_number, placement_id, amount_billed, status, amount_collected (optional)
 */
export function parseInvoiceCsv(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 1) throw new Error('CSV is empty');

  let headerLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      headerLineIndex = i;
      break;
    }
  }
  if (headerLineIndex === -1) throw new Error('CSV has no header row');

  const headers = lines[headerLineIndex].split(',').map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_'),
  );

  const requiredHeaders = ['invoice_number', 'placement_id', 'amount_billed', 'status'];
  for (const req of requiredHeaders) {
    if (!headers.includes(req)) {
      throw new Error(`CSV missing required column: ${req}`);
    }
  }

  const rows: Record<string, string>[] = [];
  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;

    const cells = line.split(',').map((c) => c.trim());
    if (cells.length !== headers.length) {
      throw new Error(
        `CSV row ${i + 1} has ${cells.length} columns but header has ${headers.length}`,
      );
    }

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

/**
 * POST /invoices/import — batch import invoice status updates from CSV.
 *
 * Accepts:
 *   - Content-Type: text/csv — raw CSV body
 *   - Content-Type: multipart/form-data — CSV file in a field named "file"
 *
 * CSV format: invoice_number, placement_id, amount_billed, status, amount_collected (optional)
 *
 * For each row: creates or updates the invoice (upsert by invoice_number + org).
 * When an invoice reaches Paid via import, collection-gated commission records are released.
 *
 * Returns 200 with { processed: number, invoices: [...], collection_released: number }.
 *
 * @param sqlClient      - Optional injectable SQL client (for testing).
 * @param auditSqlClient - Optional injectable audit SQL client (for testing).
 */
export async function handleImportInvoices(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const contentType = req.headers.get('content-type') ?? '';
  let csvText: string;

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return errorResponse('Multipart upload must include a "file" field', 400);
      }
      csvText = await (file as File).text();
    } else {
      csvText = await req.text();
    }
  } catch (err: unknown) {
    return errorResponse(`Failed to read request body: ${(err as Error).message}`, 400);
  }

  if (!csvText || csvText.trim() === '') {
    return errorResponse('CSV body is empty', 400);
  }

  let rows: Record<string, string>[];
  try {
    rows = parseInvoiceCsv(csvText);
  } catch (err: unknown) {
    return errorResponse(`CSV parse error: ${(err as Error).message}`, 400);
  }

  if (rows.length === 0) {
    return jsonResponse({ processed: 0, invoices: [], collection_released: 0 });
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;
  const processed = [];
  let totalCollectionReleased = 0;

  for (const row of rows) {
    const invoiceNumber = row['invoice_number'];
    const placementId = row['placement_id'];
    const amountBilled = row['amount_billed'];
    const status = row['status'];
    const amountCollected = row['amount_collected'] || null;

    if (!invoiceNumber || !placementId || !amountBilled || !status) {
      return errorResponse(`CSV row missing required fields: ${JSON.stringify(row)}`, 422);
    }

    const validStatuses = INVOICE_STATES as ReadonlyArray<string>;
    if (!validStatuses.includes(status)) {
      return errorResponse(`Invalid status in CSV row: ${status}`, 422);
    }

    try {
      const invoice = await upsertInvoiceByNumber(db, claims.org_id, {
        orgId: claims.org_id,
        placementId,
        invoiceNumber,
        amountBilled,
        status,
        amountCollected: amountCollected ?? undefined,
      });

      // Release collection gate if this invoice just became Paid
      if (status === 'Paid') {
        try {
          const released = await releaseCollectionGate(db, claims.org_id, invoice.placementId);
          totalCollectionReleased += released;
        } catch (err: unknown) {
          console.error('[invoices] import collection gate release error:', err);
        }
      }

      // Audit each import row
      await writeInvoiceAuditLog(adb, {
        orgId: claims.org_id,
        actorId: claims.user_id,
        action: 'invoice.imported',
        entityId: invoice.id,
        afterJson: { status: invoice.status, invoice_number: invoice.invoiceNumber },
      });

      processed.push(formatInvoice(invoice));
    } catch (err: unknown) {
      console.error('[invoices] import row error:', err);
      return errorResponse(`Failed to import row: ${JSON.stringify(row)}`, 500);
    }
  }

  return jsonResponse({
    processed: processed.length,
    invoices: processed,
    collection_released: totalCollectionReleased,
  });
}

// ---------------------------------------------------------------------------
// GET /commission-records — list commission records with optional status/reason filter
// ---------------------------------------------------------------------------

/**
 * GET /commission-records?status=Held&reason=collection_gate
 *
 * Lists commission records for the authenticated tenant.
 * Supports filtering by hold reason (returns only Held records with the given reason).
 *
 * Query params:
 *   ?reason=collection_gate — return Held records with hold_reason='collection_gate'
 *   ?reason=guarantee_hold  — return Held records with hold_reason='guarantee_hold'
 *
 * Returns 200 with { commission_records: [...] }.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleListAllCommissionRecords(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;
  const url = new URL(req.url);
  const reason = url.searchParams.get('reason');

  try {
    if (reason) {
      // Audit-before-read: a failed audit write denies the read (DATA-D-010).
      const records = await sensitiveRead(
        adb,
        {
          orgId: claims.org_id,
          actorId: claims.user_id,
          action: 'commission_record.list',
          entityType: 'commission_record',
          entityId: claims.org_id,
        },
        () => listHeldCommissionRecordsByReason(db, claims.org_id, reason),
      );
      return jsonResponse({
        commission_records: records.map((r: HeldCommissionRecordRow) => ({
          id: r.id,
          org_id: r.org_id,
          placement_id: r.placement_id,
          contributor_id: r.contributor_id,
          plan_version_id: r.plan_version_id,
          status: r.status,
          hold_reason: r.hold_reason,
          created_at: r.created_at,
        })),
      });
    }

    // Without a reason filter, return an empty list (full list not in MVP scope)
    return jsonResponse({ commission_records: [] });
  } catch (err: unknown) {
    console.error('[commission-records] list error:', err);
    return errorResponse('Failed to list commission records', 500);
  }
}

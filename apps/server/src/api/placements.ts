/**
 * Placement API routes.
 *
 * Routes:
 *   POST /placements              — create a placement manually
 *   POST /placements/import       — import placements from CSV upload
 *   GET  /placements              — list placements for the authenticated tenant
 *   GET  /placements/:id          — get a single placement by ID
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 * Encrypted fields: compensationBase (fee_amount in CSV) and feeAmount
 * are stored as BYTEA via FieldEncryptor; all handlers receive/return
 * plaintext string values.
 *
 * Injectable sql (for testing):
 *   All handler functions accept an optional SqlClient so tests can inject
 *   an ephemeral Postgres connection without touching the module-level pool.
 *
 * Canonical docs: docs/prd.md §5.1, docs/architecture.md — Phase 2 Domain
 * Issue: feat: placement record creation — manual entry and CSV import
 */

import { createPlacement, getPlacement, listPlacements } from 'db/placements';
import { sql as defaultSql } from 'db/index';
import type { SessionClaims } from 'core/auth';
import type { Sql } from 'postgres';

type SqlClient = Sql;

/**
 * Format a Date or date string as an ISO date string (YYYY-MM-DD).
 * Returns null for null/undefined inputs.
 */
function formatDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

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
// CSV parsing utilities
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string into an array of row objects.
 *
 * Expected header columns (case-insensitive, trimmed):
 *   client, job_order, candidate, start_date, fee_pct, compensation_base, gross_fee
 *
 * Rows with all empty values are skipped (blank lines).
 *
 * @throws Error with a message describing the problem when the CSV is malformed.
 */
export function parsePlacementCsv(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 1) throw new Error('CSV is empty');

  // Find the first non-empty line as the header
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

  const requiredHeaders = [
    'client',
    'job_order',
    'candidate',
    'start_date',
    'fee_pct',
    'compensation_base',
    'gross_fee',
  ];
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

// ---------------------------------------------------------------------------
// POST /placements — create a placement
// ---------------------------------------------------------------------------

export interface CreatePlacementBody {
  candidate_id: string;
  client_entity_id: string;
  job_title: string;
  start_date?: string | null;
  fee_pct?: string;
  fee_amount?: string;
  compensation_base: string;
  guarantee_days?: number | null;
}

/** Required fields for a complete placement. Missing any → 'Created' with incomplete flag. */
const REQUIRED_FIELDS: (keyof CreatePlacementBody)[] = [
  'candidate_id',
  'client_entity_id',
  'job_title',
  'compensation_base',
];

/**
 * Validate a placement creation body.
 * Returns a map of field → error message for any missing or invalid fields.
 */
function validatePlacementBody(body: Partial<CreatePlacementBody>): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || String(body[field]).trim() === '') {
      errors[field] = `${field} is required`;
    }
  }

  // Must have fee_amount OR fee_pct
  if (!body.fee_amount && !body.fee_pct) {
    errors['fee_amount'] = 'fee_amount or fee_pct is required';
  }

  if (body.compensation_base && isNaN(Number(body.compensation_base))) {
    errors['compensation_base'] = 'compensation_base must be a numeric string';
  }

  if (body.fee_amount && isNaN(Number(body.fee_amount))) {
    errors['fee_amount'] = 'fee_amount must be a numeric string';
  }

  if (body.fee_pct && isNaN(Number(body.fee_pct))) {
    errors['fee_pct'] = 'fee_pct must be a numeric string';
  }

  return errors;
}

/**
 * Compute fee_amount from compensation_base and fee_pct when fee_amount is absent.
 */
function resolveFeeAmount(body: CreatePlacementBody): string {
  if (body.fee_amount) return body.fee_amount;
  // fee_pct is a percentage (e.g. "20" = 20%)
  const base = Number(body.compensation_base);
  const pct = Number(body.fee_pct ?? 0);
  return String(Math.round((base * pct) / 100));
}

/**
 * POST /placements — creates a single placement record.
 *
 * Returns 201 with the new placement when all required fields are present.
 * Returns 422 with field-level errors when required fields are missing or invalid.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleCreatePlacement(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<CreatePlacementBody>;
  try {
    body = (await req.json()) as Partial<CreatePlacementBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const errors = validatePlacementBody(body as CreatePlacementBody);
  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  const typedBody = body as CreatePlacementBody;
  const db = sqlClient ?? defaultSql;

  try {
    const placement = await createPlacement(db, {
      orgId: claims.org_id,
      candidateId: typedBody.candidate_id,
      clientEntityId: typedBody.client_entity_id,
      jobTitle: typedBody.job_title,
      compensationBase: typedBody.compensation_base,
      feeAmount: resolveFeeAmount(typedBody),
      startDate: typedBody.start_date ?? null,
      guaranteeDays: typedBody.guarantee_days ?? null,
      status: 'Created',
    });

    return jsonResponse(
      {
        id: placement.id,
        org_id: placement.orgId,
        candidate_id: placement.candidateId,
        client_entity_id: placement.clientEntityId,
        job_title: placement.jobTitle,
        compensation_base: placement.compensationBase,
        fee_amount: placement.feeAmount,
        status: placement.status,
        start_date: formatDate(placement.startDate),
        guarantee_days: placement.guaranteeDays,
        created_at: placement.createdAt,
        updated_at: placement.updatedAt,
      },
      201,
    );
  } catch (err: unknown) {
    console.error('[placements] create error:', err);
    return errorResponse('Failed to create placement', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /placements/import — CSV import
// ---------------------------------------------------------------------------

/**
 * POST /placements/import — imports placements from a multipart/form-data CSV upload
 * or a raw text/csv body.
 *
 * Accepts:
 *   - Content-Type: text/csv — raw CSV body
 *   - Content-Type: multipart/form-data — CSV file in a field named "file"
 *
 * Returns 200 with { created: number, placements: Placement[] } on success.
 * Returns 400 with a parseable error body on malformed CSV.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleImportPlacements(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
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
      // Treat body as raw CSV text
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
    rows = parsePlacementCsv(csvText);
  } catch (err: unknown) {
    return errorResponse(`CSV parse error: ${(err as Error).message}`, 400);
  }

  if (rows.length === 0) {
    return jsonResponse({ created: 0, placements: [] });
  }

  const db = sqlClient ?? defaultSql;
  const created = [];

  for (const row of rows) {
    // Resolve fee_amount: prefer gross_fee column, fall back to fee_pct * compensation_base
    let feeAmount: string;
    if (row['gross_fee'] && row['gross_fee'].trim() !== '' && !isNaN(Number(row['gross_fee']))) {
      feeAmount = row['gross_fee'];
    } else if (
      row['fee_pct'] &&
      row['fee_pct'].trim() !== '' &&
      !isNaN(Number(row['fee_pct'])) &&
      row['compensation_base'] &&
      !isNaN(Number(row['compensation_base']))
    ) {
      const base = Number(row['compensation_base']);
      const pct = Number(row['fee_pct']);
      feeAmount = String(Math.round((base * pct) / 100));
    } else {
      feeAmount = '0';
    }

    const compensationBase =
      row['compensation_base'] && !isNaN(Number(row['compensation_base']))
        ? row['compensation_base']
        : '0';

    try {
      const placement = await createPlacement(db, {
        orgId: claims.org_id,
        // CSV contains human-readable names; generate surrogate UUIDs for MVP.
        // A future issue will resolve these to entity IDs via ATS lookup.
        candidateId: crypto.randomUUID(),
        clientEntityId: crypto.randomUUID(),
        jobTitle: row['job_order'] || 'Unknown',
        compensationBase,
        feeAmount,
        startDate: row['start_date'] || null,
        guaranteeDays: null,
        status: 'Created',
      });
      created.push({
        id: placement.id,
        org_id: placement.orgId,
        candidate_id: placement.candidateId,
        client_entity_id: placement.clientEntityId,
        job_title: placement.jobTitle,
        compensation_base: placement.compensationBase,
        fee_amount: placement.feeAmount,
        status: placement.status,
        start_date: formatDate(placement.startDate),
        created_at: placement.createdAt,
      });
    } catch (err: unknown) {
      console.error('[placements] import row error:', err);
      return errorResponse(`Failed to import row: ${JSON.stringify(row)}`, 500);
    }
  }

  return jsonResponse({ created: created.length, placements: created });
}

// ---------------------------------------------------------------------------
// GET /placements — list placements for the tenant
// ---------------------------------------------------------------------------

/**
 * GET /placements — lists all placements for the authenticated tenant (org_id).
 *
 * Multi-tenant isolation: only placements with org_id === session org_id are returned.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleListPlacements(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  try {
    const placements = await listPlacements(db, claims.org_id);
    return jsonResponse(
      placements.map((p) => ({
        id: p.id,
        org_id: p.orgId,
        candidate_id: p.candidateId,
        client_entity_id: p.clientEntityId,
        job_title: p.jobTitle,
        compensation_base: p.compensationBase,
        fee_amount: p.feeAmount,
        status: p.status,
        start_date: formatDate(p.startDate),
        guarantee_days: p.guaranteeDays,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      })),
    );
  } catch (err: unknown) {
    console.error('[placements] list error:', err);
    return errorResponse('Failed to list placements', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /placements/:id — get a single placement
// ---------------------------------------------------------------------------

/**
 * GET /placements/:id — fetches a single placement by ID.
 *
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleGetPlacement(
  placementId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  try {
    const placement = await getPlacement(db, placementId);

    if (!placement) {
      return errorResponse('Placement not found', 404);
    }

    // Tenant isolation: ensure the placement belongs to the session org
    if (placement.orgId !== claims.org_id) {
      return errorResponse('Placement not found', 404);
    }

    return jsonResponse({
      id: placement.id,
      org_id: placement.orgId,
      candidate_id: placement.candidateId,
      client_entity_id: placement.clientEntityId,
      job_title: placement.jobTitle,
      compensation_base: placement.compensationBase,
      fee_amount: placement.feeAmount,
      status: placement.status,
      start_date: formatDate(placement.startDate),
      guarantee_days: placement.guaranteeDays,
      created_at: placement.createdAt,
      updated_at: placement.updatedAt,
    });
  } catch (err: unknown) {
    console.error('[placements] get error:', err);
    return errorResponse('Failed to get placement', 500);
  }
}

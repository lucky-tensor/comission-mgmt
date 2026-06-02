/**
 * Placement API routes.
 *
 * Routes:
 *   POST   /placements              — create a placement manually
 *   POST   /placements/import       — import placements from CSV upload
 *   GET    /placements              — list placements for the authenticated tenant
 *   GET    /placements/incomplete   — list placements with missing commission-required fields
 *   GET    /placements/:id          — get a single placement by ID
 *   PATCH  /placements/:id          — update a placement (fill in missing fields)
 *   GET    /partner/placements/:id  — External Partner view of a placement (masked if confidential)
 *   POST   /commission-runs         — pre-flight check: reject if any included placement is incomplete
 *
 * Multi-tenant isolation: all queries are scoped to the session org_id.
 * Encrypted fields: compensationBase (fee_amount in CSV) and feeAmount
 * are stored as BYTEA via FieldEncryptor; all handlers receive/return
 * plaintext string values.
 *
 * Confidential flag:
 *   Finance Admin can set is_confidential=true on a placement via PATCH /placements/:id.
 *   When set, position_title and client_entity_id are masked ("Confidential" / null) in
 *   responses to Producer and ExternalPartner roles. Finance Admin and Manager see unmasked data.
 *
 * Injectable sql (for testing):
 *   All handler functions accept an optional SqlClient so tests can inject
 *   an ephemeral Postgres connection without touching the module-level pool.
 *
 * Canonical docs: docs/prd.md §5.1, §9, docs/architecture.md §4
 * Issues: feat: placement record creation — manual entry and CSV import (#5)
 *         feat: placement completeness validation and blocking queue (#6)
 *         feat: placement confidential flag and field masking (#64)
 */

import {
  createPlacement,
  getPlacement,
  listPlacements,
  listPlacementsForPartner,
  updatePlacement,
  listIncompletePlacements,
  checkPlacementsComplete,
} from 'db/placements';
import {
  getGuaranteePeriodForPlacement,
  listPlacementIdsInsideGuaranteeWindow,
} from 'db/guarantee-periods';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import type { SessionClaims } from 'core/auth';
import type { Sql } from 'postgres';
import { sensitiveRead } from '../audit/sensitive-read';

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

/**
 * Computes guarantee_expiry_date = start_date + guarantee_days.
 * Returns null if either argument is absent.
 *
 * Uses UTC arithmetic to avoid timezone boundary issues.
 * Issue: feat: guarantee period tracking and monitoring (#19)
 */
export function computeGuaranteeExpiryDate(
  startDate: string | null | undefined,
  guaranteeDays: number | null | undefined,
): string | null {
  if (!startDate || guaranteeDays == null || guaranteeDays < 0) return null;
  const d = new Date(startDate + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + guaranteeDays);
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
// Confidential flag helpers
// ---------------------------------------------------------------------------

/**
 * Roles that see unmasked placement data even when is_confidential=true.
 * All other roles (Producer, ExternalPartner, HR, Executive) receive masked output.
 */
const UNMASKED_ROLES = new Set(['FinanceAdmin', 'Manager']);

/**
 * Returns true when the caller's role must receive masked fields on a confidential placement.
 */
function shouldMask(claims: SessionClaims, isConfidential: boolean): boolean {
  return isConfidential && !UNMASKED_ROLES.has(claims.role);
}

/**
 * Write an AuditLogEntry for a placement is_confidential change.
 * Non-fatal — errors are logged but do not fail the update.
 */
async function writePlacementConfidentialAuditLog(
  auditSqlClient: Sql,
  opts: {
    orgId: string;
    actorId: string;
    placementId: string;
    before: boolean;
    after: boolean;
  },
): Promise<void> {
  try {
    await auditSqlClient.unsafe(
      `
      INSERT INTO audit_log_entries (
        org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        opts.orgId,
        opts.actorId,
        'User',
        'placement.confidential_flag_changed',
        'placement',
        opts.placementId,
        { is_confidential: opts.before } as never,
        { is_confidential: opts.after } as never,
      ],
    );
  } catch (err: unknown) {
    console.error('[placements] audit log write error (non-fatal):', err);
  }
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
    const guaranteeDays = typedBody.guarantee_days ?? null;
    const startDate = typedBody.start_date ?? null;
    const placement = await createPlacement(db, {
      orgId: claims.org_id,
      candidateId: typedBody.candidate_id,
      clientEntityId: typedBody.client_entity_id,
      jobTitle: typedBody.job_title,
      compensationBase: typedBody.compensation_base,
      feeAmount: resolveFeeAmount(typedBody),
      startDate,
      guaranteeDays,
      guaranteeExpiryDate: computeGuaranteeExpiryDate(startDate, guaranteeDays),
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
        guarantee_expiry_date: placement.guaranteeExpiryDate,
        is_confidential: placement.isConfidential,
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
 * Supports optional query parameter:
 *   ?guarantee=active — returns only placements currently inside an active guarantee window
 *                        (today < guarantee_expiry_date AND guarantee_periods.status = 'Active').
 *
 * Multi-tenant isolation: only placements with org_id === session org_id are returned.
 *
 * Issue: feat: guarantee period tracking and monitoring (#19)
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleListPlacements(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;
  const url = new URL(req.url);
  const guaranteeFilter = url.searchParams.get('guarantee');

  try {
    // Audit-before-read: a failed audit write denies the read (DATA-D-010).
    let placements = await sensitiveRead(
      adb,
      {
        orgId: claims.org_id,
        actorId: claims.user_id,
        action: 'placement.list',
        entityType: 'placement',
        entityId: claims.org_id,
      },
      () => listPlacements(db, claims.org_id),
    );

    // Apply guarantee=active filter when requested
    if (guaranteeFilter === 'active') {
      const activeIds = await listPlacementIdsInsideGuaranteeWindow(db, claims.org_id);
      placements = placements.filter((p) => activeIds.has(p.id));
    }

    return jsonResponse(
      placements.map((p) => {
        const masked = shouldMask(claims, p.isConfidential);
        return {
          id: p.id,
          org_id: p.orgId,
          candidate_id: p.candidateId,
          client_entity_id: masked ? null : p.clientEntityId,
          job_title: masked ? 'Confidential' : p.jobTitle,
          compensation_base: p.compensationBase,
          fee_amount: p.feeAmount,
          status: p.status,
          start_date: formatDate(p.startDate),
          guarantee_days: p.guaranteeDays,
          guarantee_expiry_date: p.guaranteeExpiryDate,
          is_confidential: p.isConfidential,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
        };
      }),
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
  auditSqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  try {
    // Audit-before-read: a failed audit write denies the read (DATA-D-010).
    const placement = await sensitiveRead(
      adb,
      {
        orgId: claims.org_id,
        actorId: claims.user_id,
        action: 'placement.read',
        entityType: 'placement',
        entityId: placementId,
      },
      () => getPlacement(db, placementId),
    );

    if (!placement) {
      return errorResponse('Placement not found', 404);
    }

    // Tenant isolation: ensure the placement belongs to the session org
    if (placement.orgId !== claims.org_id) {
      return errorResponse('Placement not found', 404);
    }

    const masked = shouldMask(claims, placement.isConfidential);

    return jsonResponse({
      id: placement.id,
      org_id: placement.orgId,
      candidate_id: placement.candidateId,
      client_entity_id: masked ? null : placement.clientEntityId,
      job_title: masked ? 'Confidential' : placement.jobTitle,
      compensation_base: placement.compensationBase,
      fee_amount: placement.feeAmount,
      status: placement.status,
      start_date: formatDate(placement.startDate),
      guarantee_days: placement.guaranteeDays,
      guarantee_expiry_date: placement.guaranteeExpiryDate,
      is_confidential: placement.isConfidential,
      created_at: placement.createdAt,
      updated_at: placement.updatedAt,
    });
  } catch (err: unknown) {
    console.error('[placements] get error:', err);
    return errorResponse('Failed to get placement', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /placements/incomplete — list placements with missing required fields
// ---------------------------------------------------------------------------

/**
 * GET /placements/incomplete — returns all placements for the authenticated tenant
 * that are missing at least one commission-required field.
 *
 * Response body: Array of placement objects, each annotated with a `missing_fields`
 * array listing the field names that are absent or empty.
 *
 * Required fields for commission eligibility:
 *   - start_date
 *   - fee_amount (non-zero)
 *   - compensation_base (non-zero)
 *   - contributors (at least one contributor row)
 *
 * Canonical docs: docs/prd.md §5.1, §9 Data Completeness Gating
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleListIncompletePlacements(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  const db = sqlClient ?? defaultSql;

  try {
    const placements = await listIncompletePlacements(db, claims.org_id);
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
        is_confidential: p.isConfidential,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
        missing_fields: p.missingFields,
      })),
    );
  } catch (err: unknown) {
    console.error('[placements] list incomplete error:', err);
    return errorResponse('Failed to list incomplete placements', 500);
  }
}

// ---------------------------------------------------------------------------
// PATCH /placements/:id — update a placement
// ---------------------------------------------------------------------------

export interface UpdatePlacementBody {
  candidate_id?: string;
  client_entity_id?: string;
  job_title?: string;
  start_date?: string | null;
  fee_pct?: string;
  fee_amount?: string;
  compensation_base?: string;
  guarantee_days?: number | null;
  status?: string;
  is_confidential?: boolean;
}

/**
 * PATCH /placements/:id — updates mutable fields on an existing placement.
 *
 * Only provided fields are updated; absent fields are left unchanged.
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 * Returns 422 if any provided field value is invalid.
 *
 * Canonical docs: docs/prd.md §5.1
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleUpdatePlacement(
  placementId: string,
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<UpdatePlacementBody>;
  try {
    body = (await req.json()) as Partial<UpdatePlacementBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // RBAC: only FinanceAdmin may set the confidential flag
  if ('is_confidential' in body && claims.role !== 'FinanceAdmin') {
    return errorResponse('Only Finance Admin can set the confidential flag', 403);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  // Verify the placement exists and belongs to this tenant
  let existing: Awaited<ReturnType<typeof getPlacement>>;
  try {
    existing = await getPlacement(db, placementId);
    if (!existing) {
      return errorResponse('Placement not found', 404);
    }
    if (existing.orgId !== claims.org_id) {
      return errorResponse('Placement not found', 404);
    }
  } catch (err: unknown) {
    console.error('[placements] update get error:', err);
    return errorResponse('Failed to update placement', 500);
  }

  // Validate numeric fields
  const errors: Record<string, string> = {};
  if (body.compensation_base !== undefined && isNaN(Number(body.compensation_base))) {
    errors['compensation_base'] = 'compensation_base must be a numeric string';
  }
  if (body.fee_amount !== undefined && isNaN(Number(body.fee_amount))) {
    errors['fee_amount'] = 'fee_amount must be a numeric string';
  }
  if (body.fee_pct !== undefined && isNaN(Number(body.fee_pct))) {
    errors['fee_pct'] = 'fee_pct must be a numeric string';
  }
  if (Object.keys(errors).length > 0) {
    return errorResponse('Validation failed', 422, errors);
  }

  // Resolve fee_amount from fee_pct if only fee_pct is given
  let feeAmount: string | undefined = body.fee_amount;
  if (!feeAmount && body.fee_pct) {
    const base = Number(body.compensation_base ?? '0');
    const pct = Number(body.fee_pct);
    feeAmount = String(Math.round((base * pct) / 100));
  }

  // Determine if is_confidential is changing (for audit log)
  const confidentialChanging =
    'is_confidential' in body && body.is_confidential !== existing.isConfidential;

  // Recompute guarantee_expiry_date when start_date or guarantee_days changes.
  // Use the incoming values if present, otherwise fall back to the existing record.
  const newStartDate = 'start_date' in body ? (body.start_date ?? null) : existing.startDate;
  const newGuaranteeDays =
    'guarantee_days' in body ? (body.guarantee_days ?? null) : existing.guaranteeDays;
  const newGuaranteeExpiryDate =
    'start_date' in body || 'guarantee_days' in body
      ? computeGuaranteeExpiryDate(newStartDate, newGuaranteeDays)
      : undefined; // no change

  try {
    const updated = await updatePlacement(db, placementId, {
      candidateId: body.candidate_id,
      clientEntityId: body.client_entity_id,
      jobTitle: body.job_title,
      compensationBase: body.compensation_base,
      feeAmount,
      startDate: 'start_date' in body ? body.start_date : undefined,
      guaranteeDays: 'guarantee_days' in body ? body.guarantee_days : undefined,
      guaranteeExpiryDate: newGuaranteeExpiryDate,
      isConfidential: 'is_confidential' in body ? body.is_confidential : undefined,
    });

    if (!updated) {
      return errorResponse('Placement not found', 404);
    }

    // Write AuditLogEntry when is_confidential flag changes
    if (confidentialChanging) {
      await writePlacementConfidentialAuditLog(adb, {
        orgId: claims.org_id,
        actorId: claims.user_id,
        placementId,
        before: existing.isConfidential,
        after: updated.isConfidential,
      });
    }

    return jsonResponse({
      id: updated.id,
      org_id: updated.orgId,
      candidate_id: updated.candidateId,
      client_entity_id: updated.clientEntityId,
      job_title: updated.jobTitle,
      compensation_base: updated.compensationBase,
      fee_amount: updated.feeAmount,
      status: updated.status,
      start_date: formatDate(updated.startDate),
      guarantee_days: updated.guaranteeDays,
      guarantee_expiry_date: updated.guaranteeExpiryDate,
      is_confidential: updated.isConfidential,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt,
    });
  } catch (err: unknown) {
    console.error('[placements] update error:', err);
    return errorResponse('Failed to update placement', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /partner/placements/:id — External Partner view (masked if confidential)
// ---------------------------------------------------------------------------

/**
 * GET /partner/placements/:id — returns a single placement for an External Partner.
 *
 * When is_confidential=true the position_title and client_entity_id are masked.
 * Finance Admins and Managers always see unmasked data (enforced via shouldMask).
 *
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleGetPartnerPlacement(
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

    // Tenant isolation
    if (placement.orgId !== claims.org_id) {
      return errorResponse('Placement not found', 404);
    }

    const masked = shouldMask(claims, placement.isConfidential);

    return jsonResponse({
      id: placement.id,
      org_id: placement.orgId,
      candidate_id: placement.candidateId,
      client_entity_id: masked ? null : placement.clientEntityId,
      job_title: masked ? 'Confidential' : placement.jobTitle,
      compensation_base: placement.compensationBase,
      fee_amount: placement.feeAmount,
      status: placement.status,
      start_date: formatDate(placement.startDate),
      guarantee_days: placement.guaranteeDays,
      guarantee_expiry_date: placement.guaranteeExpiryDate,
      is_confidential: placement.isConfidential,
      created_at: placement.createdAt,
      updated_at: placement.updatedAt,
    });
  } catch (err: unknown) {
    console.error('[partner/placements] get error:', err);
    return errorResponse('Failed to get placement', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /partner/placements — External Partner scoped deal-list (masked if confidential)
// ---------------------------------------------------------------------------

/**
 * GET /partner/placements — returns the list of placements where the authenticated
 * External Partner holds at least one split/contributor agreement.
 *
 * Each entry carries only the need-to-know fields (amount owed, payment trigger,
 * payment status) with the same masking rules as GET /partner/placements/:id:
 *   - position_title and client_entity_id masked to "Confidential" / null when
 *     is_confidential=true and the caller is not FinanceAdmin/Manager.
 *   - Other contributors' credit, internal margin, and draw fields are absent.
 *
 * Role gating: only ExternalPartner (and FinanceAdmin for admin queries) may call
 * this endpoint. Other roles receive 403.
 *
 * Tenant isolation: only placements belonging to the session org are returned.
 *
 * Issue: feat: external partner scoped deal-list endpoint (#125)
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleListPartnerPlacements(
  _req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  // Role gating: ExternalPartner and FinanceAdmin only
  if (claims.role !== 'ExternalPartner' && claims.role !== 'FinanceAdmin') {
    return errorResponse('Forbidden', 403);
  }

  const db = sqlClient ?? defaultSql;

  try {
    const placements = await listPlacementsForPartner(db, claims.org_id, claims.user_id);

    return jsonResponse(
      placements.map((p) => {
        const masked = shouldMask(claims, p.isConfidential);
        return {
          id: p.id,
          org_id: p.orgId,
          candidate_id: p.candidateId,
          client_entity_id: masked ? null : p.clientEntityId,
          job_title: masked ? 'Confidential' : p.jobTitle,
          compensation_base: p.compensationBase,
          fee_amount: p.feeAmount,
          status: p.status,
          start_date: formatDate(p.startDate),
          guarantee_days: p.guaranteeDays,
          guarantee_expiry_date: p.guaranteeExpiryDate,
          is_confidential: p.isConfidential,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
        };
      }),
    );
  } catch (err: unknown) {
    console.error('[partner/placements] list error:', err);
    return errorResponse('Failed to list partner placements', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /commission-runs — pre-flight completeness check
// ---------------------------------------------------------------------------

export interface CommissionRunBody {
  placement_ids: string[];
}

/**
 * POST /commission-runs — pre-flight check for a commission run.
 *
 * Validates that all placements listed in `placement_ids` are commission-eligible
 * (no missing required fields). Returns 422 with the incomplete placement IDs if
 * any placement is incomplete.
 *
 * Returns 200 when all placements are complete (the run is allowed to proceed).
 *
 * Canonical docs: docs/prd.md §9 Data Completeness Gating
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handlePreflightCommissionRun(
  req: Request,
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  let body: Partial<CommissionRunBody>;
  try {
    body = (await req.json()) as Partial<CommissionRunBody>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.placement_ids || !Array.isArray(body.placement_ids)) {
    return errorResponse('placement_ids must be a non-empty array', 422);
  }

  if (body.placement_ids.length === 0) {
    return errorResponse('placement_ids must be a non-empty array', 422);
  }

  const db = sqlClient ?? defaultSql;

  try {
    const incompleteMap = await checkPlacementsComplete(db, claims.org_id, body.placement_ids);

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

    return jsonResponse({ status: 'preflight_passed', placement_ids: body.placement_ids });
  } catch (err: unknown) {
    console.error('[commission-runs] preflight error:', err);
    return errorResponse('Failed to validate commission run', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /placements/:id/guarantee — guarantee state and expiry for a placement
// ---------------------------------------------------------------------------

/**
 * GET /placements/:id/guarantee — returns the current guarantee state and
 * expiry date for a placement.
 *
 * Response body:
 *   {
 *     placement_id: string,
 *     guarantee_expiry_date: string | null,   // from placements.guarantee_expiry_date
 *     guarantee_state: GuaranteeState | null, // from guarantee_periods.status
 *     guarantee_period_id: string | null      // guarantee_periods.id
 *   }
 *
 * Returns 404 if the placement does not exist or belongs to a different tenant.
 *
 * Issue: feat: guarantee period tracking and monitoring (#19)
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function handleGetPlacementGuarantee(
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

    if (placement.orgId !== claims.org_id) {
      return errorResponse('Placement not found', 404);
    }

    const period = await getGuaranteePeriodForPlacement(db, claims.org_id, placementId);

    return jsonResponse({
      placement_id: placement.id,
      guarantee_expiry_date: placement.guaranteeExpiryDate,
      guarantee_state: period ? period.status : null,
      guarantee_period_id: period ? period.id : null,
    });
  } catch (err: unknown) {
    console.error('[placements] get guarantee error:', err);
    return errorResponse('Failed to get guarantee status', 500);
  }
}

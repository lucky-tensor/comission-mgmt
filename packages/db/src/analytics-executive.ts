/**
 * DB access functions for the executive analytics endpoint.
 *
 * Aggregates commission, placement, exception, dispute, and clawback data
 * for the GET /analytics/executive dashboard.
 *
 * Aggregation strategy: on-the-fly (see
 *   docs/architecture/phase-leadership-visibility.md — Aggregation Strategy).
 *
 * Sensitive fields (fee_amount, gross_amount, net_payable) are stored as
 * encrypted BYTEA and cannot be aggregated in SQL. These are fetched as
 * individual rows and summed in application code after decryption.
 *
 * Non-sensitive aggregate fields (clawback exposure, exception/dispute counts)
 * are aggregated directly in SQL.
 *
 * Canonical docs: docs/prd.md §4 (Executive user stories), issue #22
 * Issue: feat: executive margin and commission liability dashboard (#22)
 */

import type { Sql } from 'postgres';
import { FieldEncryptor } from './encryption.js';
import { createKmsAdapter } from './kms.js';

// ---------------------------------------------------------------------------
// Encryptor singleton (lazy-initialised)
// ---------------------------------------------------------------------------

let _encryptor: FieldEncryptor | null = null;

async function getEncryptor(): Promise<FieldEncryptor> {
  if (_encryptor) return _encryptor;
  const adapter = await createKmsAdapter();
  _encryptor = new FieldEncryptor(adapter);
  return _encryptor;
}

/** Replace the encryptor singleton. Used in tests to inject a test adapter. */
export function _setEncryptorForTest(enc: FieldEncryptor): void {
  _encryptor = enc;
}

/** Reset the encryptor singleton. Used in tests for isolation. */
export function _resetEncryptorForTest(): void {
  _encryptor = null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfitabilityByClient {
  clientId: string;
  /**
   * Human-readable client display name. The data model has no clients table yet
   * (client_entity_id is an opaque surrogate UUID — see the ATS-integration TODO
   * in apps/server/src/api/placements.ts), so until that lands this is a stable
   * label derived deterministically from the id via `clientDisplayName`. The
   * executive profitability table shows this instead of the raw UUID (#203).
   */
  clientName: string;
  /** Sum of placement fee_amount for this client in the period */
  grossFees: string;
  /** Sum of net_payable on commission records for placements in this client in the period */
  commissionBurden: string;
}

export interface ProfitabilityByProducer {
  producerId: string;
  /** Sum of gross_amount on commission records for this producer in the period */
  grossCommission: string;
  /** Sum of net_payable on commission records for this producer in the period */
  netPayable: string;
}

export interface ExecutiveAnalytics {
  period: { start: string; end: string };
  /** Sum of all Placement.fee_amount for the period */
  gross_fees_booked: string;
  /** Sum of net_payable for all non-ClawbackInitiated, non-Recovered commission records in period */
  net_fee_income: string;
  /** Sum of net_payable where status IN (Accrued, PendingApproval) */
  commission_accrued: string;
  /** Sum of net_payable where status = Payable */
  commission_payable: string;
  /** Sum of net_payable where status = Held */
  commission_held: string;
  /** Sum of all negative commission_record_adjustments.amount_delta where recovered = false */
  clawback_exposure: string;
  /** Sum of fee_amount on placements currently in GuaranteeActive status */
  guarantee_exposure: string;
  /** Sum of net_payable on commission_records linked to open (non-Resolved) disputes in period */
  disputed_commission: string;
  /** (placements with at least one Approved exception) / total placements in period */
  exception_rate: number;
  /** disputes initiated / total placements in period */
  dispute_rate: number;
  total_placements: number;
  profitability_by_client: ProfitabilityByClient[];
  profitability_by_producer: ProfitabilityByProducer[];
}

// ---------------------------------------------------------------------------
// Client display names
// ---------------------------------------------------------------------------

/**
 * Stable, human-readable label for a client entity id.
 *
 * The data model has no clients table yet — `client_entity_id` is an opaque
 * surrogate UUID minted at placement-create time (see the ATS-integration TODO
 * in apps/server/src/api/placements.ts). Until a real client directory exists,
 * the executive profitability surface still must not show raw UUIDs (#203), so
 * we derive a deterministic readable name from the id: a fixed adjective+noun
 * pair selected by hashing the id, plus a short id suffix to keep it unique.
 *
 * Deterministic: the same id always yields the same name. Never empty.
 */
const CLIENT_NAME_PREFIXES = [
  'Summit',
  'Atlas',
  'Beacon',
  'Cardinal',
  'Pioneer',
  'Meridian',
  'Vertex',
  'Harbor',
  'Keystone',
  'Northwind',
  'Granite',
  'Sterling',
  'Evergreen',
  'Lighthouse',
  'Ironwood',
  'Brightline',
];
const CLIENT_NAME_SUFFIXES = [
  'Partners',
  'Group',
  'Holdings',
  'Industries',
  'Labs',
  'Systems',
  'Ventures',
  'Solutions',
];

export function clientDisplayName(clientId: string): string {
  if (!clientId) return 'Unknown Client';
  // Simple deterministic hash over the id characters (FNV-1a style).
  let h = 0x811c9dc5;
  for (let i = 0; i < clientId.length; i++) {
    h ^= clientId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const prefix = CLIENT_NAME_PREFIXES[h % CLIENT_NAME_PREFIXES.length];
  const suffix = CLIENT_NAME_SUFFIXES[(h >>> 8) % CLIENT_NAME_SUFFIXES.length];
  // A short slug from the id keeps two clients that hash alike distinguishable.
  const slug = clientId
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 4)
    .toUpperCase();
  return `${prefix} ${suffix} (${slug})`;
}

// ---------------------------------------------------------------------------
// Internal raw row types
// ---------------------------------------------------------------------------

interface RawPlacementFeeRow {
  id: string;
  client_entity_id: string;
  fee_amount: Buffer | Uint8Array;
  status: string;
}

interface RawCommissionRecordRow {
  id: string;
  placement_id: string;
  contributor_id: string;
  status: string;
  gross_amount: Buffer | Uint8Array;
  net_payable: Buffer | Uint8Array;
}

interface RawContributorRow {
  id: string;
  producer_id: string;
}

// ---------------------------------------------------------------------------
// getExecutiveAnalytics — main aggregation function
// ---------------------------------------------------------------------------

/**
 * Aggregates all executive dashboard metrics for the given org and period.
 *
 * period_start and period_end are ISO date strings (YYYY-MM-DD).
 * They filter placements by start_date and commission_records by created_at.
 */
export async function getExecutiveAnalytics(
  sql: Sql,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ExecutiveAnalytics> {
  const enc = await getEncryptor();

  // -------------------------------------------------------------------------
  // 1. Fetch placements in the period (filter by start_date)
  // -------------------------------------------------------------------------

  const placementRows = (await sql.unsafe(
    `
    SELECT id, client_entity_id, fee_amount, status
    FROM placements
    WHERE org_id = $1
      AND start_date >= $2
      AND start_date <= $3
    ORDER BY created_at ASC
    `,
    [orgId, periodStart, periodEnd],
  )) as unknown as RawPlacementFeeRow[];

  const totalPlacements = placementRows.length;

  // Decrypt fee_amount for each placement, grouping by client_entity_id
  let grossFeesBooked = 0;
  let guaranteeExposure = 0;
  const feeByClient = new Map<string, number>();

  for (const row of placementRows) {
    const feeStr = await enc.decrypt(
      'placements',
      'fee_amount',
      Buffer.isBuffer(row.fee_amount) ? row.fee_amount : Buffer.from(row.fee_amount),
    );
    const fee = parseFloat(feeStr) || 0;

    grossFeesBooked += fee;

    if (row.status === 'GuaranteeActive') {
      guaranteeExposure += fee;
    }

    const prev = feeByClient.get(row.client_entity_id) ?? 0;
    feeByClient.set(row.client_entity_id, prev + fee);
  }

  // Collect placement IDs for scoping commission record queries
  const placementIds = placementRows.map((r) => r.id);

  // -------------------------------------------------------------------------
  // 2. Fetch commission records for placements in the period
  // -------------------------------------------------------------------------

  let commissionRows: RawCommissionRecordRow[] = [];

  if (placementIds.length > 0) {
    const placeholders = placementIds.map((_, i) => `$${i + 2}`).join(', ');
    commissionRows = (await sql.unsafe(
      `
      SELECT id, placement_id, contributor_id, status, gross_amount, net_payable
      FROM commission_records
      WHERE org_id = $1
        AND placement_id IN (${placeholders})
      ORDER BY created_at ASC
      `,
      [orgId, ...placementIds],
    )) as unknown as RawCommissionRecordRow[];
  }

  // Decrypt and aggregate commission record amounts
  let netFeeIncome = 0;
  let commissionAccrued = 0;
  let commissionPayable = 0;
  let commissionHeld = 0;

  // contributor_id → { grossCommission, netPayable }
  const commissionByContributor = new Map<string, { gross: number; net: number }>();
  // placement_id → sum of net_payable (for commission burden by client)
  const commissionBurdenByPlacement = new Map<string, number>();

  const EXCLUDED_STATUSES = new Set(['ClawbackInitiated', 'Recovered']);

  for (const row of commissionRows) {
    const grossStr = await enc.decrypt(
      'commission_records',
      'gross_amount',
      Buffer.isBuffer(row.gross_amount) ? row.gross_amount : Buffer.from(row.gross_amount),
    );
    const netStr = await enc.decrypt(
      'commission_records',
      'net_payable',
      Buffer.isBuffer(row.net_payable) ? row.net_payable : Buffer.from(row.net_payable),
    );
    const gross = parseFloat(grossStr) || 0;
    const net = parseFloat(netStr) || 0;

    if (!EXCLUDED_STATUSES.has(row.status)) {
      netFeeIncome += net;
    }

    if (row.status === 'Accrued' || row.status === 'PendingApproval') {
      commissionAccrued += net;
    } else if (row.status === 'Payable') {
      commissionPayable += net;
    } else if (row.status === 'Held') {
      commissionHeld += net;
    }

    // Accumulate by contributor for producer profitability
    const existing = commissionByContributor.get(row.contributor_id) ?? { gross: 0, net: 0 };
    commissionByContributor.set(row.contributor_id, {
      gross: existing.gross + gross,
      net: existing.net + net,
    });

    // Accumulate net payable by placement for client commission burden
    const prevBurden = commissionBurdenByPlacement.get(row.placement_id) ?? 0;
    commissionBurdenByPlacement.set(row.placement_id, prevBurden + net);
  }

  // -------------------------------------------------------------------------
  // 3. Clawback exposure — SUM of negative unrecovered adjustments (plain NUMERIC)
  // -------------------------------------------------------------------------

  const clawbackRows = (await sql.unsafe(
    `
    SELECT COALESCE(SUM(cra.amount_delta), 0)::text AS total_exposure
    FROM commission_record_adjustments cra
    JOIN commission_records cr ON cr.id = cra.commission_record_id
    WHERE cr.org_id = $1
      AND cra.amount_delta < 0
      AND cra.recovered = false
    `,
    [orgId],
  )) as unknown as { total_exposure: string }[];

  const clawbackExposure =
    clawbackRows.length > 0 ? parseFloat(clawbackRows[0].total_exposure) || 0 : 0;

  // -------------------------------------------------------------------------
  // 4. Disputed commission — net_payable on records linked to open disputes
  // -------------------------------------------------------------------------

  let disputedCommission = 0;

  if (placementIds.length > 0) {
    const placeholders = placementIds.map((_, i) => `$${i + 2}`).join(', ');
    const disputedRows = (await sql.unsafe(
      `
      SELECT cr.net_payable
      FROM commission_records cr
      JOIN disputes d ON d.commission_record_id = cr.id
      WHERE cr.org_id = $1
        AND cr.placement_id IN (${placeholders})
        AND d.state != 'Resolved'
      `,
      [orgId, ...placementIds],
    )) as unknown as { net_payable: Buffer | Uint8Array }[];

    for (const row of disputedRows) {
      const netStr = await enc.decrypt(
        'commission_records',
        'net_payable',
        Buffer.isBuffer(row.net_payable) ? row.net_payable : Buffer.from(row.net_payable),
      );
      disputedCommission += parseFloat(netStr) || 0;
    }
  }

  // -------------------------------------------------------------------------
  // 5. Exception rate — placements with >= 1 Approved exception / total placements
  // -------------------------------------------------------------------------

  let exceptionRate = 0;

  if (placementIds.length > 0) {
    const placeholders = placementIds.map((_, i) => `$${i + 2}`).join(', ');
    const exceptionRows = (await sql.unsafe(
      `
      SELECT COUNT(DISTINCT placement_id)::int AS placement_count
      FROM exceptions
      WHERE org_id = $1
        AND placement_id IN (${placeholders})
        AND status = 'Approved'
      `,
      [orgId, ...placementIds],
    )) as unknown as { placement_count: number }[];

    const placementsWithExceptions =
      exceptionRows.length > 0 ? Number(exceptionRows[0].placement_count) || 0 : 0;
    exceptionRate = totalPlacements > 0 ? placementsWithExceptions / totalPlacements : 0;
  }

  // -------------------------------------------------------------------------
  // 6. Dispute rate — disputes initiated / total placements in period
  // -------------------------------------------------------------------------

  let disputeRate = 0;

  if (placementIds.length > 0) {
    const placeholders = placementIds.map((_, i) => `$${i + 2}`).join(', ');
    const disputeCountRows = (await sql.unsafe(
      `
      SELECT COUNT(DISTINCT d.id)::int AS dispute_count
      FROM disputes d
      JOIN commission_records cr ON cr.id = d.commission_record_id
      WHERE cr.org_id = $1
        AND cr.placement_id IN (${placeholders})
      `,
      [orgId, ...placementIds],
    )) as unknown as { dispute_count: number }[];

    const disputeCount =
      disputeCountRows.length > 0 ? Number(disputeCountRows[0].dispute_count) || 0 : 0;
    disputeRate = totalPlacements > 0 ? disputeCount / totalPlacements : 0;
  }

  // -------------------------------------------------------------------------
  // 7. Resolve contributor_id → producer_id for profitability_by_producer
  // -------------------------------------------------------------------------

  const contributorIds = [...commissionByContributor.keys()];
  const producerByContributorId = new Map<string, string>();

  if (contributorIds.length > 0) {
    const placeholders = contributorIds.map((_, i) => `$${i + 2}`).join(', ');
    const contributorRows = (await sql.unsafe(
      `
      SELECT id, producer_id
      FROM contributors
      WHERE org_id = $1 AND id IN (${placeholders})
      `,
      [orgId, ...contributorIds],
    )) as unknown as RawContributorRow[];

    for (const row of contributorRows) {
      producerByContributorId.set(row.id, row.producer_id);
    }
  }

  // Aggregate by producer_id (multiple contributors may share a producer)
  const commissionByProducer = new Map<string, { gross: number; net: number }>();
  for (const [contributorId, amounts] of commissionByContributor) {
    const producerId = producerByContributorId.get(contributorId);
    if (!producerId) continue;
    const existing = commissionByProducer.get(producerId) ?? { gross: 0, net: 0 };
    commissionByProducer.set(producerId, {
      gross: existing.gross + amounts.gross,
      net: existing.net + amounts.net,
    });
  }

  // -------------------------------------------------------------------------
  // 8. Build profitability_by_client
  // -------------------------------------------------------------------------

  const profitabilityByClient: ProfitabilityByClient[] = [];

  for (const [clientId, grossFees] of feeByClient) {
    // Sum commission burden for all placements belonging to this client
    let burden = 0;
    for (const row of placementRows) {
      if (row.client_entity_id === clientId) {
        burden += commissionBurdenByPlacement.get(row.id) ?? 0;
      }
    }
    profitabilityByClient.push({
      clientId,
      clientName: clientDisplayName(clientId),
      grossFees: grossFees.toFixed(2),
      commissionBurden: burden.toFixed(2),
    });
  }

  // Sort by grossFees descending for consistent ordering
  profitabilityByClient.sort((a, b) => parseFloat(b.grossFees) - parseFloat(a.grossFees));

  // -------------------------------------------------------------------------
  // 9. Build profitability_by_producer
  // -------------------------------------------------------------------------

  const profitabilityByProducer: ProfitabilityByProducer[] = [];
  for (const [producerId, amounts] of commissionByProducer) {
    profitabilityByProducer.push({
      producerId,
      grossCommission: amounts.gross.toFixed(2),
      netPayable: amounts.net.toFixed(2),
    });
  }

  // Sort by grossCommission descending
  profitabilityByProducer.sort(
    (a, b) => parseFloat(b.grossCommission) - parseFloat(a.grossCommission),
  );

  // -------------------------------------------------------------------------
  // 10. Return aggregated result
  // -------------------------------------------------------------------------

  return {
    period: { start: periodStart, end: periodEnd },
    gross_fees_booked: grossFeesBooked.toFixed(2),
    net_fee_income: netFeeIncome.toFixed(2),
    commission_accrued: commissionAccrued.toFixed(2),
    commission_payable: commissionPayable.toFixed(2),
    commission_held: commissionHeld.toFixed(2),
    clawback_exposure: clawbackExposure.toFixed(2),
    guarantee_exposure: guaranteeExposure.toFixed(2),
    disputed_commission: disputedCommission.toFixed(2),
    exception_rate: Math.round(exceptionRate * 10000) / 10000, // 4 decimal places
    dispute_rate: Math.round(disputeRate * 10000) / 10000,
    total_placements: totalPlacements,
    profitability_by_client: profitabilityByClient,
    profitability_by_producer: profitabilityByProducer,
  };
}

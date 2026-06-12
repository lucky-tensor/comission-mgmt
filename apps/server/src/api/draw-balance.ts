/**
 * Per-producer draw balance and recovery schedule read API.
 *
 * Routes:
 *   GET /producers/:id/draw-balance — HR or the producer themselves read draw balance + recovery.
 *
 * Behaviour:
 *   Returns the producer's current outstanding draw balance and their clawback-based
 *   recovery schedules, aggregated from engine draw state and per-placement clawback recovery.
 *   If the producer has no draw_balances row, returns zero balance and empty schedules (not 404).
 *
 * RBAC:
 *   - HR operators may read any producer's draw balance (tenant-scoped).
 *   - A Producer may read only their own draw balance (producerId must equal claims.user_id).
 *   - All other roles receive 403.
 *
 * Multi-tenant isolation: all queries scoped to claims.org_id.
 * Audit-before-read: sensitiveRead enforced (DATA-D-010).
 *
 * Canonical docs: docs/prd.md §4 (HR / People Ops), §6 (Draw Balance)
 * Issue: feat: per-producer draw balance and recovery schedule read API (#124)
 */

import type { Sql } from 'postgres';
import { sql as defaultSql, auditSql as defaultAuditSql } from 'db/index';
import {
  getDrawBalanceForProducer,
  listRecoverySchedulesForProducer,
  listProducers,
} from 'db/draw-balance';
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

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ---------------------------------------------------------------------------
// GET /producers — list producers for the HR draw-balance picker (#203)
// ---------------------------------------------------------------------------

/**
 * GET /producers — lists the org's producers (id + display name) so the HR
 * draw-balance surface can offer a name-based picker instead of a UUID input.
 *
 * RBAC: HR and Finance Admin. Results are scoped to the session org.
 */
export async function handleListProducers(
  claims: SessionClaims,
  sqlClient?: SqlClient,
): Promise<Response> {
  if (claims.role !== 'HR' && claims.role !== 'FinanceAdmin') {
    return errorResponse('Forbidden: HR or Finance Admin role required', 403);
  }

  const db = sqlClient ?? defaultSql;
  try {
    const producers = await listProducers(db, claims.org_id);
    return jsonResponse({ producers });
  } catch (err) {
    console.error('[draw-balance] list producers error:', err);
    return errorResponse('Failed to list producers', 500);
  }
}

// ---------------------------------------------------------------------------
// GET /producers/:id/draw-balance
// ---------------------------------------------------------------------------

/**
 * GET /producers/:id/draw-balance
 *
 * Returns the producer's outstanding draw balance and their per-placement
 * clawback recovery schedules.
 *
 * Response shape (200):
 * ```json
 * {
 *   "producer_id": "<uuid>",
 *   "draw_balance": {
 *     "id": "<uuid>|null",
 *     "status": "Active|PartiallyRecovered|FullyRecovered|Forgiven|null",
 *     "outstanding_balance": "<decimal string>",
 *     "draw_limit": "<decimal string>",
 *     "recovery_start": "<date>|null",
 *     "recovery_end": "<date>|null",
 *     "updated_at": "<iso8601>|null"
 *   },
 *   "recovery_schedules": [...]
 * }
 * ```
 *
 * Returns 403 if:
 *   - Role is not HR and not Producer.
 *   - Role is Producer but producerId != claims.user_id.
 *
 * @param producerId     - Producer UUID from path.
 * @param claims         - Session claims.
 * @param sqlClient      - Optional injectable SQL client.
 * @param auditSqlClient - Optional injectable audit SQL client.
 */
export async function handleGetProducerDrawBalance(
  producerId: string,
  claims: SessionClaims,
  sqlClient?: SqlClient,
  auditSqlClient?: SqlClient,
): Promise<Response> {
  // RBAC: HR may read any producer; Producer may only read their own.
  if (claims.role === 'Producer') {
    if (claims.user_id !== producerId) {
      return errorResponse('Forbidden: you may only read your own draw balance', 403);
    }
  } else if (claims.role !== 'HR') {
    return errorResponse('Forbidden: HR or Producer role required', 403);
  }

  const db = sqlClient ?? defaultSql;
  const adb = auditSqlClient ?? defaultAuditSql;

  try {
    const { drawBalance, schedules } = await sensitiveRead(
      adb,
      {
        orgId: claims.org_id,
        actorId: claims.user_id,
        action: 'draw_balance.read',
        entityType: 'draw_balance',
        entityId: producerId,
      },
      async () => {
        const drawBalance = await getDrawBalanceForProducer(db, claims.org_id, producerId);
        const schedules = await listRecoverySchedulesForProducer(db, claims.org_id, producerId);
        return { drawBalance, schedules };
      },
    );

    return jsonResponse({
      producer_id: producerId,
      draw_balance: drawBalance
        ? {
            id: drawBalance.id,
            status: drawBalance.status,
            outstanding_balance: drawBalance.outstandingBalance,
            draw_limit: drawBalance.drawLimit,
            recovery_start: drawBalance.recoveryStart,
            recovery_end: drawBalance.recoveryEnd,
            updated_at: drawBalance.updatedAt,
          }
        : {
            id: null,
            status: null,
            outstanding_balance: '0',
            draw_limit: '0',
            recovery_start: null,
            recovery_end: null,
            updated_at: null,
          },
      recovery_schedules: schedules.map((s) => ({
        id: s.id,
        clawback_event_id: s.clawbackEventId,
        commission_record_id: s.commissionRecordId,
        placement_id: s.placementId,
        clawback_amount: s.clawbackAmount,
        installment_count: s.installmentCount,
        installment_amount: s.installmentAmount,
        created_at: s.createdAt,
      })),
    });
  } catch (err: unknown) {
    console.error('[draw-balance] get error:', err);
    return errorResponse('Failed to retrieve draw balance', 500);
  }
}

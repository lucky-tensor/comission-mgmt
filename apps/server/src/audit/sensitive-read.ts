/**
 * Audit-before-read ordering for sensitive reads.
 *
 * The Superfield DATA blueprint requires that consequential reads of sensitive
 * financial/PII data write an immutable audit row *before* the data is returned,
 * and that a failure to record that audit row DENIES the read — the caller must
 * never receive data that was not provably logged (DATA-D-010, DATA-P-008,
 * IMPL-DATA-021).
 *
 * `sensitiveRead` enforces that ordering: it INSERTs into `audit_log_entries`
 * first, and only if that INSERT succeeds does it execute the supplied read
 * function. If the audit write throws (audit DB unreachable, INSERT rejected,
 * etc.) the error propagates and the read body is never run — the read is
 * denied.
 *
 * The audit INSERT uses bound `$n` parameters only (no raw interpolation), so it
 * is compatible with the SQL-injection grep-gate (DATA-C-005).
 *
 * Canonical docs: docs/architecture.md — Audit Write Policy (audit-log-before-read).
 */

import type { Sql } from 'postgres';

type SqlClient = Sql;

/**
 * Context describing the sensitive read being recorded. Mirrors the columns of
 * `audit_log_entries`. `before_json`/`after_json` are intentionally null for
 * reads — a read has no state transition; the row records *that* a read of a
 * given entity occurred, by whom, and when.
 */
export interface SensitiveReadAudit {
  /** Tenant the read is scoped to. */
  orgId: string;
  /** Authenticated principal performing the read. */
  actorId: string;
  /** Principal kind — 'User' for session-bound reads, 'Worker' for delegated. */
  actorType?: string;
  /** Audit action verb, e.g. 'placement.read', 'invoice.read'. */
  action: string;
  /** Entity class being read, e.g. 'placement', 'invoice', 'commission_record'. */
  entityType: string;
  /**
   * Identifier of the entity (or scope) being read. For collection/report reads
   * with no single id, pass a stable scope token (e.g. the org id or a period
   * key) so the access is still attributable.
   */
  entityId: string;
}

/**
 * Write the audit row, then run `read`. The audit write must succeed first; if
 * it throws, `read` is never invoked and the error propagates so the caller can
 * deny the request. Returns whatever `read` returns.
 *
 * @param auditSql Audit-DB SQL client (INSERT-only `audit_w` pool in prod).
 * @param audit    Description of the read being recorded.
 * @param read     The actual data-fetch to perform once the audit row lands.
 */
export async function sensitiveRead<T>(
  auditSql: SqlClient,
  audit: SensitiveReadAudit,
  read: () => Promise<T>,
): Promise<T> {
  // Audit-before-read: this INSERT runs first. A failure here throws and the
  // read body below never executes — the read is denied.
  await auditSql.unsafe(
    `
    INSERT INTO audit_log_entries (
      org_id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json
    ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
    `,
    [
      audit.orgId,
      audit.actorId,
      audit.actorType ?? 'User',
      audit.action,
      audit.entityType,
      audit.entityId,
    ],
  );

  return read();
}

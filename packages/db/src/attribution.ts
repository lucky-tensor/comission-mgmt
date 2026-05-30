/**
 * DB access functions for the attribution_events table.
 *
 * Handles recording and querying attribution lifecycle events for the
 * manager split-approval workflow (submit, approve, reject).
 *
 * Canonical docs: docs/prd.md §5.2
 * Issue: feat: manager split approval workflow and attribution timeline (#8)
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttributionEventType = 'Submitted' | 'Approved' | 'Rejected';

export interface CreateAttributionEventInput {
  orgId: string;
  placementId: string;
  eventType: AttributionEventType;
  actorId: string;
  reason?: string | null;
}

export interface AttributionEvent {
  id: string;
  orgId: string;
  placementId: string;
  eventType: AttributionEventType;
  actorId: string;
  reason: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// createAttributionEvent — INSERT a new event row
// ---------------------------------------------------------------------------

/**
 * Inserts a new attribution event row for a placement.
 *
 * @returns The newly created attribution event.
 */
export async function createAttributionEvent(
  sql: Sql,
  input: CreateAttributionEventInput,
): Promise<AttributionEvent> {
  const rows = await sql.unsafe(
    `
    INSERT INTO attribution_events (
      org_id, placement_id, event_type, actor_id, reason
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id, org_id, placement_id, event_type, actor_id, reason, created_at
    `,
    [input.orgId, input.placementId, input.eventType, input.actorId, input.reason ?? null],
  );

  return mapEventRow(rows[0] as unknown as AttributionEventRawRow);
}

// ---------------------------------------------------------------------------
// listAttributionEvents — SELECT all events for a placement in chronological order
// ---------------------------------------------------------------------------

/**
 * Lists all attribution events for a given placement, ordered by created_at ascending
 * (oldest first — true timeline order).
 *
 * @returns Array of attribution event records (may be empty).
 */
export async function listAttributionEvents(
  sql: Sql,
  orgId: string,
  placementId: string,
): Promise<AttributionEvent[]> {
  const rows = await sql.unsafe(
    `
    SELECT id, org_id, placement_id, event_type, actor_id, reason, created_at
    FROM attribution_events
    WHERE org_id = $1 AND placement_id = $2
    ORDER BY created_at ASC
    `,
    [orgId, placementId],
  );

  if (!rows || rows.length === 0) return [];
  return (rows as unknown as AttributionEventRawRow[]).map(mapEventRow);
}

// ---------------------------------------------------------------------------
// Internal row type and mapper
// ---------------------------------------------------------------------------

interface AttributionEventRawRow {
  id: string;
  org_id: string;
  placement_id: string;
  event_type: string;
  actor_id: string;
  reason: string | null;
  created_at: Date;
}

function mapEventRow(row: AttributionEventRawRow): AttributionEvent {
  return {
    id: row.id,
    orgId: row.org_id,
    placementId: row.placement_id,
    eventType: row.event_type as AttributionEventType,
    actorId: row.actor_id,
    reason: row.reason ?? null,
    createdAt: row.created_at,
  };
}

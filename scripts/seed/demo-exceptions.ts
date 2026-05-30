/**
 * Demo seed step 9 — Exceptions.
 *
 * Creates 2 exceptions:
 *   - Approved (custom split override)
 *   - Requested (fee discount, pending review)
 *
 * All entities carry deterministic UUIDs (ON CONFLICT DO NOTHING).
 */

import type { Sql } from 'postgres';
import { DEMO_ORG_ID, DEMO_USERS } from './demo-users.js';
import { DEMO_PLACEMENTS } from './demo-placements.js';

// ---------------------------------------------------------------------------
// Deterministic exception IDs
// ---------------------------------------------------------------------------

export const DEMO_EXCEPTIONS = {
  approved: { id: 'dd090000-0000-0000-0000-000000000001' },
  requested: { id: 'dd090000-0000-0000-0000-000000000002' },
} as const;

export async function seedDemoExceptions(sql: Sql): Promise<void> {
  // Exception 1: Approved — custom split override on collected placement
  await sql.unsafe(`
    INSERT INTO exceptions (
      id, org_id, placement_id, requested_by, exception_type, justification,
      status, reviewed_by, reviewed_at
    ) VALUES (
      '${DEMO_EXCEPTIONS.approved.id}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLACEMENTS.collected.id}',
      '${DEMO_USERS.producer.id}',
      'split_override',
      'External partner introduced client relationship; increased partner split from 15% to 20% approved by manager.',
      'Approved',
      '${DEMO_USERS.manager.id}',
      '2025-11-20T00:00:00Z'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Exception 2: Requested — fee discount pending review
  await sql.unsafe(`
    INSERT INTO exceptions (
      id, org_id, placement_id, requested_by, exception_type, justification,
      status
    ) VALUES (
      '${DEMO_EXCEPTIONS.requested.id}',
      '${DEMO_ORG_ID}',
      '${DEMO_PLACEMENTS.invoiced.id}',
      '${DEMO_USERS.producer.id}',
      'fee_discount',
      'Client requested 5% discount on gross fee due to multi-hire commitment. Requesting exception approval before invoice finalisation.',
      'Requested'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  console.log(
    '[demo-seed] Step 9: demo exceptions seeded (1 Approved, 1 Requested).',
  );
}

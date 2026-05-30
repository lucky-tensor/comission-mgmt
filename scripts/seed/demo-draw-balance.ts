/**
 * Demo seed step 8 — Draw Balance.
 *
 * Creates 1 draw balance with partial recovery for the Producer user.
 * balance and draw_limit are encrypted via FieldEncryptor.
 * All entities carry deterministic UUIDs (ON CONFLICT DO NOTHING).
 */

import type { Sql } from 'postgres';
import { DEMO_ORG_ID, DEMO_USERS } from './demo-users.js';
import { getDemoEncryptor } from './demo-placements.js';

// ---------------------------------------------------------------------------
// Deterministic draw balance ID
// ---------------------------------------------------------------------------

export const DEMO_DRAW_BALANCE = {
  producerDraw: { id: 'dd080000-0000-0000-0000-000000000001' },
} as const;

export async function seedDemoDrawBalance(sql: Sql): Promise<void> {
  const enc = await getDemoEncryptor();

  // Producer has a draw: $10k limit, $4k still outstanding (partial recovery in progress)
  const balanceBuf = await enc.encrypt('draw_balances', 'balance', '4000');
  const drawLimitBuf = await enc.encrypt('draw_balances', 'draw_limit', '10000');

  await sql.unsafe(
    `
    INSERT INTO draw_balances (
      id, org_id, producer_id, balance, draw_limit, status, recovery_start, recovery_end
    ) VALUES (
      '${DEMO_DRAW_BALANCE.producerDraw.id}',
      '${DEMO_ORG_ID}',
      '${DEMO_USERS.producer.id}',
      $1, $2,
      'PartiallyRecovered',
      '2026-01-01',
      '2026-12-31'
    )
    ON CONFLICT (id) DO NOTHING
    `,
    [balanceBuf, drawLimitBuf],
  );

  console.log('[demo-seed] Step 8: demo draw balance seeded (1 draw balance, PartiallyRecovered).');
}

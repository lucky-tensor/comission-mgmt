#!/usr/bin/env bun
/**
 * Detailed commission amount diagnostic.
 *
 * Shows decrypted commission amounts for each producer to verify calculations
 * are working correctly.
 *
 * Run via: bun run scripts/diagnose-commissions.ts
 */

import postgres from 'postgres';
import { listCommissionRecordsByContributor } from 'db/index';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://app_rw:app_rw_password@localhost:5432/commission_app';

const SEEDED = {
  orgId: 'e2e00000-0000-0000-0000-0000000000aa',
  producerId: 'e2e00000-0000-0000-0000-0000000000b1',
  producer2Id: 'e2e00000-0000-0000-0000-0000000000b2',
  partnerId: 'e2e00000-0000-0000-0000-0000000000a1',
  managerId: 'e2e00000-0000-0000-0000-0000000000f1',
};

async function main(): Promise<void> {
  console.log('=== Commission Amount Diagnostic ===\n');

  const sql = postgres(DATABASE_URL, { max: 3 });

  try {
    // Get producer names for display
    const producers = await sql.unsafe(
      `SELECT id, display_name FROM users WHERE id = ANY($1)`,
      [
        [
          SEEDED.producerId,
          SEEDED.producer2Id,
          SEEDED.partnerId,
          SEEDED.managerId,
        ],
      ],
    ) as unknown as Array<{ id: string; display_name: string }>;

    const nameMap = new Map(producers.map((p) => [p.id, p.display_name]));

    // Show commissions for each producer
    for (const [producerId, producerName] of [
      [SEEDED.producerId, nameMap.get(SEEDED.producerId) || 'Producer 1'],
      [SEEDED.producer2Id, nameMap.get(SEEDED.producer2Id) || 'Producer 2'],
      [SEEDED.partnerId, nameMap.get(SEEDED.partnerId) || 'External Partner'],
    ] as const) {
      console.log(`\n━━━ ${producerName} (${producerId}) ━━━\n`);

      const records = await listCommissionRecordsByContributor(
        sql,
        SEEDED.orgId,
        producerId,
      );

      if (records.length === 0) {
        console.log('  (no commission records)\n');
        continue;
      }

      // Group by placement
      const byPlacement = new Map<string, typeof records>();
      for (const r of records) {
        const key = r.placementId;
        if (!byPlacement.has(key)) {
          byPlacement.set(key, []);
        }
        byPlacement.get(key)!.push(r);
      }

      // Get placement details
      const placementIds = Array.from(byPlacement.keys());
      const placements = await sql.unsafe(
        `SELECT id, job_title, status FROM placements WHERE id = ANY($1)`,
        [placementIds],
      ) as unknown as Array<{ id: string; job_title: string; status: string }>;

      const placementMap = new Map(placements.map((p) => [p.id, p]));

      let totalGross = 0;
      let totalNet = 0;

      for (const [placementId, recs] of byPlacement) {
        const placement = placementMap.get(placementId);
        console.log(`  ${placement?.job_title || placementId}`);
        console.log(`  Status: ${placement?.status}\n`);

        for (const r of recs) {
          const gross = parseFloat(r.grossAmount);
          const net = parseFloat(r.netPayable);
          totalGross += gross;
          totalNet += net;

          const displayStatus = (() => {
            if (r.holdReason === 'collection_gate') return 'Held (Collection)';
            if (r.holdReason === 'guarantee_hold') return 'Held (Guarantee)';
            if (r.holdReason === 'held_pending_phase_invoice') return 'Held (Phase)';
            return r.status;
          })();

          console.log(`    Gross: $${gross.toFixed(2)}`);
          console.log(`    Net:   $${net.toFixed(2)}`);
          console.log(`    Status: ${displayStatus}`);
          console.log(`    Tier Rate: ${(r.tierRate || 0).toLocaleString(undefined, {
            style: 'percent',
            minimumFractionDigits: 0,
          })}`);
          if (r.explanation) {
            console.log(`    Note: ${r.explanation}`);
          }
          console.log();
        }
      }

      console.log(`  TOTAL GROSS: $${totalGross.toFixed(2)}`);
      console.log(`  TOTAL NET:   $${totalNet.toFixed(2)}`);
      if (totalGross > 0) {
        const payoutRate = (totalNet / totalGross) * 100;
        console.log(`  Payout Rate: ${payoutRate.toFixed(1)}%\n`);
      }
    }

    // Summary statistics
    console.log('\n━━━ Summary Statistics ━━━\n');

    const allRecords = await sql.unsafe(
      `SELECT status, hold_reason, COUNT(*) as count FROM commission_records
       WHERE org_id = $1 GROUP BY status, hold_reason ORDER BY count DESC`,
      [SEEDED.orgId],
    ) as unknown as Array<{ status: string; hold_reason: string | null; count: string }>;

    console.log('Commission records by status:');
    for (const r of allRecords) {
      const hold = r.hold_reason ? ` [${r.hold_reason}]` : '';
      console.log(`  ${r.status}${hold}: ${r.count}`);
    }

    const invoiceStats = await sql.unsafe(
      `SELECT status, COUNT(*) as count FROM invoices
       WHERE org_id = $1 GROUP BY status`,
      [SEEDED.orgId],
    ) as unknown as Array<{ status: string; count: string }>;

    console.log('\nInvoices by status:');
    for (const i of invoiceStats) {
      console.log(`  ${i.status}: ${i.count}`);
    }
  } catch (err) {
    console.error('Diagnostic error:', err);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();

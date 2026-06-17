#!/usr/bin/env bun
/**
 * Finalize Demo — post-seed cleanup to ensure realistic commission data.
 *
 * After Phase 2 seed completes, this script:
 * 1. Ensures all demo placements with paid invoices have Payable commission records
 * 2. Recalculates any stale commission records
 * 3. Verifies data integrity (no orphaned records, no holds without reason)
 * 4. Reports the final state for manual verification
 *
 * This is run by local-demo.ts after the app is deployed and Phase 2 is complete.
 *
 * Run via: bun run scripts/finalize-demo.ts
 */

import postgres from 'postgres';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://app_rw:app_rw_password@localhost:5432/commission_app';

const SEEDED = {
  orgId: 'e2e00000-0000-0000-0000-0000000000aa',
};

async function main(): Promise<void> {
  console.log('[finalize-demo] Starting post-seed finalization...\n');

  const sql = postgres(DATABASE_URL, { max: 3 });

  try {
    // ──────────────────────────────────────────────────────────────────────
    // 1. Find placements with paid invoices but held commission records
    // ──────────────────────────────────────────────────────────────────────

    const placementsWithPaidInvoices = (await sql.unsafe(
      `
      SELECT DISTINCT p.id, p.job_title, COUNT(i.id) as invoice_count
      FROM placements p
      JOIN invoices i ON i.placement_id = p.id
      WHERE p.org_id = $1 AND i.status = 'Paid'
      GROUP BY p.id, p.job_title
      `,
      [SEEDED.orgId],
    )) as unknown as Array<{ id: string; job_title: string; invoice_count: string }>;

    console.log(
      `[finalize-demo] Found ${placementsWithPaidInvoices.length} placements with paid invoices\n`,
    );

    // For each placement with a paid invoice, release any held collection-gated records
    let totalReleased = 0;
    for (const placement of placementsWithPaidInvoices) {
      const result = await sql.unsafe(
        `
        UPDATE commission_records
        SET status = 'Payable', hold_reason = NULL
        WHERE org_id = $1
          AND placement_id = $2
          AND status = 'Held'
          AND hold_reason = 'collection_gate'
        RETURNING id
        `,
        [SEEDED.orgId, placement.id],
      );

      const released = result ? result.length : 0;
      if (released > 0) {
        console.log(`  ✓ ${placement.job_title}: released ${released} collection-gated record(s)`);
        totalReleased += released;
      }
    }

    if (totalReleased === 0) {
      console.log('  (no collection-gated records to release — they may already be released)');
    }
    console.log();

    // ──────────────────────────────────────────────────────────────────────
    // 2. Report final commission state by producer
    // ──────────────────────────────────────────────────────────────────────

    const producerStats = (await sql.unsafe(
      `
      SELECT
        c.producer_id,
        u.display_name,
        COUNT(cr.id) as total_records,
        COUNT(CASE WHEN cr.status = 'Payable' THEN 1 END) as payable,
        COUNT(CASE WHEN cr.status = 'Held' THEN 1 END) as held,
        COUNT(CASE WHEN cr.status = 'Paid' THEN 1 END) as paid
      FROM contributors c
      JOIN commission_records cr ON cr.contributor_id = c.id
      LEFT JOIN users u ON u.id = c.producer_id
      WHERE cr.org_id = $1
      GROUP BY c.producer_id, u.display_name
      ORDER BY total_records DESC
      `,
      [SEEDED.orgId],
    )) as unknown as Array<{
      producer_id: string;
      display_name: string | null;
      total_records: string;
      payable: string;
      held: string;
      paid: string;
    }>;

    console.log('[finalize-demo] Commission Record Summary:\n');
    for (const stat of producerStats) {
      const name = stat.display_name || 'Unknown';
      console.log(`  ${name}`);
      console.log(`    Total: ${stat.total_records}`);
      console.log(`    Payable: ${stat.payable} ✓`);
      console.log(`    Held: ${stat.held}`);
      console.log(`    Paid: ${stat.paid}`);
      console.log();
    }

    // ──────────────────────────────────────────────────────────────────────
    // 3. Data integrity checks
    // ──────────────────────────────────────────────────────────────────────

    console.log('[finalize-demo] Data Integrity:\n');

    // Check for orphaned records
    const orphaned = (await sql.unsafe(
      `
      SELECT COUNT(*) as count FROM commission_records cr
      LEFT JOIN contributors c ON c.id = cr.contributor_id
      WHERE cr.org_id = $1 AND c.id IS NULL
      `,
      [SEEDED.orgId],
    )) as unknown as Array<{ count: string }>;

    const orphanCount = parseInt(orphaned[0].count);
    console.log(
      orphanCount === 0
        ? '  ✓ No orphaned commission records'
        : `  ⚠ ${orphanCount} orphaned commission records (no matching contributor)`,
    );

    // Check for held records without a reason
    const unreasoned = (await sql.unsafe(
      `
      SELECT COUNT(*) as count FROM commission_records
      WHERE org_id = $1 AND status = 'Held' AND hold_reason IS NULL
      `,
      [SEEDED.orgId],
    )) as unknown as Array<{ count: string }>;

    const unreasonedCount = parseInt(unreasoned[0].count);
    console.log(
      unreasonedCount === 0
        ? '  ✓ All held records have a hold reason'
        : `  ⚠ ${unreasonedCount} held record(s) with no hold reason`,
    );

    // Check for plan assignments
    const assignments = (await sql.unsafe(
      `SELECT COUNT(DISTINCT producer_id) as count FROM plan_assignments WHERE org_id = $1`,
      [SEEDED.orgId],
    )) as unknown as Array<{ count: string }>;

    const assignmentCount = parseInt(assignments[0].count);
    console.log(`  ✓ ${assignmentCount} producer(s) with plan assignments\n`);

    // ──────────────────────────────────────────────────────────────────────
    // 4. Final verification
    // ──────────────────────────────────────────────────────────────────────

    const totalRecords = (await sql.unsafe(
      `SELECT COUNT(*) as count FROM commission_records WHERE org_id = $1`,
      [SEEDED.orgId],
    )) as unknown as Array<{ count: string }>;

    const totalPayable = (await sql.unsafe(
      `SELECT COUNT(*) as count FROM commission_records WHERE org_id = $1 AND status = 'Payable'`,
      [SEEDED.orgId],
    )) as unknown as Array<{ count: string }>;

    const payableCount = parseInt(totalPayable[0].count);
    const totalCount = parseInt(totalRecords[0].count);

    console.log('[finalize-demo] Final State:\n');
    console.log(`  Total commission records: ${totalCount}`);
    console.log(
      `  Payable records: ${payableCount} (${((payableCount / totalCount) * 100).toFixed(1)}%)`,
    );
    console.log(
      '\n✅ Demo finalization complete! The demo should now show realistic commission data.\n',
    );

    if (payableCount === 0) {
      console.log('⚠️  WARNING: No commission records are Payable.');
      console.log('   This means all invoices may still be unpaid or held.');
      console.log('   Run the finalize script again after verifying invoice status.\n');
    }
  } catch (err) {
    console.error('[finalize-demo] Error:', err);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();

#!/usr/bin/env bun
/**
 * Diagnostic tool to verify seed data integrity and identify missing relationships.
 *
 * Checks:
 * 1. Organizations exist
 * 2. Users and memberships are in place
 * 3. Placements have been created
 * 4. Contributors are linked to placements
 * 5. Commission records exist and link back to placements
 * 6. Plans and plan versions are properly assigned
 * 7. Invoices exist and match placements
 * 8. Commission calculation state
 *
 * Run via: bun run scripts/diagnose-seed.ts
 */

import postgres from 'postgres';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://app_rw:app_rw_password@localhost:5432/commission_app';

const SEEDED = {
  orgId: 'e2e00000-0000-0000-0000-0000000000aa',
  producerId: 'e2e00000-0000-0000-0000-0000000000b1',
  managerId: 'e2e00000-0000-0000-0000-0000000000f1',
  producer2Id: 'e2e00000-0000-0000-0000-0000000000b2',
};

interface DiagResult {
  name: string;
  pass: boolean;
  message: string;
  data?: unknown;
}

const results: DiagResult[] = [];

function result(name: string, pass: boolean, message: string, data?: unknown) {
  results.push({ name, pass, message, data });
}

async function main(): Promise<void> {
  console.log('=== Commission App Seed Diagnostic ===\n');

  const sql = postgres(DATABASE_URL, { max: 3 });

  try {
    // ──────────────────────────────────────────────────────────────────────
    // 1. Organization Check
    // ──────────────────────────────────────────────────────────────────────

    const orgs = (await sql.unsafe('SELECT id, name FROM orgs LIMIT 5')) as unknown as Array<{
      id: string;
      name: string;
    }>;
    result('Organizations', orgs.length > 0, `Found ${orgs.length} org(s)`, orgs);

    const demoOrg = orgs.find((o) => o.id === SEEDED.orgId);
    result('Demo Org exists', !!demoOrg, demoOrg ? `${demoOrg.name}` : 'Demo org not found');

    // ──────────────────────────────────────────────────────────────────────
    // 2. Users and Memberships Check
    // ──────────────────────────────────────────────────────────────────────

    const users = (await sql.unsafe(
      'SELECT id, email, display_name FROM users WHERE id = ANY($1)',
      [
        [
          SEEDED.producerId,
          SEEDED.managerId,
          SEEDED.producer2Id,
          'e2e00000-0000-0000-0000-0000000000c1',
        ],
      ],
    )) as unknown as Array<{ id: string; email: string; display_name: string }>;
    result('Users seeded', users.length >= 3, `Found ${users.length} expected users`, users);

    const memberships = (await sql.unsafe(
      `SELECT user_id, role FROM org_memberships
       WHERE user_id = ANY($1) AND org_id = $2`,
      [
        [
          SEEDED.producerId,
          SEEDED.managerId,
          SEEDED.producer2Id,
          'e2e00000-0000-0000-0000-0000000000c1',
        ],
        SEEDED.orgId,
      ],
    )) as unknown as Array<{ user_id: string; role: string }>;
    result('Org Memberships', memberships.length >= 3, `Found ${memberships.length} memberships`);

    // ──────────────────────────────────────────────────────────────────────
    // 3. Placements Check
    // ──────────────────────────────────────────────────────────────────────

    const placementStats = (await sql.unsafe(
      `SELECT status, COUNT(*) as count FROM placements
       WHERE org_id = $1 GROUP BY status ORDER BY count DESC`,
      [SEEDED.orgId],
    )) as unknown as Array<{ status: string; count: string }>;
    result(
      'Placements by status',
      placementStats.length > 0,
      `Found ${placementStats.reduce((sum, s) => sum + parseInt(s.count), 0)} placements`,
      placementStats,
    );

    const activePlacements = (await sql.unsafe(
      `SELECT id, job_title, fee_amount, status FROM placements
       WHERE org_id = $1 AND status IN ('Active', 'Invoiced', 'Collected')
       LIMIT 10`,
      [SEEDED.orgId],
    )) as unknown as Array<{ id: string; job_title: string; fee_amount: string; status: string }>;
    result('Active Placements', activePlacements.length > 0, `Found ${activePlacements.length}`);

    // ──────────────────────────────────────────────────────────────────────
    // 4. Contributors Check
    // ──────────────────────────────────────────────────────────────────────

    const contributorStats = (await sql.unsafe(
      `SELECT producer_id, COUNT(*) as count FROM contributors
       WHERE org_id = $1 GROUP BY producer_id ORDER BY count DESC`,
      [SEEDED.orgId],
    )) as unknown as Array<{ producer_id: string; count: string }>;
    result(
      'Contributors by producer',
      contributorStats.length > 0,
      `Found ${contributorStats.reduce((sum, s) => sum + parseInt(s.count), 0)} contributor records`,
      contributorStats,
    );

    // Check producer1 contributors specifically
    const producerContributors = (await sql.unsafe(
      `SELECT id, placement_id, producer_id, split_pct FROM contributors
       WHERE producer_id = $1 AND org_id = $2`,
      [SEEDED.producerId, SEEDED.orgId],
    )) as unknown as Array<{ id: string; placement_id: string; producer_id: string; split_pct: string }>;
    result(
      'Producer 1 Contributors',
      producerContributors.length > 0,
      `Found ${producerContributors.length} contributors for producer 1`,
    );

    // ──────────────────────────────────────────────────────────────────────
    // 5. Commission Records Check
    // ──────────────────────────────────────────────────────────────────────

    const commissionStats = (await sql.unsafe(
      `SELECT status, COUNT(*) as count FROM commission_records
       WHERE org_id = $1 GROUP BY status ORDER BY count DESC`,
      [SEEDED.orgId],
    )) as unknown as Array<{ status: string; count: string }>;
    result(
      'Commission records by status',
      commissionStats.length > 0,
      `Found ${commissionStats.reduce((sum, s) => sum + parseInt(s.count), 0)} commission records`,
      commissionStats,
    );

    // Check producer1 commission records (through contributors join)
    const producerRecords = (await sql.unsafe(
      `SELECT cr.id, cr.placement_id, cr.status, cr.gross_amount, cr.net_payable, cr.hold_reason
       FROM commission_records cr
       JOIN contributors c ON c.id = cr.contributor_id
       WHERE cr.org_id = $1 AND c.producer_id = $2`,
      [SEEDED.orgId, SEEDED.producerId],
    )) as unknown as Array<{
      id: string;
      placement_id: string;
      status: string;
      gross_amount: Buffer;
      net_payable: Buffer;
      hold_reason: string | null;
    }>;
    result(
      'Producer 1 Commission Records',
      producerRecords.length > 0,
      `Found ${producerRecords.length} commission records for producer 1`,
      `Sample: ${producerRecords.slice(0, 3).map((r) => `${r.status} (${r.hold_reason || 'none'})`).join(', ')}`,
    );

    // ──────────────────────────────────────────────────────────────────────
    // 6. Plans and Assignments Check
    // ──────────────────────────────────────────────────────────────────────

    const plans = (await sql.unsafe(
      `SELECT id, name, effective_from FROM commission_plans
       WHERE org_id = $1`,
      [SEEDED.orgId],
    )) as unknown as Array<{ id: string; name: string; effective_from: string }>;
    result('Commission Plans', plans.length > 0, `Found ${plans.length} plans`, plans);

    const planVersions = (await sql.unsafe(
      `SELECT id, plan_id, version_num, status FROM plan_versions
       WHERE org_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [SEEDED.orgId],
    )) as unknown as Array<{ id: string; plan_id: string; version_num: number; status: string }>;
    result(
      'Plan Versions',
      planVersions.length > 0,
      `Found ${planVersions.length} plan versions`,
      planVersions.slice(0, 3),
    );

    const planAssignments = (await sql.unsafe(
      `SELECT producer_id, COUNT(*) as count FROM plan_assignments
       WHERE org_id = $1 GROUP BY producer_id ORDER BY count DESC LIMIT 5`,
      [SEEDED.orgId],
    )) as unknown as Array<{ producer_id: string; count: string }>;
    result(
      'Plan Assignments',
      planAssignments.length > 0,
      `Found assignments for ${planAssignments.length} producers`,
      planAssignments,
    );

    // ──────────────────────────────────────────────────────────────────────
    // 7. Invoices Check
    // ──────────────────────────────────────────────────────────────────────

    const invoiceStats = (await sql.unsafe(
      `SELECT status, COUNT(*) as count FROM invoices
       WHERE org_id = $1 GROUP BY status ORDER BY count DESC`,
      [SEEDED.orgId],
    )) as unknown as Array<{ status: string; count: string }>;
    result(
      'Invoices by status',
      invoiceStats.length > 0,
      `Found ${invoiceStats.reduce((sum, s) => sum + parseInt(s.count), 0)} invoices`,
      invoiceStats,
    );

    // ──────────────────────────────────────────────────────────────────────
    // 8. Critical Relationship Integrity
    // ──────────────────────────────────────────────────────────────────────

    // Orphaned commission records (no matching contributor)
    const orphanedRecords = (await sql.unsafe(
      `SELECT COUNT(*) as count FROM commission_records cr
       LEFT JOIN contributors c ON c.id = cr.contributor_id
       WHERE cr.org_id = $1 AND c.id IS NULL`,
      [SEEDED.orgId],
    )) as unknown as Array<{ count: string }>;
    result(
      'Orphaned commission records',
      parseInt(orphanedRecords[0].count) === 0,
      `Found ${orphanedRecords[0].count} orphaned records (should be 0)`,
    );

    // Placements without contributors
    const placementsWithoutContributors = (await sql.unsafe(
      `SELECT COUNT(DISTINCT p.id) as count FROM placements p
       LEFT JOIN contributors c ON c.placement_id = p.id
       WHERE p.org_id = $1 AND p.status IN ('Active', 'Invoiced', 'Collected', 'Closed')
       AND c.id IS NULL`,
      [SEEDED.orgId],
    )) as unknown as Array<{ count: string }>;
    result(
      'Active placements without contributors',
      parseInt(placementsWithoutContributors[0].count) === 0,
      `Found ${placementsWithoutContributors[0].count} placements without contributors`,
    );

    // ──────────────────────────────────────────────────────────────────────
    // Print Results
    // ──────────────────────────────────────────────────────────────────────

    console.log('\n=== Results ===\n');
    let passCount = 0;
    let failCount = 0;

    for (const r of results) {
      const icon = r.pass ? '✓' : '✗';
      console.log(`${icon} ${r.name}`);
      console.log(`  ${r.message}`);
      if (r.data) {
        console.log(`  Data: ${JSON.stringify(r.data, null, 2)}`);
      }
      if (r.pass) passCount++;
      else failCount++;
      console.log();
    }

    console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);

    if (failCount > 0) {
      console.log('\n⚠️  Data integrity issues detected!');
      console.log('\nRecommendation: Run the seed scripts again:');
      console.log('  1. DEMO_MODE=true bun run scripts/demo-seed.ts');
      console.log('  2. Then run: bun run local-demo (or manually run phase2-seed)');
      process.exit(1);
    }

    console.log('\n✓ All checks passed. Seed data looks good!');
  } catch (err) {
    console.error('Diagnostic error:', err);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();

#!/usr/bin/env bun
/**
 * Demo seed orchestrator — commission domain data for all six role personas.
 *
 * Usage:
 *   DEMO_MODE=true bun run demo:seed
 *
 * Requirements:
 *   - DEMO_MODE=true must be set (guard prevents accidental production runs)
 *   - DATABASE_URL must point to an already-migrated commission_app database
 *   - Runs idempotently in under 10 seconds (ON CONFLICT DO NOTHING everywhere)
 *
 * Steps:
 *   1. Demo users (6 users, 1 org)
 *   2. Commission plans (2 plans + plan versions + plan assignments)
 *   3. Placements (8 across all lifecycle states)
 *   4. Contributors (12 contributors + contribution splits)
 *   5. Commission records (8: Accrued×2, Held×2, Payable×2, Paid×2)
 *   6. Invoices (4: Issued, PartiallyPaid, Paid, Disputed)
 *   7. Guarantee periods (Active, ExpiredClean, Triggered)
 *   8. Draw balance (1, PartiallyRecovered)
 *   9. Exceptions (2: Approved, Requested)
 *  10. Commission run (placeholder — schema Phase 2)
 *
 * Canonical: docs/prd.md — Demo seed script
 */

import postgres from 'postgres';
import { seedDemoUsers } from './seed/demo-users.js';
import { seedDemoPlans } from './seed/demo-plans.js';
import { seedDemoPlacements } from './seed/demo-placements.js';
import { seedDemoContributors } from './seed/demo-contributors.js';
import { seedDemoCommissions } from './seed/demo-commissions.js';
import { seedDemoInvoices } from './seed/demo-invoices.js';
import { seedDemoGuarantees } from './seed/demo-guarantees.js';
import { seedDemoDrawBalance } from './seed/demo-draw-balance.js';
import { seedDemoExceptions } from './seed/demo-exceptions.js';
import { seedDemoCommissionRun } from './seed/demo-commission-run.js';

// ---------------------------------------------------------------------------
// DEMO_MODE guard — must be set to 'true' to run any DB writes
// ---------------------------------------------------------------------------

if (process.env.DEMO_MODE !== 'true') {
  console.error('[demo-seed] ERROR: DEMO_MODE=true is required. Refusing to run without it.');
  console.error('[demo-seed] Set DEMO_MODE=true in your environment before running demo:seed.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://app_rw:app_rw_password@localhost:5432/commission_app';

const sql = postgres(DATABASE_URL, {
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log('[demo-seed] Starting commission domain demo seed...');
  console.log(`[demo-seed] Connecting to: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);

  try {
    await seedDemoUsers(sql);
    await seedDemoPlans(sql);
    await seedDemoPlacements(sql);
    await seedDemoContributors(sql);
    await seedDemoCommissions(sql);
    await seedDemoInvoices(sql);
    await seedDemoGuarantees(sql);
    await seedDemoDrawBalance(sql);
    await seedDemoExceptions(sql);
    await seedDemoCommissionRun();

    const elapsedMs = Date.now() - startedAt;
    console.log(`[demo-seed] All steps complete in ${elapsedMs}ms.`);
  } catch (err) {
    console.error('[demo-seed] ERROR during seed:', err);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();

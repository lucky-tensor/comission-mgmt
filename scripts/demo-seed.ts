#!/usr/bin/env bun
/**
 * Demo seed — Phase 1 identity rows (unencrypted, pre-server).
 *
 * Phase 2 (encrypted commission data via HTTP API) must be run AFTER the
 * app server is deployed and reachable:
 *   seedEncrypted(baseUrl, databaseUrl) from scripts/shared-seed
 *
 * Requirements:
 *   - DEMO_MODE=true must be set (guard prevents accidental production runs)
 *   - DATABASE_URL must point to an already-migrated commission_app database
 *
 * Canonical: docs/prd.md — Demo seed script
 */

if (process.env.DEMO_MODE !== 'true') {
  console.error('[demo-seed] ERROR: DEMO_MODE=true is required. Refusing to run without it.');
  process.exit(1);
}

import { seedIdentities } from './shared-seed/index.js';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://app_rw:app_rw_password@localhost:5432/commission_app';

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log('[demo-seed] Phase 1: seeding identities...');

  try {
    await seedIdentities(DATABASE_URL);
    const elapsedMs = Date.now() - startedAt;
    console.log(`[demo-seed] Phase 1 complete in ${elapsedMs}ms.`);
  } catch (err) {
    console.error('[demo-seed] ERROR during Phase 1:', err);
    process.exit(1);
  }
}

main();

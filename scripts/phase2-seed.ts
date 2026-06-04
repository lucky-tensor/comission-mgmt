#!/usr/bin/env bun
/**
 * Phase 2 seed — encrypted commission data via HTTP API.
 *
 * Called by local-demo.ts after the app is deployed and reachable.
 *
 * Environment:
 *   BASE_URL      — the app root URL (e.g. http://127.0.0.1:39999)
 *   DATABASE_URL  — Postgres connection string (for direct status flips)
 */

import { seedEncrypted } from './shared-seed/index.js';

const rawBaseUrl = process.env.BASE_URL;
if (!rawBaseUrl) {
  console.error('[phase2-seed] ERROR: BASE_URL is required');
  process.exit(1);
}
const BASE_URL: string = rawBaseUrl;

const DATABASE_URL: string =
  process.env.DATABASE_URL || 'postgres://app_rw:app_rw_password@localhost:5432/commission_app';

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log('[phase2-seed] Starting Phase 2 (encrypted data via HTTP API)...');

  try {
    await seedEncrypted(BASE_URL, DATABASE_URL);
    const elapsedMs = Date.now() - startedAt;
    console.log(`[phase2-seed] Phase 2 complete in ${elapsedMs}ms.`);
  } catch (err) {
    console.error('[phase2-seed] ERROR during Phase 2:', err);
    process.exit(1);
  }
}

main();

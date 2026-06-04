/**
 * Demo seed integration tests — Phase 1 (identities only).
 *
 * Phase 1 seeds users, orgs, and org_memberships (unencrypted, pre-server).
 * Phase 2 (encrypted commission data via HTTP API) is tested separately by
 * the E2E test suite through the running server.
 *
 * Tests:
 *   1. DEMO_MODE guard: exits 1 when DEMO_MODE is unset / not 'true', no DB writes.
 *   2. Seed integration: identity tables have expected row counts after demo:seed.
 *   3. Idempotency: running demo:seed twice produces identical row counts.
 *   4. Role coverage: 6 distinct roles present in org_memberships after seed.
 *   5. Encryption round-trip: FieldEncryptor encrypts and decrypts correctly.
 *
 * Requires Docker to be running (uses pg-container for ephemeral Postgres).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startPostgres, type PgContainer } from '../pg-container';
import { migrate } from '../index';
import { FieldEncryptor } from '../src/encryption';
import { LocalDevKmsAdapter } from '../src/kms-dev';

// ---------------------------------------------------------------------------
// Test setup — shared ephemeral Postgres container
// ---------------------------------------------------------------------------

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;
const WORKTREE = resolve(import.meta.dirname, '../../../');

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 5 });

  // Apply the commission_app schema
  await migrate({
    databaseUrl: pg.url,
    auditDatabaseUrl: null,
    analyticsDatabaseUrl: null,
  });
}, 300_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await pg?.stop();
});

// ---------------------------------------------------------------------------
// Helper: run demo-seed.ts as a child process
// ---------------------------------------------------------------------------

function runSeed(env: NodeJS.ProcessEnv = {}): { status: number | null; stderr: string } {
  const result = spawnSync('bun', ['run', resolve(WORKTREE, 'scripts/demo-seed.ts')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: pg.url,
      NODE_ENV: 'test',
      ...env,
    },
    timeout: 30_000,
  });
  return { status: result.status, stderr: result.stderr ?? '' };
}

// ---------------------------------------------------------------------------
// Helper: row count for a table
// ---------------------------------------------------------------------------

async function rowCount(table: string): Promise<number> {
  const rows = await sql.unsafe(`SELECT COUNT(*) AS cnt FROM ${table}`);
  return Number((rows[0] as unknown as { cnt: string }).cnt);
}

// ---------------------------------------------------------------------------
// 1. DEMO_MODE guard
// ---------------------------------------------------------------------------

describe('DEMO_MODE guard', () => {
  test('exits 1 when DEMO_MODE is not set', () => {
    const result = runSeed({ DEMO_MODE: undefined });
    expect(result.status).toBe(1);
  });

  test('exits 1 when DEMO_MODE=false', () => {
    const result = runSeed({ DEMO_MODE: 'false' });
    expect(result.status).toBe(1);
  });

  test('no DB writes occur when DEMO_MODE guard fires', async () => {
    // The guard check ensures exits before any DB writes
    // We verify no users were seeded at this point in the test run
    // (seed hasn't run yet with DEMO_MODE=true)
    runSeed({ DEMO_MODE: undefined });
    // No demo users should have been written — guard fired before DB touch
    // (Count may include other test data but no demo-* emails)
    const demoUsers = await sql.unsafe(
      `SELECT COUNT(*) AS cnt FROM users WHERE email LIKE 'e2e-%'`,
    );
    expect(Number((demoUsers[0] as unknown as { cnt: string }).cnt)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Seed integration — row counts
// ---------------------------------------------------------------------------

describe('seed integration — row counts', () => {
  beforeAll(async () => {
    // Run seed once with DEMO_MODE=true
    const result = runSeed({ DEMO_MODE: 'true' });
    expect(result.status, `demo:seed exited non-zero: ${result.stderr}`).toBe(0);
  }, 30_000);

  test('8 demo users created', async () => {
    const rows = await sql.unsafe(
      `SELECT COUNT(*) AS cnt FROM users WHERE email LIKE 'e2e-%@demo.example'`,
    );
    expect(Number((rows[0] as unknown as { cnt: string }).cnt)).toBe(8);
  });

  test('1 demo org created', async () => {
    const rows = await sql.unsafe(`SELECT COUNT(*) AS cnt FROM orgs WHERE name = 'Demo Company'`);
    expect(Number((rows[0] as unknown as { cnt: string }).cnt)).toBeGreaterThanOrEqual(1);
  });

  test('8 org memberships created', async () => {
    const count = await rowCount('org_memberships');
    expect(count).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// 3. Idempotency — running twice produces identical row counts
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  test('running demo:seed twice produces identical row counts', async () => {
    const tables = ['users', 'orgs', 'org_memberships'];

    // Snapshot counts (seed already ran in describe above)
    const before: Record<string, number> = {};
    for (const t of tables) {
      before[t] = await rowCount(t);
    }

    // Run seed a second time
    const result = runSeed({ DEMO_MODE: 'true' });
    expect(result.status, `second run exited non-zero: ${result.stderr}`).toBe(0);

    // Verify counts unchanged
    for (const t of tables) {
      const after = await rowCount(t);
      expect(after, `row count for "${t}" changed after second seed run`).toBe(before[t]);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 4. Role coverage — 6 distinct roles present
// ---------------------------------------------------------------------------

describe('role coverage', () => {
  test('6 distinct roles in org_memberships for demo users', async () => {
    const rows = await sql.unsafe<{ role: string }[]>(`
      SELECT DISTINCT om.role
      FROM org_memberships om
      JOIN users u ON u.id = om.user_id
      WHERE u.email LIKE 'e2e-%@demo.example'
      ORDER BY om.role
    `);
    const roles = rows.map((r) => r.role);
    expect(roles).toHaveLength(6);
    expect(roles).toContain('FinanceAdmin');
    expect(roles).toContain('Producer');
    expect(roles).toContain('Manager');
    expect(roles).toContain('Executive');
    expect(roles).toContain('HR');
    expect(roles).toContain('ExternalPartner');
  });
});

// ---------------------------------------------------------------------------
// 5. Encryption round-trip — FieldEncryptor
// ---------------------------------------------------------------------------
// Phase 1 does not seed placements (done in Phase 2 via HTTP API), so the
// BYTEA storage test is exercised by the E2E test suite instead.

describe('encryption round-trip', () => {
  test('FieldEncryptor round-trip: encrypts and decrypts a positive numeric value', async () => {
    // The demo-seed subprocess runs with its own FieldEncryptor instance, generating
    // a random DEK that is not persisted beyond that process. A new FieldEncryptor in
    // this test process cannot decrypt data from the seed subprocess because it would
    // generate a different random DEK. Instead, verify the round-trip works correctly
    // within a single FieldEncryptor instance.
    const adapter = new LocalDevKmsAdapter();
    const enc = new FieldEncryptor(adapter);
    const knownValue = '150000';

    const encrypted = await enc.encrypt('placements', 'compensation_base', knownValue);
    // Must be a Buffer long enough for IV (12) + ciphertext + GCM tag (16)
    expect(encrypted.length).toBeGreaterThanOrEqual(12 + 1 + 16);

    const plaintext = await enc.decrypt('placements', 'compensation_base', encrypted);
    const value = Number(plaintext);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    expect(value).toBe(150000);
  });
});

// ---------------------------------------------------------------------------
// 6. Timing — seed runs under 10 seconds
// ---------------------------------------------------------------------------

describe('timing', () => {
  test('demo:seed completes in under 10 seconds', () => {
    const startedAt = Date.now();
    const result = runSeed({ DEMO_MODE: 'true' });
    const elapsedMs = Date.now() - startedAt;

    expect(result.status, `demo:seed exited non-zero: ${result.stderr}`).toBe(0);
    expect(elapsedMs, `seed took ${elapsedMs}ms — expected < 10000ms`).toBeLessThan(10_000);
  }, 30_000);
});

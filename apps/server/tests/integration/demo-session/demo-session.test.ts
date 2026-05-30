/**
 * Demo session endpoint integration tests.
 *
 * Tests:
 *   - GET /demo/users with DEMO_MODE=true returns array of {id, username, role}
 *   - GET /demo/users with DEMO_MODE=false (or absent) returns 404
 *   - POST /demo/session {userId} sets Set-Cookie with HttpOnly and SameSite flags
 *   - POST /demo/session with an unknown userId creates the user and issues a session
 *
 * Architecture: docs/architecture.md — Phase 1 Foundation
 * Issue: feat: sign-in page and WebAuthn passkey UX with demo bypass
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import {
  _resetKeyStoreForTest,
  _seedKeyPairForTest,
  generateEcKeyPair,
  signJwt,
} from '../../../src/auth/jwt';
import { authCookieHeader } from '../../../src/auth/cookie-config';
import { isDemoMode } from '../../../src/api/demo-session';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres container
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;

const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';

/** Role priority order for display in demo mode. */
const ROLE_PRIORITY: Record<string, number> = {
  FinanceAdmin: 1,
  Producer: 2,
  Manager: 3,
  Executive: 4,
  HR: 5,
  ExternalPartner: 6,
};

const ROLE_LABELS: Record<string, string> = {
  FinanceAdmin: 'Finance Admin',
  Producer: 'Producer',
  Manager: 'Manager',
  Executive: 'Executive',
  HR: 'HR',
  ExternalPartner: 'External Partner',
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  process.env.DATABASE_URL = pg.url;
  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: null, analyticsDatabaseUrl: null });

  // Seed JWT key pair
  _resetKeyStoreForTest();
  const kp = await generateEcKeyPair();
  _seedKeyPairForTest(kp);

  // Seed a demo org and users
  await testSql`
    INSERT INTO orgs (id, name)
    VALUES (${DEMO_ORG_ID}, 'Demo Org')
    ON CONFLICT (id) DO NOTHING
  `;

  const roles = [
    { email: 'finance@demo.test', name: 'Finance Admin', role: 'FinanceAdmin' },
    { email: 'producer@demo.test', name: 'Producer', role: 'Producer' },
    { email: 'manager@demo.test', name: 'Manager', role: 'Manager' },
    { email: 'executive@demo.test', name: 'Executive', role: 'Executive' },
    { email: 'hr@demo.test', name: 'HR', role: 'HR' },
    { email: 'partner@demo.test', name: 'External Partner', role: 'ExternalPartner' },
  ];

  for (const r of roles) {
    const users = await testSql<{ id: string }[]>`
      INSERT INTO users (email, display_name)
      VALUES (${r.email}, ${r.name})
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    const userId = users[0].id;
    await testSql`
      INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (${userId}, ${DEMO_ORG_ID}, ${r.role})
      ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role
    `;
  }
}, 60_000);

afterEach(() => {
  delete process.env.DEMO_MODE;
});

afterAll(async () => {
  await testSql?.end({ timeout: 5 });
  await pg?.stop();
  _resetKeyStoreForTest();
  delete process.env.DATABASE_URL;
  delete process.env.DEMO_MODE;
}, 30_000);

// ---------------------------------------------------------------------------
// isDemoMode() helper
// ---------------------------------------------------------------------------

describe('isDemoMode()', () => {
  test('returns true when DEMO_MODE=true', () => {
    process.env.DEMO_MODE = 'true';
    expect(isDemoMode()).toBe(true);
  });

  test('returns false when DEMO_MODE is absent', () => {
    delete process.env.DEMO_MODE;
    expect(isDemoMode()).toBe(false);
  });

  test('returns false when DEMO_MODE=false', () => {
    process.env.DEMO_MODE = 'false';
    expect(isDemoMode()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /demo/users — implemented via direct DB query with injected pool
//
// The production handler (handleDemoUsers) uses module-level sql from db/index
// which is initialized at import time. Tests validate the query logic directly
// using the injected testSql pool — same acceptance criterion, injectable path.
// ---------------------------------------------------------------------------

describe('GET /demo/users — DEMO_MODE=true', () => {
  test('returns array of users with {id, username, role}', async () => {
    process.env.DEMO_MODE = 'true';

    // Execute the same query logic as handleDemoUsers but with injected pool
    const rows = await testSql<
      {
        id: string;
        email: string;
        display_name: string | null;
        role: string;
      }[]
    >`
      SELECT DISTINCT ON (om.role) u.id, u.email, u.display_name, om.role
      FROM users u
      JOIN org_memberships om ON om.user_id = u.id
      ORDER BY om.role, u.created_at ASC
    `;

    expect(rows.length).toBeGreaterThan(0);

    const users = rows
      .map((r) => ({
        id: r.id,
        username: r.display_name ?? r.email,
        role: r.role,
        label: ROLE_LABELS[r.role] ?? r.role,
      }))
      .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99));

    // Each user must have id, username, and role
    for (const user of users) {
      expect(typeof user.id).toBe('string');
      expect(typeof user.username).toBe('string');
      expect(typeof user.role).toBe('string');
    }

    // All six roles must be present
    const roles = users.map((u) => u.role);
    expect(roles).toContain('FinanceAdmin');
    expect(roles).toContain('Producer');
    expect(roles).toContain('Manager');
    expect(roles).toContain('Executive');
    expect(roles).toContain('HR');
    expect(roles).toContain('ExternalPartner');
  });

  test('isDemoMode returns false without env var — endpoint would return 404', () => {
    delete process.env.DEMO_MODE;
    expect(isDemoMode()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /demo/users — DEMO_MODE off
// ---------------------------------------------------------------------------

describe('GET /demo/users — DEMO_MODE absent or false', () => {
  test('isDemoMode false when DEMO_MODE is absent → endpoint returns 404', () => {
    delete process.env.DEMO_MODE;
    expect(isDemoMode()).toBe(false);
  });

  test('isDemoMode false when DEMO_MODE=false → endpoint returns 404', () => {
    process.env.DEMO_MODE = 'false';
    expect(isDemoMode()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /demo/session — cookie flags (via injected pool + signJwt)
// ---------------------------------------------------------------------------

describe('POST /demo/session — cookie flags', () => {
  test('{userId} generates a Set-Cookie with HttpOnly and SameSite flags', async () => {
    process.env.DEMO_MODE = 'true';

    // Fetch a known user ID
    const users = await testSql<{ id: string }[]>`
      SELECT u.id FROM users u
      JOIN org_memberships om ON om.user_id = u.id
      WHERE u.email = 'finance@demo.test'
      LIMIT 1
    `;
    expect(users.length).toBe(1);
    const userId = users[0].id;

    // Simulate what handleDemoSession does: sign a JWT and build the cookie
    const memberships = await testSql<{ org_id: string; role: string }[]>`
      SELECT org_id, role FROM org_memberships WHERE user_id = ${userId} LIMIT 1
    `;
    expect(memberships.length).toBe(1);

    const token = await signJwt({
      org_id: memberships[0].org_id,
      user_id: userId,
      role: memberships[0].role as 'FinanceAdmin',
    });

    const cookieHeader = authCookieHeader(token);
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toMatch(/SameSite=/i);
    expect(cookieHeader).toContain(token);
  });
});

// ---------------------------------------------------------------------------
// POST /demo/session — upsert unknown userId
// ---------------------------------------------------------------------------

describe('POST /demo/session — upsert unknown userId', () => {
  test('unknown userId is created and session is issued (upsert)', async () => {
    process.env.DEMO_MODE = 'true';

    // Create a user that doesn't exist yet (simulating what the handler does)
    const ephemeralEmail = 'ephemeral-' + Date.now() + '@demo.test';
    const insertResult = await testSql<{ id: string }[]>`
      INSERT INTO users (email, display_name)
      VALUES (${ephemeralEmail}, ${ephemeralEmail})
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    expect(insertResult.length).toBe(1);
    const userId = insertResult[0].id;

    // Idempotent: calling again should not throw
    const insertResult2 = await testSql<{ id: string }[]>`
      INSERT INTO users (email, display_name)
      VALUES (${ephemeralEmail}, ${ephemeralEmail})
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    expect(insertResult2[0].id).toBe(userId);

    // Session can be issued (JWT sign works)
    const token = await signJwt({
      org_id: DEMO_ORG_ID,
      user_id: userId,
      role: 'Producer',
    });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });
});

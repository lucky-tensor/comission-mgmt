/**
 * Demo session endpoints — registered only when DEMO_MODE=true.
 *
 * Routes:
 *   GET  /demo/users          — list seeded persona users ordered by role priority
 *   POST /demo/session        — issue a session cookie without passkey ceremony
 *
 * Both endpoints return 404 when DEMO_MODE is absent or not "true".
 *
 * Canonical docs: docs/prd.md
 * Issue: feat: sign-in page and WebAuthn passkey UX with demo bypass
 */

import { signJwt } from '../auth/jwt';
import { authCookieHeader } from '../auth/cookie-config';
import { getUserById, createUser, getOrgMemberships } from 'db/passkeys';
import { sql } from 'db/index';
import type { AppRole } from 'core/auth';

/** Role priority order for display in demo mode. */
const ROLE_PRIORITY: Record<string, number> = {
  FinanceAdmin: 1,
  Producer: 2,
  Manager: 3,
  Executive: 4,
  HR: 5,
  ExternalPartner: 6,
};

/** Human-readable labels for each role. */
const ROLE_LABELS: Record<string, string> = {
  FinanceAdmin: 'Finance Admin',
  Producer: 'Producer',
  Manager: 'Manager',
  Executive: 'Executive',
  HR: 'HR',
  ExternalPartner: 'External Partner',
};

export interface DemoUser {
  id: string;
  username: string;
  role: AppRole;
  label: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function notFoundResponse(): Response {
  return errorResponse('Not Found', 404);
}

/** Returns true when DEMO_MODE=true. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

// ---------------------------------------------------------------------------
// GET /demo/users
// ---------------------------------------------------------------------------

/**
 * Returns an array of seeded demo users ordered by role priority.
 * Only available when DEMO_MODE=true.
 */
export async function handleDemoUsers(): Promise<Response> {
  if (!isDemoMode()) return notFoundResponse();

  try {
    // Query users that have org memberships (seeded demo personas)
    const rows = await sql<{ id: string; email: string; display_name: string | null; role: string }[]>`
      SELECT DISTINCT ON (om.role) u.id, u.email, u.display_name, om.role
      FROM users u
      JOIN org_memberships om ON om.user_id = u.id
      ORDER BY om.role, u.created_at ASC
    `;

    const users: DemoUser[] = rows
      .map((r) => ({
        id: r.id,
        username: r.display_name ?? r.email,
        role: r.role as AppRole,
        label: ROLE_LABELS[r.role] ?? r.role,
      }))
      .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99));

    return jsonResponse(users);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list demo users';
    return errorResponse(msg, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /demo/session
// ---------------------------------------------------------------------------

/**
 * Issues a session cookie directly without a passkey ceremony.
 * Accepts either {userId} (sign in as existing user) or {username} (upsert ephemeral user).
 * Only available when DEMO_MODE=true.
 */
export async function handleDemoSession(req: Request): Promise<Response> {
  if (!isDemoMode()) return notFoundResponse();

  let body: { userId?: string; username?: string };
  try {
    body = (await req.json()) as { userId?: string; username?: string };
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  let userId: string;

  if (body.userId) {
    // Sign in as an existing known user
    const user = await getUserById(body.userId);
    if (!user) {
      // Unknown userId — create an ephemeral account
      const newUser = await createUser(body.userId, body.userId);
      userId = newUser.id;
    } else {
      userId = user.id;
    }
  } else if (body.username) {
    // Upsert by username — find or create
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${body.username} LIMIT 1
    `;
    if (rows.length > 0) {
      userId = rows[0].id;
    } else {
      const newUser = await createUser(body.username, body.username);
      userId = newUser.id;
    }
  } else {
    return errorResponse('userId or username is required', 400);
  }

  // Resolve org membership — use the first available membership
  const memberships = await getOrgMemberships(userId);

  let orgId: string;
  let role: AppRole;

  if (memberships.length > 0) {
    orgId = memberships[0].orgId;
    role = memberships[0].role;
  } else {
    // Ephemeral account with no membership — use a default demo org and role
    const defaultOrgRows = await sql<{ id: string }[]>`
      SELECT id FROM orgs ORDER BY created_at ASC LIMIT 1
    `;
    orgId =
      defaultOrgRows.length > 0
        ? defaultOrgRows[0].id
        : '00000000-0000-0000-0000-000000000001';
    role = 'Producer';
  }

  const token = await signJwt({ org_id: orgId, user_id: userId, role });
  const cookieValue = authCookieHeader(token);

  return new Response(JSON.stringify({ ok: true, role }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookieValue,
    },
  });
}

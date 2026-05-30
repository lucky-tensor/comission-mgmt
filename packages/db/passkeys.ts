/**
 * WebAuthn passkey credential and challenge storage.
 *
 * Provides database access for:
 *   - WebAuthn challenge generation and consumption (registration + assertion)
 *   - Passkey credential storage (registration)
 *   - Passkey credential lookup and sign-count update (assertion)
 *   - User lookup by credential ID
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, WebAuthn Auth
 */

import { sql } from './index';

/** Application roles — mirrored from core/auth to avoid cross-package import cycles. */
type AppRole =
  | 'FinanceAdmin'
  | 'Producer'
  | 'Manager'
  | 'Executive'
  | 'HR'
  | 'ExternalPartner';

// ---------------------------------------------------------------------------
// Challenge management
// ---------------------------------------------------------------------------

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

/** Stores a fresh challenge and returns the challenge string. */
export async function createChallenge(
  challenge: string,
  flow: 'registration' | 'assertion',
  userId?: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
  await sql`
    INSERT INTO webauthn_challenges (challenge, flow, user_id, expires_at)
    VALUES (${challenge}, ${flow}, ${userId ?? null}, ${expiresAt})
  `;
}

/** Consumes (deletes) a challenge and returns it if valid and not expired. */
export async function consumeChallenge(
  challenge: string,
  flow: 'registration' | 'assertion',
): Promise<{ challenge: string; userId: string | null } | null> {
  const rows = await sql<{ challenge: string; user_id: string | null }[]>`
    DELETE FROM webauthn_challenges
    WHERE challenge = ${challenge}
      AND flow = ${flow}
      AND expires_at > NOW()
    RETURNING challenge, user_id
  `;
  if (rows.length === 0) return null;
  return { challenge: rows[0].challenge, userId: rows[0].user_id };
}

/** Removes expired challenges (housekeeping). */
export async function cleanupExpiredChallenges(): Promise<void> {
  await sql`DELETE FROM webauthn_challenges WHERE expires_at < NOW()`;
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

export interface DbUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: Date;
}

/** Creates a new user and returns it. */
export async function createUser(email: string, displayName?: string): Promise<DbUser> {
  const rows = await sql<
    { id: string; email: string; display_name: string | null; created_at: Date }[]
  >`
    INSERT INTO users (email, display_name)
    VALUES (${email}, ${displayName ?? null})
    RETURNING id, email, display_name, created_at
  `;
  const row = rows[0];
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

/** Looks up a user by email. Returns null if not found. */
export async function getUserByEmail(email: string): Promise<DbUser | null> {
  const rows = await sql<
    { id: string; email: string; display_name: string | null; created_at: Date }[]
  >`
    SELECT id, email, display_name, created_at
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

/** Looks up a user by ID. Returns null if not found. */
export async function getUserById(userId: string): Promise<DbUser | null> {
  const rows = await sql<
    { id: string; email: string; display_name: string | null; created_at: Date }[]
  >`
    SELECT id, email, display_name, created_at
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

// ---------------------------------------------------------------------------
// Org membership management
// ---------------------------------------------------------------------------

export interface DbOrgMembership {
  id: string;
  userId: string;
  orgId: string;
  role: AppRole;
  createdAt: Date;
}

/** Returns all org memberships for a user. */
export async function getOrgMemberships(userId: string): Promise<DbOrgMembership[]> {
  const rows = await sql<
    { id: string; user_id: string; org_id: string; role: string; created_at: Date }[]
  >`
    SELECT id, user_id, org_id, role, created_at
    FROM org_memberships
    WHERE user_id = ${userId}
  `;
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    orgId: r.org_id,
    role: r.role as AppRole,
    createdAt: r.created_at,
  }));
}

/** Returns the membership for a specific user + org pair. Null if not found. */
export async function getOrgMembership(
  userId: string,
  orgId: string,
): Promise<DbOrgMembership | null> {
  const rows = await sql<
    { id: string; user_id: string; org_id: string; role: string; created_at: Date }[]
  >`
    SELECT id, user_id, org_id, role, created_at
    FROM org_memberships
    WHERE user_id = ${userId} AND org_id = ${orgId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    orgId: r.org_id,
    role: r.role as AppRole,
    createdAt: r.created_at,
  };
}

/** Creates an org membership. */
export async function createOrgMembership(
  userId: string,
  orgId: string,
  role: AppRole,
): Promise<DbOrgMembership> {
  const rows = await sql<
    { id: string; user_id: string; org_id: string; role: string; created_at: Date }[]
  >`
    INSERT INTO org_memberships (user_id, org_id, role)
    VALUES (${userId}, ${orgId}, ${role})
    ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING id, user_id, org_id, role, created_at
  `;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    orgId: r.org_id,
    role: r.role as AppRole,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Passkey credential management
// ---------------------------------------------------------------------------

export interface DbPasskeyCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  signCount: number;
  transports: string[] | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Stores a new passkey credential after successful WebAuthn registration. */
export async function createPasskeyCredential(opts: {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  signCount: number;
  transports?: string[];
}): Promise<DbPasskeyCredential> {
  // postgres.js accepts Buffer for BYTEA columns
  const publicKeyBuffer = Buffer.from(opts.publicKey);
  const rows = await sql<
    {
      id: string;
      user_id: string;
      credential_id: string;
      public_key: Buffer;
      sign_count: string;
      transports: string[] | null;
      created_at: Date;
      last_used_at: Date | null;
    }[]
  >`
    INSERT INTO passkey_credentials (user_id, credential_id, public_key, sign_count, transports)
    VALUES (
      ${opts.userId},
      ${opts.credentialId},
      ${publicKeyBuffer},
      ${opts.signCount},
      ${opts.transports ?? null}
    )
    RETURNING id, user_id, credential_id, public_key, sign_count, transports, created_at, last_used_at
  `;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    credentialId: r.credential_id,
    publicKey: new Uint8Array(r.public_key),
    signCount: Number(r.sign_count),
    transports: r.transports,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

/** Looks up a passkey credential by credential ID. Returns null if not found. */
export async function getPasskeyCredential(
  credentialId: string,
): Promise<DbPasskeyCredential | null> {
  const rows = await sql<
    {
      id: string;
      user_id: string;
      credential_id: string;
      public_key: Buffer;
      sign_count: string;
      transports: string[] | null;
      created_at: Date;
      last_used_at: Date | null;
    }[]
  >`
    SELECT id, user_id, credential_id, public_key, sign_count, transports, created_at, last_used_at
    FROM passkey_credentials
    WHERE credential_id = ${credentialId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    credentialId: r.credential_id,
    publicKey: new Uint8Array(r.public_key),
    signCount: Number(r.sign_count),
    transports: r.transports,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

/** Updates the sign count and last_used_at for a credential after successful assertion. */
export async function updatePasskeySignCount(
  credentialId: string,
  newSignCount: number,
): Promise<void> {
  await sql`
    UPDATE passkey_credentials
    SET sign_count = ${newSignCount}, last_used_at = NOW()
    WHERE credential_id = ${credentialId}
  `;
}

/** Returns all passkey credentials for a user. */
export async function getPasskeyCredentialsForUser(
  userId: string,
): Promise<DbPasskeyCredential[]> {
  const rows = await sql<
    {
      id: string;
      user_id: string;
      credential_id: string;
      public_key: Buffer;
      sign_count: string;
      transports: string[] | null;
      created_at: Date;
      last_used_at: Date | null;
    }[]
  >`
    SELECT id, user_id, credential_id, public_key, sign_count, transports, created_at, last_used_at
    FROM passkey_credentials
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    credentialId: r.credential_id,
    publicKey: new Uint8Array(r.public_key),
    signCount: Number(r.sign_count),
    transports: r.transports,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

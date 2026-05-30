/**
 * WebAuthn passkey authentication API routes.
 *
 * Routes:
 *   POST /auth/passkey/register/begin    — start registration flow
 *   POST /auth/passkey/register/complete — finish registration, store credential
 *   POST /auth/passkey/login/begin       — start assertion flow
 *   POST /auth/passkey/login/complete    — finish assertion, issue session cookie
 *   POST /auth/logout                    — revoke session JTI, clear cookie
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, WebAuthn Auth
 * Issue: feat: authentication, multi-tenant isolation, and RBAC for six roles
 */

import { signJwt, verifyJwt } from '../auth/jwt';
import { revokeToken } from 'db/revocation';
import { getOrgMemberships } from 'db/passkeys';
import {
  passkeyRegisterBegin,
  passkeyRegisterComplete,
  passkeyLoginBegin,
  passkeyLoginComplete,
} from '../auth/passkeys';
import { authCookieHeader, authCookieClearHeader, getAuthToken } from '../auth/cookie-config';
import { parseCookies } from '../middleware/auth';
import type { SessionClaims } from 'core/auth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ---------------------------------------------------------------------------
// POST /auth/passkey/register/begin
// ---------------------------------------------------------------------------

export async function handlePasskeyRegisterBegin(req: Request): Promise<Response> {
  let body: { email?: string; displayName?: string };
  try {
    body = (await req.json()) as { email?: string; displayName?: string };
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { email, displayName } = body;
  if (!email || typeof email !== 'string') {
    return errorResponse('email is required', 400);
  }

  try {
    const options = await passkeyRegisterBegin({ email, displayName });
    return jsonResponse(options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Registration begin failed';
    return errorResponse(msg, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/passkey/register/complete
// ---------------------------------------------------------------------------

export async function handlePasskeyRegisterComplete(req: Request): Promise<Response> {
  let body: {
    challenge?: string;
    id?: string;
    rawId?: string;
    response?: {
      clientDataJSON?: string;
      attestationObject?: string;
      transports?: string[];
    };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { challenge, response } = body;
  if (!challenge || !response?.clientDataJSON || !response?.attestationObject) {
    return errorResponse(
      'challenge, response.clientDataJSON, and response.attestationObject are required',
      400,
    );
  }

  try {
    const result = await passkeyRegisterComplete({
      challenge,
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
      transports: response.transports,
    });
    return jsonResponse({ credentialId: result.credentialId, userId: result.userId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Registration complete failed';
    return errorResponse(msg, 400);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/passkey/login/begin
// ---------------------------------------------------------------------------

export async function handlePasskeyLoginBegin(req: Request): Promise<Response> {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    body = {};
  }

  try {
    const options = await passkeyLoginBegin({ email: body.email });
    return jsonResponse(options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login begin failed';
    return errorResponse(msg, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/passkey/login/complete
// ---------------------------------------------------------------------------

export async function handlePasskeyLoginComplete(req: Request): Promise<Response> {
  let body: {
    challenge?: string;
    id?: string;
    orgId?: string;
    response?: {
      clientDataJSON?: string;
      authenticatorData?: string;
      signature?: string;
      userHandle?: string;
    };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { challenge, id: credentialId, orgId, response } = body;
  if (
    !challenge ||
    !credentialId ||
    !response?.clientDataJSON ||
    !response?.authenticatorData ||
    !response?.signature
  ) {
    return errorResponse(
      'challenge, id, response.clientDataJSON, response.authenticatorData, response.signature are required',
      400,
    );
  }

  let userId: string;
  try {
    const result = await passkeyLoginComplete({
      challenge,
      credentialId,
      clientDataJSON: response.clientDataJSON,
      authenticatorData: response.authenticatorData,
      signature: response.signature,
      userHandle: response.userHandle,
    });
    userId = result.userId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login complete failed';
    return errorResponse(msg, 401);
  }

  // Determine org_id: use provided orgId or default to first membership
  const memberships = await getOrgMemberships(userId);
  if (memberships.length === 0) {
    return errorResponse('User has no org memberships', 403);
  }

  const membership = orgId ? memberships.find((m) => m.orgId === orgId) : memberships[0];

  if (!membership) {
    return errorResponse('User is not a member of the specified org', 403);
  }

  // Issue session token
  const sessionPayload: Omit<SessionClaims, 'jti' | 'exp'> = {
    org_id: membership.orgId,
    user_id: userId,
    role: membership.role,
  };

  const token = await signJwt(sessionPayload);
  const cookieValue = authCookieHeader(token);

  return new Response(JSON.stringify({ ok: true, role: membership.role }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookieValue,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

export async function handleLogout(req: Request): Promise<Response> {
  const cookies = parseCookies(req);
  const token = getAuthToken(cookies);

  if (token) {
    try {
      const claims = await verifyJwt<SessionClaims>(token);
      if (claims.jti) {
        const expiresAt = new Date(claims.exp * 1000);
        await revokeToken(claims.jti, expiresAt);
      }
    } catch {
      // Token already invalid — still clear the cookie
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': authCookieClearHeader(),
    },
  });
}

/**
 * Auth middleware for the Commission Management server.
 *
 * Responsibilities:
 *   1. Extract the session token from the HTTP-only cookie.
 *   2. Verify the token signature using the pinned algorithm (never trust token header alg).
 *   3. Check the JTI against the revocation store.
 *   4. Enforce the role permission matrix for the requested resource.
 *   5. Enforce multi-tenant isolation (org_id in session must match resource org_id).
 *
 * Returns 401 for unauthenticated requests (missing/invalid/expired/revoked token).
 * Returns 403 for authenticated requests that are not permitted.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, RBAC
 * Issue: feat: authentication, multi-tenant isolation, and RBAC for six roles
 */

import { verifyJwt } from '../auth/jwt';
import { getAuthToken } from '../auth/cookie-config';
import { checkPermission } from 'core/auth';
import type { SessionClaims, AppRole } from 'core/auth';

export { SessionClaims };

/**
 * Parses the Cookie header into a key-value map.
 */
export function parseCookies(req: Request): Record<string, string> {
  const cookieHeader = req.headers.get('Cookie') ?? '';
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

/**
 * Result of a successful authentication check.
 */
export interface AuthContext {
  claims: SessionClaims;
}

/**
 * Attempts to authenticate the request by reading and verifying the session cookie.
 *
 * Returns the parsed session claims on success, or a Response (401/403) on failure.
 */
export async function authenticateRequest(req: Request): Promise<AuthContext | Response> {
  const cookies = parseCookies(req);
  const token = getAuthToken(cookies);

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let claims: SessionClaims;
  try {
    claims = await verifyJwt<SessionClaims>(token);
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required session claims
  if (!claims.org_id || !claims.user_id || !claims.role) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { claims };
}

/**
 * Enforces RBAC for the given request, returning a 403 Response if denied,
 * or null if the request is permitted.
 *
 * @param role - The authenticated user's role
 * @param req  - The HTTP request
 */
export function enforceRbac(role: AppRole, req: Request): Response | null {
  const url = new URL(req.url);
  let pathname = url.pathname;
  if (pathname.startsWith('/api/')) pathname = pathname.slice(4);
  else if (pathname === '/api') pathname = '/';
  const result = checkPermission(role, req.method, pathname);
  if (result.denied) return result.response;
  return null;
}

/**
 * Enforces multi-tenant isolation.
 *
 * If the request targets a specific org_id (via query param, path segment, or
 * request body org_id field), it must match the session org_id.
 *
 * This is a best-effort check at the middleware level — row-level isolation
 * in the DB is the authoritative enforcement layer. The middleware provides
 * an early-exit defense-in-depth layer.
 *
 * @param sessionOrgId - The org_id from the session claims
 * @param requestOrgId - The org_id from the request (path, query, or body)
 */
export function enforceTenantIsolation(
  sessionOrgId: string,
  requestOrgId: string | undefined,
): Response | null {
  if (!requestOrgId) return null; // No org_id in request — row-level checks handle it
  if (sessionOrgId === requestOrgId) return null;
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Extracts the org_id from the request for tenant isolation checking.
 *
 * Checks (in order):
 *   1. Path segment: /api/orgs/:org_id/...
 *   2. Query parameter: ?org_id=...
 *
 * Returns undefined if no org_id is found (e.g., collection endpoints).
 */
export function extractRequestOrgId(req: Request): string | undefined {
  const url = new URL(req.url);

  // Check query param
  const queryOrgId = url.searchParams.get('org_id');
  if (queryOrgId) return queryOrgId;

  // Check path segments: /api/orgs/:org_id/...
  const pathMatch = url.pathname.match(/\/orgs\/([^/]+)/);
  if (pathMatch) return pathMatch[1];

  return undefined;
}

/**
 * Full auth gate: authenticate + RBAC + tenant isolation.
 *
 * Returns AuthContext on success, or a Response (401/403) on failure.
 * The optional `requestOrgId` is used for tenant isolation; if not provided,
 * extractRequestOrgId is called automatically.
 */
export async function requireAuth(
  req: Request,
  requestOrgId?: string,
): Promise<AuthContext | Response> {
  // Step 1: authenticate
  const authResult = await authenticateRequest(req);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;

  // Step 2: RBAC
  const rbacDenial = enforceRbac(claims.role, req);
  if (rbacDenial) return rbacDenial;

  // Step 3: tenant isolation
  const orgId = requestOrgId ?? extractRequestOrgId(req);
  const isolationDenial = enforceTenantIsolation(claims.org_id, orgId);
  if (isolationDenial) return isolationDenial;

  return authResult;
}

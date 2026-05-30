/**
 * Commission Management — Application-level RBAC
 *
 * Defines the six application roles and the permission matrix that maps
 * each role to the HTTP method + route-pattern combinations it may access.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, RBAC
 * Issue: feat: authentication, multi-tenant isolation, and RBAC for six roles
 */

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------

/** The six application roles supported by the commission management platform. */
export type AppRole =
  | 'FinanceAdmin'
  | 'Producer'
  | 'Manager'
  | 'Executive'
  | 'HR'
  | 'ExternalPartner';

export const APP_ROLES: AppRole[] = [
  'FinanceAdmin',
  'Producer',
  'Manager',
  'Executive',
  'HR',
  'ExternalPartner',
];

// ---------------------------------------------------------------------------
// Session token shape
// ---------------------------------------------------------------------------

/** Claims present in every session token. */
export interface SessionClaims {
  org_id: string;
  user_id: string;
  role: AppRole;
  jti: string;
  exp: number;
}

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------

export interface Permission {
  method: string | '*';
  /** Route prefix match — must start with / */
  pathPrefix: string;
}

/**
 * Role permission matrix.
 *
 * Each entry is a list of (method, pathPrefix) pairs that the role may access.
 * '*' matches any HTTP method.
 * Path matching uses prefix semantics: permission for /placements also covers /placements/123.
 */
export const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  FinanceAdmin: [
    // Finance admins can do everything
    { method: '*', pathPrefix: '/' },
  ],

  Producer: [
    // Producers can view and contribute to placements
    { method: 'GET', pathPrefix: '/placements' },
    { method: 'POST', pathPrefix: '/placements' },
    { method: 'PATCH', pathPrefix: '/placements' },
    { method: 'GET', pathPrefix: '/contributors' },
    { method: 'POST', pathPrefix: '/contributors' },
    { method: 'GET', pathPrefix: '/commission-records' },
    { method: 'GET', pathPrefix: '/commission-plans' },
    { method: 'GET', pathPrefix: '/plan-assignments' },
    { method: 'GET', pathPrefix: '/invoices' },
    // Producer Portal: own payout data
    { method: 'GET', pathPrefix: '/me' },
    { method: 'POST', pathPrefix: '/me/disputes' },
    // Disputes: submit and view own disputes (issue #18)
    { method: 'POST', pathPrefix: '/disputes' },
    { method: 'GET', pathPrefix: '/disputes' },
    { method: 'POST', pathPrefix: '/auth/logout' },
    { method: 'GET', pathPrefix: '/healthz' },
    { method: 'GET', pathPrefix: '/readyz' },
  ],

  Manager: [
    // Managers can approve exceptions and view all commission data
    { method: 'GET', pathPrefix: '/placements' },
    { method: 'POST', pathPrefix: '/placements' },
    { method: 'PATCH', pathPrefix: '/placements' },
    { method: 'GET', pathPrefix: '/contributors' },
    { method: 'POST', pathPrefix: '/contributors' },
    { method: 'PATCH', pathPrefix: '/contributors' },
    { method: 'GET', pathPrefix: '/commission-records' },
    { method: 'PATCH', pathPrefix: '/commission-records' },
    { method: 'GET', pathPrefix: '/commission-plans' },
    { method: 'GET', pathPrefix: '/plan-assignments' },
    { method: 'GET', pathPrefix: '/invoices' },
    { method: 'GET', pathPrefix: '/exceptions' },
    { method: 'PATCH', pathPrefix: '/exceptions' },
    // Manager Team View — issue #21
    { method: 'GET', pathPrefix: '/me/team' },
    { method: 'POST', pathPrefix: '/auth/logout' },
    { method: 'GET', pathPrefix: '/healthz' },
    { method: 'GET', pathPrefix: '/readyz' },
  ],

  Executive: [
    // Executives have read-only access to everything (analytics/reporting)
    { method: 'GET', pathPrefix: '/' },
    { method: 'POST', pathPrefix: '/auth/logout' },
  ],

  HR: [
    // HR can manage commission plans and producer assignments
    { method: 'GET', pathPrefix: '/commission-plans' },
    { method: 'POST', pathPrefix: '/commission-plans' },
    { method: 'PATCH', pathPrefix: '/commission-plans' },
    { method: 'GET', pathPrefix: '/plan-versions' },
    { method: 'POST', pathPrefix: '/plan-versions' },
    { method: 'GET', pathPrefix: '/plan-assignments' },
    { method: 'POST', pathPrefix: '/plan-assignments' },
    { method: 'DELETE', pathPrefix: '/plan-assignments' },
    { method: 'GET', pathPrefix: '/placements' },
    { method: 'GET', pathPrefix: '/contributors' },
    { method: 'GET', pathPrefix: '/commission-records' },
    { method: 'GET', pathPrefix: '/draw-balances' },
    { method: 'POST', pathPrefix: '/auth/logout' },
    { method: 'GET', pathPrefix: '/healthz' },
    { method: 'GET', pathPrefix: '/readyz' },
  ],

  ExternalPartner: [
    // External partners can only view placements they are associated with
    { method: 'GET', pathPrefix: '/placements' },
    { method: 'GET', pathPrefix: '/partner/placements' },
    { method: 'GET', pathPrefix: '/invoices' },
    { method: 'POST', pathPrefix: '/auth/logout' },
    { method: 'GET', pathPrefix: '/healthz' },
    { method: 'GET', pathPrefix: '/readyz' },
  ],
};

// ---------------------------------------------------------------------------
// Routes that require FinanceAdmin only
// ---------------------------------------------------------------------------

/** Route prefixes that only FinanceAdmin may POST to (used in RBAC integration tests). */
export const FINANCE_ADMIN_ONLY_ROUTES: { method: string; pathPrefix: string }[] = [
  { method: 'POST', pathPrefix: '/commission-runs' },
];

// ---------------------------------------------------------------------------
// Permission check helper
// ---------------------------------------------------------------------------

/**
 * Returns true when `role` is permitted to access `method` + `path`.
 *
 * Matching rules:
 *   1. method '*' matches any HTTP method.
 *   2. pathPrefix '/' matches any path.
 *   3. Otherwise, path must start with the permission's pathPrefix.
 */
export function isPermitted(role: AppRole, method: string, path: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;

  for (const perm of perms) {
    const methodMatch = perm.method === '*' || perm.method === method;
    const pathMatch = perm.pathPrefix === '/' || path.startsWith(perm.pathPrefix);
    if (methodMatch && pathMatch) return true;
  }

  return false;
}

/**
 * Returns a 403 Response describing the denied access, or null if access is allowed.
 */
export function checkPermission(
  role: AppRole,
  method: string,
  path: string,
): { denied: true; response: Response } | { denied: false } {
  if (isPermitted(role, method, path)) {
    return { denied: false };
  }
  return {
    denied: true,
    response: new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }),
  };
}

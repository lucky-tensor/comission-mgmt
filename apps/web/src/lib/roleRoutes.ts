/**
 * Role-to-routes mapping — single source of truth for app-shell routing.
 *
 * Every role has:
 *   - `landing`   — the default path to redirect to after successful login
 *   - `permitted` — all paths this role may navigate to (used by NavShell and
 *                   the forbidden-route guard in App.tsx)
 *   - `navItems`  — ordered list of nav entries to render for this role
 *
 * No component re-implements role gating; all import from this module.
 *
 * Canonical docs: docs/prd.md §3 (User Roles)
 * Routing seam contract: docs/web-app-ux.md — how to safely add a route (#197)
 *   or edit nav items (#198) without breaking the nav/permitted invariant.
 *   The invariant is pinned by apps/web/tests/roleRoutes.test.ts.
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100); dev-scout: Web App UX phase seam (#201)
 */

import type { AppRole } from 'core/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavItem {
  /** Route path (matches window.location.pathname). */
  path: string;
  /** Human-readable label for the nav element. */
  label: string;
}

export interface RoleRouteConfig {
  /** Default landing path immediately after login for this role. */
  landing: string;
  /** All paths this role is permitted to visit in the SPA. */
  permitted: Set<string>;
  /** Ordered nav items to render for this role. */
  navItems: NavItem[];
}

// ---------------------------------------------------------------------------
// Route path constants
// ---------------------------------------------------------------------------

export const ROUTES = {
  LOGIN: '/',
  PORTAL: '/portal',
  FINANCE: '/finance',
  RECONCILIATION: '/reconciliation',
  MANAGER: '/manager',
  EXECUTIVE: '/executive',
  EXEC_PROFITABILITY: '/executive/profitability',
  EXEC_TRENDS: '/executive/trends',
  HR: '/hr',
  PARTNER: '/partner',
  DOCS: '/docs',
} as const;

// ---------------------------------------------------------------------------
// Role configuration map
// ---------------------------------------------------------------------------

export const ROLE_ROUTES: Record<AppRole, RoleRouteConfig> = {
  Producer: {
    landing: ROUTES.PORTAL,
    permitted: new Set([ROUTES.PORTAL, ROUTES.DOCS]),
    navItems: [
      { path: ROUTES.PORTAL, label: 'My Portal' },
      { path: ROUTES.DOCS, label: 'Docs' },
    ],
  },

  FinanceAdmin: {
    landing: ROUTES.FINANCE,
    permitted: new Set([
      ROUTES.FINANCE,
      ROUTES.RECONCILIATION,
      ROUTES.PORTAL,
      ROUTES.HR,
      ROUTES.PARTNER,
      ROUTES.DOCS,
    ]),
    navItems: [
      { path: ROUTES.FINANCE, label: 'Finance Home' },
      { path: ROUTES.DOCS, label: 'Docs' },
    ],
  },

  Manager: {
    landing: ROUTES.MANAGER,
    permitted: new Set([ROUTES.MANAGER, ROUTES.DOCS]),
    navItems: [
      { path: ROUTES.MANAGER, label: 'Team View' },
      { path: ROUTES.DOCS, label: 'Docs' },
    ],
  },

  Executive: {
    landing: ROUTES.EXECUTIVE,
    permitted: new Set([
      ROUTES.EXECUTIVE,
      ROUTES.EXEC_PROFITABILITY,
      ROUTES.EXEC_TRENDS,
      ROUTES.FINANCE,
      ROUTES.DOCS,
    ]),
    navItems: [
      { path: ROUTES.EXECUTIVE, label: 'Executive Dashboard' },
      { path: ROUTES.DOCS, label: 'Docs' },
    ],
  },

  HR: {
    landing: ROUTES.HR,
    permitted: new Set([ROUTES.HR, ROUTES.DOCS]),
    navItems: [
      { path: ROUTES.HR, label: 'HR Home' },
      { path: ROUTES.DOCS, label: 'Docs' },
    ],
  },

  ExternalPartner: {
    landing: ROUTES.PARTNER,
    permitted: new Set([ROUTES.PARTNER, ROUTES.DOCS]),
    navItems: [
      { path: ROUTES.PARTNER, label: 'My Placements' },
      { path: ROUTES.DOCS, label: 'Docs' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Path matching helpers (prefix / child-route semantics — #203)
// ---------------------------------------------------------------------------

/**
 * Normalize a path for matching: strip the query string and hash, then drop a
 * trailing slash (except for the root '/'). This makes matching tolerant of
 * `/executive/`, `/executive?tab=x`, and `/disputes/abc123#note` alike.
 */
export function normalizePath(path: string): string {
  let p = path.split('?')[0].split('#')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/**
 * Returns true when `path` is `base` or a child route of `base`
 * (e.g. `/disputes` matches `/disputes/abc123`). The root '/' only ever
 * matches itself — it is never treated as a prefix of every path.
 *
 * Both arguments are normalized first, so trailing slashes and query strings
 * do not affect the result.
 */
export function pathMatchesPrefix(path: string, base: string): boolean {
  const p = normalizePath(path);
  const b = normalizePath(base);
  if (b === ROUTES.LOGIN) return p === ROUTES.LOGIN;
  if (p === b) return true;
  return p.startsWith(b + '/');
}

/**
 * Returns true if the given role is permitted to view `path` in the SPA.
 *
 * Matching is prefix-based: a permitted parent path also permits its detail
 * routes (e.g. a role permitted on `/disputes` may visit `/disputes/abc123`).
 * Trailing slashes and query strings never change the result. The login path
 * ('/') is always permitted.
 */
export function isPathPermitted(role: AppRole, path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized === ROUTES.LOGIN) return true;
  const config = ROLE_ROUTES[role];
  if (!config) return false;
  for (const permitted of config.permitted) {
    if (pathMatchesPrefix(normalized, permitted)) return true;
  }
  return false;
}

/**
 * Returns the nav item path that should be highlighted as active for the
 * current location, or null when none match. Uses prefix matching so a detail
 * route highlights its parent nav item; when several nav items match (e.g.
 * `/executive` and `/executive/profitability`) the most specific (longest)
 * base wins.
 */
export function activeNavPath(role: AppRole, currentPath: string): string | null {
  const config = ROLE_ROUTES[role];
  if (!config) return null;
  let best: string | null = null;
  for (const item of config.navItems) {
    if (pathMatchesPrefix(currentPath, item.path)) {
      if (best === null || item.path.length > best.length) best = item.path;
    }
  }
  return best;
}

/**
 * Returns the default landing path for the given role.
 */
export function landingPathForRole(role: AppRole): string {
  return ROLE_ROUTES[role]?.landing ?? ROUTES.LOGIN;
}

// ---------------------------------------------------------------------------
// Human-readable role labels (#203)
// ---------------------------------------------------------------------------

/**
 * Human-readable labels for the raw role enum. The header showed the bare enum
 * (`FinanceAdmin`, `ExternalPartner`); these are the labels a person reads.
 */
const ROLE_LABELS: Record<AppRole, string> = {
  Producer: 'Producer',
  FinanceAdmin: 'Finance Admin',
  Manager: 'Manager',
  Executive: 'Executive',
  HR: 'People Ops',
  ExternalPartner: 'External Partner',
};

/** Returns the human role label, falling back to the raw enum if unknown. */
export function roleLabel(role: AppRole): string {
  return ROLE_LABELS[role] ?? role;
}

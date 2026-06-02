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
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
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
  HR: '/hr',
  PARTNER: '/partner',
} as const;

// ---------------------------------------------------------------------------
// Role configuration map
// ---------------------------------------------------------------------------

export const ROLE_ROUTES: Record<AppRole, RoleRouteConfig> = {
  Producer: {
    landing: ROUTES.PORTAL,
    permitted: new Set([ROUTES.PORTAL]),
    navItems: [{ path: ROUTES.PORTAL, label: 'My Portal' }],
  },

  FinanceAdmin: {
    landing: ROUTES.FINANCE,
    permitted: new Set([
      ROUTES.FINANCE,
      ROUTES.RECONCILIATION,
      ROUTES.PORTAL,
      ROUTES.MANAGER,
      ROUTES.EXECUTIVE,
      ROUTES.HR,
      ROUTES.PARTNER,
    ]),
    navItems: [
      { path: ROUTES.FINANCE, label: 'Finance Home' },
      { path: ROUTES.RECONCILIATION, label: 'Reconciliation' },
      { path: ROUTES.MANAGER, label: 'Manager View' },
      { path: ROUTES.EXECUTIVE, label: 'Executive View' },
    ],
  },

  Manager: {
    landing: ROUTES.MANAGER,
    permitted: new Set([ROUTES.MANAGER, ROUTES.PORTAL]),
    navItems: [
      { path: ROUTES.MANAGER, label: 'Team View' },
      { path: ROUTES.PORTAL, label: 'Producer Portal' },
    ],
  },

  Executive: {
    landing: ROUTES.EXECUTIVE,
    permitted: new Set([ROUTES.EXECUTIVE, ROUTES.FINANCE, ROUTES.MANAGER]),
    navItems: [
      { path: ROUTES.EXECUTIVE, label: 'Executive Dashboard' },
      { path: ROUTES.FINANCE, label: 'Finance View' },
    ],
  },

  HR: {
    landing: ROUTES.HR,
    permitted: new Set([ROUTES.HR]),
    navItems: [{ path: ROUTES.HR, label: 'HR Home' }],
  },

  ExternalPartner: {
    landing: ROUTES.PARTNER,
    permitted: new Set([ROUTES.PARTNER]),
    navItems: [{ path: ROUTES.PARTNER, label: 'My Placements' }],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the given role is permitted to view `path` in the SPA.
 * Always returns true for the login path ('/').
 */
export function isPathPermitted(role: AppRole, path: string): boolean {
  if (path === ROUTES.LOGIN) return true;
  return ROLE_ROUTES[role]?.permitted.has(path) ?? false;
}

/**
 * Returns the default landing path for the given role.
 */
export function landingPathForRole(role: AppRole): string {
  return ROLE_ROUTES[role]?.landing ?? ROUTES.LOGIN;
}

/**
 * Role routing seam — prefix / child-route matching (#203).
 *
 * The original seam used exact-string matching on a Set, so any detail route
 * (e.g. /disputes/:id, /executive/profitability) either needed its own nav
 * entry or broke both highlighting and gating. This suite pins the prefix
 * semantics the NavShell rebuild and the Forbidden guard depend on:
 *   - a child path is permitted and highlights its parent nav item
 *   - trailing slashes and query strings never change active or permitted state
 *   - the root '/' is never treated as a prefix of every path
 *
 * Pure node test (no browser): the routing seam is plain data + helpers.
 * Run: `bun run test:webapp-ux`
 */

import { describe, test, expect } from 'vitest';
import {
  ROUTES,
  ROLE_ROUTES,
  isPathPermitted,
  activeNavPath,
  normalizePath,
  pathMatchesPrefix,
  roleLabel,
  tabFromPath,
  pathForTab,
} from '../src/lib/roleRoutes';

describe('normalizePath', () => {
  test('strips query strings and hashes', () => {
    expect(normalizePath('/executive?tab=x')).toBe('/executive');
    expect(normalizePath('/disputes/abc#note')).toBe('/disputes/abc');
  });

  test('drops a trailing slash except for root', () => {
    expect(normalizePath('/executive/')).toBe('/executive');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });
});

describe('pathMatchesPrefix', () => {
  test('a base matches itself and its children', () => {
    expect(pathMatchesPrefix('/disputes', '/disputes')).toBe(true);
    expect(pathMatchesPrefix('/disputes/abc123', '/disputes')).toBe(true);
  });

  test('a sibling prefix that is not a path segment boundary does not match', () => {
    // /disputes must not match /dispute (no false prefix on partial segments)
    expect(pathMatchesPrefix('/disputesomething', '/disputes')).toBe(false);
  });

  test('root never acts as a prefix of every path', () => {
    expect(pathMatchesPrefix('/finance', '/')).toBe(false);
    expect(pathMatchesPrefix('/', '/')).toBe(true);
  });

  test('trailing slashes and query strings are tolerated', () => {
    expect(pathMatchesPrefix('/disputes/abc/?x=1', '/disputes')).toBe(true);
    expect(pathMatchesPrefix('/executive/', '/executive')).toBe(true);
  });
});

describe('isPathPermitted — prefix gating', () => {
  test('a permitted parent permits its detail routes', () => {
    // Executive is permitted on /executive/profitability; a detail route under
    // it must also be permitted.
    expect(isPathPermitted('Executive', '/executive/profitability/clientX')).toBe(true);
  });

  test('trailing slash and query string do not break permitted state', () => {
    expect(isPathPermitted('Executive', `${ROUTES.EXECUTIVE}/`)).toBe(true);
    expect(isPathPermitted('Executive', `${ROUTES.EXECUTIVE}?tab=x`)).toBe(true);
  });

  test('a path outside the role config is still denied', () => {
    expect(isPathPermitted('Producer', ROUTES.FINANCE)).toBe(false);
    expect(isPathPermitted('Producer', '/finance/anything')).toBe(false);
  });

  test('login is always permitted', () => {
    expect(isPathPermitted('Producer', ROUTES.LOGIN)).toBe(true);
  });
});

describe('activeNavPath — highlight by prefix', () => {
  test('a child path highlights its parent nav item', () => {
    // Producer has /portal; a detail route highlights /portal.
    expect(activeNavPath('Producer', '/portal/placements/abc')).toBe(ROUTES.PORTAL);
  });

  test('the most specific (longest) matching nav item wins', () => {
    // Executive nav has both /executive and /executive/profitability.
    expect(activeNavPath('Executive', '/executive/profitability')).toBe(ROUTES.EXEC_PROFITABILITY);
    expect(activeNavPath('Executive', '/executive')).toBe(ROUTES.EXECUTIVE);
  });

  test('trailing slash / query string still resolve the active item', () => {
    expect(activeNavPath('Executive', '/executive/profitability/?sort=desc')).toBe(
      ROUTES.EXEC_PROFITABILITY,
    );
  });

  test('a path matching no nav item returns null', () => {
    expect(activeNavPath('Producer', '/finance')).toBeNull();
  });
});

describe('roleLabel — human role labels', () => {
  test('maps enum roles to human labels', () => {
    expect(roleLabel('FinanceAdmin')).toBe('Finance Admin');
    expect(roleLabel('ExternalPartner')).toBe('External Partner');
    expect(roleLabel('HR')).toBe('People Ops');
    expect(roleLabel('Producer')).toBe('Producer');
  });
});

describe('tab <-> path mapping (Finance / Executive sub-path tabs)', () => {
  test('the bare base path resolves to the default tab', () => {
    expect(tabFromPath('/finance', ROUTES.FINANCE, 'processing')).toBe('processing');
    expect(tabFromPath('/executive', ROUTES.EXECUTIVE, 'dashboard')).toBe('dashboard');
  });

  test('a sub-path resolves to its tab id (trailing slash / query tolerated)', () => {
    expect(tabFromPath('/finance/cases', ROUTES.FINANCE, 'processing')).toBe('cases');
    expect(tabFromPath('/finance/reconciliation/', ROUTES.FINANCE, 'processing')).toBe(
      'reconciliation',
    );
    expect(tabFromPath('/executive/trends?sort=desc', ROUTES.EXECUTIVE, 'dashboard')).toBe(
      'trends',
    );
  });

  test('a path outside the base falls back to the default tab', () => {
    // The Finance view embedded in the Executive dashboard must not pick up an
    // executive path as one of its own tabs.
    expect(tabFromPath('/executive/finance', ROUTES.FINANCE, 'processing')).toBe('processing');
  });

  test('pathForTab is the inverse: default tab -> base, others -> sub-path', () => {
    expect(pathForTab('processing', ROUTES.FINANCE, 'processing')).toBe('/finance');
    expect(pathForTab('cases', ROUTES.FINANCE, 'processing')).toBe('/finance/cases');
    expect(pathForTab('dashboard', ROUTES.EXECUTIVE, 'dashboard')).toBe('/executive');
    expect(pathForTab('trends', ROUTES.EXECUTIVE, 'dashboard')).toBe('/executive/trends');
  });

  test('round-trips for every Finance tab path', () => {
    for (const tab of ['processing', 'cases', 'adjustments', 'reconciliation']) {
      const path = pathForTab(tab, ROUTES.FINANCE, 'processing');
      expect(tabFromPath(path, ROUTES.FINANCE, 'processing')).toBe(tab);
    }
  });
});

describe('Finance nav consolidation — no duplicate Reconciliation', () => {
  test('Reconciliation is a Finance sub-path, not a top-level route', () => {
    // The old top-level /reconciliation route is gone; it now lives under finance.
    expect((ROUTES as Record<string, string>).RECONCILIATION).toBeUndefined();
    expect(ROUTES.FINANCE_RECONCILIATION).toBe('/finance/reconciliation');
  });

  test('each Finance tab is its own sidebar nav item under /finance', () => {
    const paths = ROLE_ROUTES.FinanceAdmin.navItems.map((i) => i.path);
    expect(paths).toContain(ROUTES.FINANCE); // Processing
    expect(paths).toContain(ROUTES.FINANCE_CASES);
    expect(paths).toContain(ROUTES.FINANCE_ADJUSTMENTS);
    expect(paths).toContain(ROUTES.FINANCE_RECONCILIATION);
    // No nav item points outside the /finance (or /docs) surfaces.
    for (const p of paths) {
      expect(p === ROUTES.DOCS || p.startsWith('/finance')).toBe(true);
    }
  });

  test('a Finance sub-path highlights its own nav item, not Processing', () => {
    expect(activeNavPath('FinanceAdmin', '/finance/reconciliation')).toBe(
      ROUTES.FINANCE_RECONCILIATION,
    );
    expect(activeNavPath('FinanceAdmin', '/finance/cases')).toBe(ROUTES.FINANCE_CASES);
    // The bare base highlights Processing.
    expect(activeNavPath('FinanceAdmin', '/finance')).toBe(ROUTES.FINANCE);
  });
});

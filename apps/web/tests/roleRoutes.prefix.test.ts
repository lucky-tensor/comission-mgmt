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
  isPathPermitted,
  activeNavPath,
  normalizePath,
  pathMatchesPrefix,
  roleLabel,
} from '../src/lib/roleRoutes';
import { splitNavItems } from '../src/components/NavShell';

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

describe('splitNavItems — overflow grouping past five items', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);

  test('items within the cap stay inline (no overflow)', () => {
    for (const n of [0, 1, 4, 5]) {
      const { visible, overflow } = splitNavItems(items(n));
      expect(visible).toHaveLength(n);
      expect(overflow).toHaveLength(0);
    }
  });

  test('more than five items fold the trailing items into the overflow', () => {
    // 6 items: 4 visible + a More toggle slot, 2 in the overflow.
    const { visible, overflow } = splitNavItems(items(6));
    expect(visible).toEqual(['i0', 'i1', 'i2', 'i3']);
    expect(overflow).toEqual(['i4', 'i5']);
  });

  test('the cap is configurable', () => {
    const { visible, overflow } = splitNavItems(items(4), 3);
    expect(visible).toEqual(['i0', 'i1']);
    expect(overflow).toEqual(['i2', 'i3']);
  });
});

/**
 * Role routing seam — unit tests (dev-scout #201, phase: Web App UX).
 *
 * These tests pin the public contract of `apps/web/src/lib/roleRoutes.ts`, the
 * single source of truth for app-shell routing. They are the regression net that
 * the Web App UX phase work builds on:
 *   - #198 (nav cleanup) will edit `navItems` arrays — these tests assert that
 *     every nav item path is also a permitted path, so a removed/renamed route
 *     can never leave a dangling nav entry.
 *   - #197 (product docs) may add a docs route — these tests assert the
 *     landing/permitted invariants any new route must satisfy.
 *
 * Scope note (dev-scout): this scout adds NO runtime behavior. It verifies the
 * EXISTING routing seam and documents how to extend it safely. See
 * docs/web-app-ux.md for the seam contract.
 *
 * Run: `bun run test:webapp-ux`
 */

import { describe, test, expect } from 'vitest';
import { APP_ROLES, type AppRole } from 'core/auth';
import { ROLE_ROUTES, ROUTES, isPathPermitted, landingPathForRole } from '../src/lib/roleRoutes';

describe('roleRoutes seam — landingPathForRole', () => {
  test('every role has a landing path that is one of its permitted paths', () => {
    for (const role of APP_ROLES) {
      const landing = landingPathForRole(role);
      expect(isPathPermitted(role, landing)).toBe(true);
    }
  });

  test('a role with no config falls back to the login path', () => {
    expect(landingPathForRole('NotARole' as AppRole)).toBe(ROUTES.LOGIN);
  });

  test('every role lands on its first listed nav item', () => {
    for (const role of APP_ROLES) {
      const config = ROLE_ROUTES[role];
      expect(
        config.landing,
        `landing for role ${role} must equal its first nav item (${config.navItems[0]?.path})`,
      ).toBe(config.navItems[0]?.path);
    }
  });
});

describe('roleRoutes seam — isPathPermitted', () => {
  test('the login path is permitted for every role', () => {
    for (const role of APP_ROLES) {
      expect(isPathPermitted(role, ROUTES.LOGIN)).toBe(true);
    }
  });

  test('a path outside a role config is denied', () => {
    // Producer may only see the portal; the finance route must be denied.
    expect(isPathPermitted('Producer', ROUTES.FINANCE)).toBe(false);
  });

  test('an unknown role is denied every non-login path', () => {
    expect(isPathPermitted('NotARole' as AppRole, ROUTES.FINANCE)).toBe(false);
  });
});

describe('roleRoutes seam — nav/permitted invariant (guards #198 nav cleanup)', () => {
  test('every nav item path for a role is also a permitted path for that role', () => {
    for (const role of APP_ROLES) {
      const config = ROLE_ROUTES[role];
      for (const item of config.navItems) {
        expect(
          config.permitted.has(item.path),
          `nav item ${item.path} for role ${role} is not in its permitted set`,
        ).toBe(true);
      }
    }
  });

  test('every configured role exposes the full RoleRouteConfig shape', () => {
    for (const role of APP_ROLES) {
      const config = ROLE_ROUTES[role];
      expect(typeof config.landing).toBe('string');
      expect(config.permitted instanceof Set).toBe(true);
      expect(Array.isArray(config.navItems)).toBe(true);
    }
  });
});

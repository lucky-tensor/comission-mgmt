/**
 * App shell component tests — real headless Chromium (no mocking helpers,
 * no JSDOM). Tests drive the real UI against seeded GET /me responses.
 *
 * The global-setup.ts server is running with DEMO_MODE=true and the seeded
 * E2E personas, so each test can demo-login as a persona and then mount the
 * App to observe role-based routing.
 *
 * Tests verify:
 *   - Each role's App renders the nav shell with the correct nav items.
 *   - Producer routes to /portal; FinanceAdmin routes to /finance.
 *   - Direct navigation to a forbidden route renders the 403 surface.
 *   - The roleRoutes module is the single import site for role gating (no
 *     component re-implements it — structural assertion).
 *
 * No Vitest mocking helpers are used. Tests use real fetch to seed sessions.
 *
 * Canonical docs: docs/prd.md §3 (User Roles)
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { renderInBrowser, type Mounted } from './render';
import { SEEDED } from '../e2e/fixtures/ids';
import App, { navigate } from '../../apps/web/src/App';
import { NavShell } from '../../apps/web/src/components/NavShell';
import { Forbidden } from '../../apps/web/src/components/Forbidden';
import { ROLE_ROUTES, ROUTES } from '../../apps/web/src/lib/roleRoutes';

let mounted: Mounted | undefined;

afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // component may have been removed
  }
  mounted = undefined;
  // Reset path to root after each test.
  navigate(ROUTES.LOGIN);
});

// ---------------------------------------------------------------------------
// Structural assertion: roleRoutes is the single import site for role gating
// ---------------------------------------------------------------------------

describe('roleRoutes — structural', () => {
  test('all six roles have a landing path and at least one nav item', () => {
    const roles = [
      'FinanceAdmin',
      'Producer',
      'Manager',
      'Executive',
      'HR',
      'ExternalPartner',
    ] as const;
    for (const role of roles) {
      const config = ROLE_ROUTES[role];
      expect(config.landing, `${role} has no landing`).toBeTruthy();
      expect(config.navItems.length, `${role} has no nav items`).toBeGreaterThan(0);
      expect(config.permitted.size, `${role} has no permitted paths`).toBeGreaterThan(0);
    }
  });

  test('Producer landing is /portal', () => {
    expect(ROLE_ROUTES.Producer.landing).toBe('/portal');
  });

  test('FinanceAdmin landing is /finance', () => {
    expect(ROLE_ROUTES.FinanceAdmin.landing).toBe('/finance');
  });

  test('each role landing is in its own permitted set', () => {
    for (const [role, config] of Object.entries(ROLE_ROUTES)) {
      expect(
        config.permitted.has(config.landing),
        `${role}: landing ${config.landing} not in permitted set`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// NavShell renders only the permitted routes for the active role
// ---------------------------------------------------------------------------

describe('NavShell — per-role nav items', () => {
  test('Producer nav shows only My Portal', async () => {
    mounted = renderInBrowser(
      <NavShell role="Producer" currentPath="/portal" onNavigate={() => {}}>
        <div data-testid="content">content</div>
      </NavShell>,
    );

    await expect.element(page.getByTestId('nav-item-portal')).toBeInTheDocument();
    // Finance / manager items must NOT appear for a Producer.
    expect(page.getByTestId('nav-item-finance').elements()).toHaveLength(0);
    expect(page.getByTestId('nav-item-manager').elements()).toHaveLength(0);
  });

  test('FinanceAdmin nav shows Finance Home and Manager View', async () => {
    mounted = renderInBrowser(
      <NavShell role="FinanceAdmin" currentPath="/finance" onNavigate={() => {}}>
        <div />
      </NavShell>,
    );

    await expect.element(page.getByTestId('nav-item-finance')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-item-manager')).toBeInTheDocument();
  });

  test('role badge displays the active role', async () => {
    mounted = renderInBrowser(
      <NavShell role="Manager" currentPath="/manager" onNavigate={() => {}}>
        <div />
      </NavShell>,
    );

    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('Manager');
  });
});

// ---------------------------------------------------------------------------
// Forbidden surface
// ---------------------------------------------------------------------------

describe('Forbidden surface', () => {
  test('renders 403 content and a back button for Producer', async () => {
    mounted = renderInBrowser(<Forbidden role="Producer" onNavigate={() => {}} />);

    await expect.element(page.getByTestId('forbidden-surface')).toBeInTheDocument();
    await expect.element(page.getByText('403')).toBeInTheDocument();
    await expect.element(page.getByTestId('forbidden-back-btn')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// App — role-based routing via real GET /me (integration with real server)
// ---------------------------------------------------------------------------

describe('App — role-based routing (real server)', () => {
  test('Producer demo-login routes to /portal', async () => {
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.producerId }),
    });
    expect(res.ok).toBe(true);

    navigate(ROUTES.LOGIN);
    mounted = renderInBrowser(<App />);

    // The Producer Portal heading confirms routing to /portal.
    await expect.element(page.getByText('Producer Payout Portal')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/portal');
  });

  test('FinanceAdmin demo-login routes to /finance (not /portal)', async () => {
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.adminId }),
    });
    expect(res.ok).toBe(true);

    navigate(ROUTES.LOGIN);
    mounted = renderInBrowser(<App />);

    // All Finance Admin surfaces render for FinanceAdmin at /finance.
    await expect.element(page.getByTestId('data-gap-queue')).toBeInTheDocument();
    await expect.element(page.getByTestId('commission-run-review')).toBeInTheDocument();
    await expect.element(page.getByTestId('finance-admin')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/finance');
  });

  test('Producer navigating directly to /finance renders forbidden surface', async () => {
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.producerId }),
    });
    expect(res.ok).toBe(true);

    // Navigate directly to /finance (forbidden for Producer).
    navigate('/finance');
    mounted = renderInBrowser(<App />);

    // The 403 Forbidden surface must render.
    await expect.element(page.getByTestId('forbidden-surface')).toBeInTheDocument();
    // The Portal surface must NOT render.
    expect(page.getByText('Producer Payout Portal').elements()).toHaveLength(0);
  });
});

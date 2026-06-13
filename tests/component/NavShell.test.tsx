/**
 * NavShell component tests — real headless Chromium (no mocking helpers).
 *
 * Covers the NavShell rebuild (#203, docs/ux-review.md):
 *   - every nav item renders as an <a> with a valid href
 *   - the active item keeps aria-current="page" (prefix-matched)
 *   - the nav exposes its aria-label and per-item test IDs
 *   - a child/detail route highlights its parent nav item
 *   - the header shows the persona name + human role label
 *   - more than five items collapse into an overflow ("More") menu
 *
 * Issue: feat: webapp — UX overhaul: NavShell rebuild (#203)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { renderInBrowser, type Mounted } from './render';
import { NavShell } from '../../apps/web/src/components/NavShell';

let mounted: Mounted | undefined;
afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // already removed
  }
  mounted = undefined;
});

function render(props: Partial<Parameters<typeof NavShell>[0]> = {}) {
  mounted = renderInBrowser(
    <NavShell
      role={props.role ?? 'Executive'}
      currentPath={props.currentPath ?? '/executive'}
      onNavigate={props.onNavigate ?? (() => {})}
      onLogout={props.onLogout ?? (() => {})}
      personaName={props.personaName}
    >
      <div data-testid="page-body">body</div>
    </NavShell>,
  );
}

describe('NavShell — anchors and accessibility', () => {
  test('the nav exposes its aria-label', async () => {
    render({ role: 'Producer', currentPath: '/portal' });
    const nav = page.getByTestId('nav-bar');
    await expect.element(nav).toBeInTheDocument();
    expect(nav.element()?.getAttribute('aria-label')).toBe('Main navigation');
  });

  test('every nav item renders as an <a> with a valid href and a per-item test id', async () => {
    render({ role: 'Producer', currentPath: '/portal' });
    const portal = page.getByTestId('nav-item-portal');
    const docs = page.getByTestId('nav-item-docs');
    await expect.element(portal).toBeInTheDocument();
    await expect.element(docs).toBeInTheDocument();

    const portalEl = portal.element() as HTMLAnchorElement;
    const docsEl = docs.element() as HTMLAnchorElement;
    expect(portalEl.tagName).toBe('A');
    expect(docsEl.tagName).toBe('A');
    expect(portalEl.getAttribute('href')).toBe('/portal');
    expect(docsEl.getAttribute('href')).toBe('/docs');
  });

  test('the active item carries aria-current="page" and others do not', async () => {
    render({ role: 'Producer', currentPath: '/portal' });
    const portal = page.getByTestId('nav-item-portal').element() as HTMLAnchorElement;
    const docs = page.getByTestId('nav-item-docs').element() as HTMLAnchorElement;
    expect(portal.getAttribute('aria-current')).toBe('page');
    expect(docs.getAttribute('aria-current')).toBeNull();
  });

  test('a child/detail route highlights its parent nav item', async () => {
    // /portal/placements/abc must keep the /portal nav item active.
    render({ role: 'Producer', currentPath: '/portal/placements/abc' });
    const portal = page.getByTestId('nav-item-portal').element() as HTMLAnchorElement;
    expect(portal.getAttribute('aria-current')).toBe('page');
  });

  test('intercepted left-click calls onNavigate instead of a full navigation', async () => {
    let navigatedTo: string | null = null;
    render({
      role: 'Producer',
      currentPath: '/portal',
      onNavigate: (p) => {
        navigatedTo = p;
      },
    });
    await page.getByTestId('nav-item-docs').click();
    expect(navigatedTo).toBe('/docs');
  });
});

describe('NavShell — header role badge', () => {
  test('shows the human role label when no persona name is given', async () => {
    render({ role: 'FinanceAdmin', currentPath: '/finance' });
    const badge = page.getByTestId('nav-role-badge');
    await expect.element(badge).toBeInTheDocument();
    expect(badge.element()?.textContent).toBe('Finance Admin');
  });

  test('shows "<persona> · <role>" when a persona name is given', async () => {
    render({ role: 'FinanceAdmin', currentPath: '/finance', personaName: 'Jordan Lee' });
    const badge = page.getByTestId('nav-role-badge');
    await expect.element(badge).toBeInTheDocument();
    expect(badge.element()?.textContent).toBe('Jordan Lee · Finance Admin');
  });
});

describe('NavShell — overflow', () => {
  test('Executive (four nav items, below the cap) renders all items inline with no overflow', async () => {
    // Executive has 4 nav items (Dashboard, Profitability, Trends, Docs)
    // — below the cap of 5, so nothing collapses into overflow.
    render({ role: 'Executive', currentPath: '/executive' });
    await expect.element(page.getByTestId('nav-item-executive')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-item-docs')).toBeInTheDocument();
    expect(page.getByTestId('nav-overflow-toggle').elements()).toHaveLength(0);
  });
  // The >5 overflow split itself is unit-tested via splitNavItems in
  // apps/web/tests/roleRoutes.prefix.test.ts (no six-item role exists yet).
});

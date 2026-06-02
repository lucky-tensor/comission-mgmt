/**
 * App shell E2E test — real headless Chromium against the real API server +
 * ephemeral Postgres started by global-setup.ts. No mocks.
 *
 * Verifies:
 *   1. Demo-login as Finance Admin lands on /finance (not /portal).
 *   2. Demo-login as Producer lands on /portal.
 *   3. Finance Admin and Producer land on DIFFERENT routes.
 *
 * The whole data path is real: fetch() hits `/api/*`, the Vitest dev server
 * proxies to the running server with real Postgres.
 *
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';
import { SEEDED } from './fixtures/ids';
import App, { navigate } from '../../apps/web/src/App';

/** Mount the root App into the document and return an unmount callback. */
function mountApp(): () => void {
  const container = document.createElement('div');
  container.id = 'app-shell-e2e-root';
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(createElement(App));
  });
  return () => {
    container.remove();
  };
}

describe('App shell E2E — role-based routing', () => {
  let unmount: () => void;

  beforeEach(() => {
    // Return to root before each test.
    navigate('/');
  });

  test('Finance Admin demo-login lands on /finance', async () => {
    // Log in as finance admin at the API level first.
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.adminId }),
    });
    expect(res.ok).toBe(true);

    // Mount the App — it calls GET /me, reads FinanceAdmin role, redirects to /finance.
    unmount = mountApp();

    // The nav shell renders with the Finance Home surface.
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('finance-home')).toBeInTheDocument();

    // The nav badge shows the role.
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('FinanceAdmin');

    // The current path in the browser should be /finance.
    expect(window.location.pathname).toBe('/finance');

    unmount();
  });

  test('Producer demo-login lands on /portal', async () => {
    // Log in as producer.
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.producerId }),
    });
    expect(res.ok).toBe(true);

    navigate('/');
    unmount = mountApp();

    // The Producer Portal surface renders.
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByText('Producer Payout Portal')).toBeInTheDocument();

    // The nav badge shows the role.
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('Producer');

    // The current path should be /portal.
    expect(window.location.pathname).toBe('/portal');

    unmount();
  });

  test('Finance Admin and Producer land on different routes', async () => {
    // Finance admin.
    const adminRes = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.adminId }),
    });
    expect(adminRes.ok).toBe(true);

    navigate('/');
    let u = mountApp();
    await expect.element(page.getByTestId('finance-home')).toBeInTheDocument();
    const adminPath = window.location.pathname;
    u();

    // Producer.
    const prodRes = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.producerId }),
    });
    expect(prodRes.ok).toBe(true);

    navigate('/');
    u = mountApp();
    await expect.element(page.getByText('Producer Payout Portal')).toBeInTheDocument();
    const producerPath = window.location.pathname;
    u();

    expect(adminPath).not.toBe(producerPath);
    expect(adminPath).toBe('/finance');
    expect(producerPath).toBe('/portal');
  });
});

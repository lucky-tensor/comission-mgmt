/**
 * Login component tests — real headless Chromium (no mocks, no JSDOM).
 *
 * Tests cover:
 *   - Form render with heading, tabs, and demo section (loaded from the real
 *     /api/demo/users endpoint started by global-setup.ts).
 *   - Demo-login path: the component renders demo user buttons and the
 *     underlying /api/demo/session endpoint accepts the seeded producer's id
 *     (verified by a direct fetch so navigation does not destroy the DOM
 *     context mid-test).
 *   - Error state: clicking "Register Passkey" with no username triggers the
 *     RegisterPasskeyButton's client-side validation, which calls onError and
 *     causes Login to render the inline error box.
 *
 * Canonical docs: docs/prd.md
 * Issue: test: auth UI component tests — Login.tsx and PasskeyButton.tsx (#88)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import Login from '../../apps/web/src/components/Login';
import { renderInBrowser, type Mounted } from './render';
import { SEEDED } from '../e2e/fixtures/ids';

let mounted: Mounted | undefined;
afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // component may have been removed if navigation occurred
  }
  mounted = undefined;
});

describe('Login', () => {
  test('renders the form with heading, tabs, and demo section', async () => {
    mounted = renderInBrowser(<Login />);

    // Heading and tabs are present immediately.
    await expect.element(page.getByText('Commission Management')).toBeInTheDocument();
    await expect.element(page.getByTestId('tab-register')).toBeInTheDocument();
    await expect.element(page.getByTestId('tab-signin')).toBeInTheDocument();

    // Demo section loads from the real /api/demo/users endpoint.
    // The global-setup server runs with DEMO_MODE=true and the seeded producer
    // persona, so this appears within the 60 s test timeout.
    await expect.element(page.getByTestId('demo-section')).toBeInTheDocument();

    // At least one demo user button is rendered.
    const demoSection = page.getByTestId('demo-section');
    const firstDemoBtn = demoSection.getByRole('button').first();
    await expect.element(firstDemoBtn).toBeInTheDocument();
  });

  test('demo-login path: /api/demo/session accepts the seeded producer id and returns 200', async () => {
    // Verify the demo session endpoint at the API level — this is the same
    // call Login makes when a demo user button is clicked. We invoke it
    // directly so that window.location.href = '/portal' (which would navigate
    // the Chromium page and tear down the test context) is not triggered.
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.producerId }),
    });
    expect(res.ok).toBe(true);

    const body = (await res.json()) as { ok: boolean; role: string };
    expect(body.ok).toBe(true);
    expect(body.role).toBeTruthy();

    // Confirm the Login component renders demo buttons for this session to
    // be reachable from the UI.
    mounted = renderInBrowser(<Login />);
    await expect.element(page.getByTestId('demo-section')).toBeInTheDocument();
  });

  test('error state: clicking Register Passkey with no username shows an inline error', async () => {
    mounted = renderInBrowser(<Login />);

    // Switch to the Register tab.
    await userEvent.click(page.getByTestId('tab-register'));

    // Confirm the username input is visible.
    await expect.element(page.getByLabelText('Email / Username')).toBeInTheDocument();

    // Click Register Passkey without filling in a username. The
    // RegisterPasskeyButton component calls onError('Username is required'),
    // which Login's handleError records in state, rendering the error box.
    await userEvent.click(page.getByTestId('register-passkey-btn'));

    // The inline error box should appear with the validation message.
    await expect.element(page.getByTestId('login-error')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('login-error'))
      .toHaveTextContent('Username is required');
  });
});

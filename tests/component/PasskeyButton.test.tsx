/**
 * PasskeyButton component tests — real headless Chromium (no mocks, no JSDOM).
 *
 * Tests cover: button visibility for RegisterPasskeyButton and PasskeyLoginButton,
 * click handler behaviour (WebAuthn ceremony invocation in real browser),
 * and the passkey-unavailable fallback rendered when window.PublicKeyCredential
 * is absent.
 *
 * The WebAuthn click test works as follows: clicking the register button with a
 * username calls startRegistration, which calls navigator.credentials.create.
 * Headless Chromium supports the WebAuthn API but has no software authenticator,
 * so the ceremony throws (typically "The operation either timed out or was not
 * allowed."). The component catches this error and forwards it to onError.
 * We assert onError was called — proving the ceremony was invoked — by storing
 * the error message in a plain closure variable (no Vitest mock API).
 *
 * The unavailable test temporarily removes window.PublicKeyCredential before
 * rendering and restores it after, using Object.defineProperty on the real
 * browser global — no Vitest mock API involved.
 *
 * Canonical docs: docs/prd.md
 * Issue: test: auth UI component tests — Login.tsx and PasskeyButton.tsx (#88)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import {
  RegisterPasskeyButton,
  PasskeyLoginButton,
} from '../../apps/web/src/components/PasskeyButton';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// RegisterPasskeyButton
// ---------------------------------------------------------------------------

describe('RegisterPasskeyButton', () => {
  test('renders the register passkey button', async () => {
    mounted = renderInBrowser(<RegisterPasskeyButton username="test@example.com" />);
    await expect.element(page.getByTestId('register-passkey-btn')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('register-passkey-btn'))
      .toHaveTextContent('Register Passkey');
  });

  test('click invokes the WebAuthn ceremony start (navigator.credentials.create called)', async () => {
    // Capture the error forwarded from the ceremony. A plain closure variable
    // is used — no Vitest mock APIs (mock-ban gate, TEST-C-001).
    let receivedError = '';
    const onError = (msg: string) => {
      receivedError = msg;
    };

    mounted = renderInBrowser(
      <RegisterPasskeyButton username="test@example.com" onError={onError} />,
    );

    await expect.element(page.getByTestId('register-passkey-btn')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('register-passkey-btn'));

    // Wait for the ceremony to attempt and fail (headless Chromium has no
    // software authenticator so navigator.credentials.create throws).
    // The default testTimeout is 60 s; this should resolve in a few seconds.
    await expect.poll(() => receivedError, { timeout: 15_000 }).not.toBe('');

    // The error message confirms that the ceremony was attempted.
    // Chromium raises a NotAllowedError or AbortError when there is no authenticator.
    expect(receivedError).toBeTruthy();
  });

  test('renders unavailable fallback when WebAuthn API is absent', async () => {
    // Temporarily remove PublicKeyCredential from the global scope.
    // Object.defineProperty is plain JS — not a Vitest mock API.
    const saved = (window as unknown as Record<string, unknown>).PublicKeyCredential;
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      mounted = renderInBrowser(<RegisterPasskeyButton username="" />);
      await expect.element(page.getByTestId('passkey-unavailable')).toBeInTheDocument();
      await expect
        .element(page.getByTestId('passkey-unavailable'))
        .toHaveTextContent('Passkeys are not supported in this browser');
    } finally {
      // Restore
      Object.defineProperty(window, 'PublicKeyCredential', {
        configurable: true,
        writable: true,
        value: saved,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// PasskeyLoginButton
// ---------------------------------------------------------------------------

describe('PasskeyLoginButton', () => {
  test('renders the sign-in passkey button', async () => {
    mounted = renderInBrowser(<PasskeyLoginButton />);
    await expect.element(page.getByTestId('login-passkey-btn')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('login-passkey-btn'))
      .toHaveTextContent('Sign in with Passkey');
  });

  test('renders unavailable fallback when WebAuthn API is absent', async () => {
    const saved = (window as unknown as Record<string, unknown>).PublicKeyCredential;
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      mounted = renderInBrowser(<PasskeyLoginButton />);
      await expect.element(page.getByTestId('passkey-unavailable')).toBeInTheDocument();
      await expect
        .element(page.getByTestId('passkey-unavailable'))
        .toHaveTextContent('Passkeys are not supported in this browser');
    } finally {
      Object.defineProperty(window, 'PublicKeyCredential', {
        configurable: true,
        writable: true,
        value: saved,
      });
    }
  });
});

/**
 * Passkey button components for WebAuthn registration and login.
 *
 * RegisterPasskeyButton  — drives the /api/auth/passkey/register/begin + /complete flow
 * PasskeyLoginButton     — drives the /api/auth/passkey/login/begin + /complete flow
 *                          using discoverable credentials (no username required)
 *
 * Both components use @simplewebauthn/browser to execute the browser-side
 * WebAuthn ceremony and forward the result to the server.
 *
 * RP_ID and ORIGIN are resolved dynamically from the server's begin response.
 *
 * Canonical docs: docs/prd.md
 * Issue: feat: sign-in page and WebAuthn passkey UX with demo bypass
 */

import { useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';

// ---------------------------------------------------------------------------
// Shared style helpers
// ---------------------------------------------------------------------------

const btnStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 1rem',
  borderRadius: '0.375rem',
  border: '1px solid #d1d5db',
  background: '#111827',
  color: '#ffffff',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
};

const btnDisabledStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#6b7280',
  cursor: 'not-allowed',
};

// ---------------------------------------------------------------------------
// RegisterPasskeyButton
// ---------------------------------------------------------------------------

export interface RegisterPasskeyButtonProps {
  username: string;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

/**
 * Drives the full WebAuthn passkey registration ceremony.
 * Requires a username (email) to be provided by the parent form.
 */
export function RegisterPasskeyButton({
  username,
  onSuccess,
  onError,
}: RegisterPasskeyButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!username) {
      onError?.('Username is required');
      return;
    }
    setLoading(true);
    try {
      // 1. Begin registration — get options from server
      const beginRes = await fetch('/api/auth/passkey/register/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username }),
      });
      if (!beginRes.ok) {
        const data = (await beginRes.json()) as { error?: string };
        throw new Error(data.error ?? 'Registration failed');
      }
      const options = (await beginRes.json()) as PublicKeyCredentialCreationOptionsJSON;

      // 2. Execute browser ceremony
      const credential = await startRegistration({ optionsJSON: options });

      // 3. Complete registration — send credential to server
      const completeRes = await fetch('/api/auth/passkey/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge: options.challenge,
          id: credential.id,
          rawId: credential.rawId,
          response: {
            clientDataJSON: credential.response.clientDataJSON,
            attestationObject: credential.response.attestationObject,
            transports: credential.response.transports,
          },
        }),
      });
      if (!completeRes.ok) {
        const data = (await completeRes.json()) as { error?: string };
        throw new Error(data.error ?? 'Registration complete failed');
      }

      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRegister}
      disabled={loading}
      style={loading ? btnDisabledStyle : btnStyle}
    >
      {loading ? 'Registering…' : 'Register Passkey'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PasskeyLoginButton
// ---------------------------------------------------------------------------

export interface PasskeyLoginButtonProps {
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

/**
 * Drives the WebAuthn passkey assertion (login) ceremony using discoverable
 * credentials — no username input required.
 */
export function PasskeyLoginButton({ onSuccess, onError }: PasskeyLoginButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    try {
      // 1. Begin assertion — get challenge from server
      const beginRes = await fetch('/api/auth/passkey/login/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!beginRes.ok) {
        const data = (await beginRes.json()) as { error?: string };
        throw new Error(data.error ?? 'Login failed');
      }
      const options = (await beginRes.json()) as PublicKeyCredentialRequestOptionsJSON;

      // 2. Execute browser ceremony
      const credential = await startAuthentication({ optionsJSON: options });

      // 3. Complete assertion — send credential to server
      const completeRes = await fetch('/api/auth/passkey/login/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge: options.challenge,
          id: credential.id,
          response: {
            clientDataJSON: credential.response.clientDataJSON,
            authenticatorData: credential.response.authenticatorData,
            signature: credential.response.signature,
            userHandle: credential.response.userHandle,
          },
        }),
      });
      if (!completeRes.ok) {
        const data = (await completeRes.json()) as { error?: string };
        throw new Error(data.error ?? 'Login failed');
      }

      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogin}
      disabled={loading}
      style={loading ? btnDisabledStyle : btnStyle}
    >
      {loading ? 'Signing in…' : 'Sign in with Passkey'}
    </button>
  );
}

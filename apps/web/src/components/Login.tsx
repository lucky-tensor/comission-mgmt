/**
 * Login page component — two-tab layout (Register / Sign In) with optional
 * demo section when GET /api/demo/users returns a non-empty list.
 *
 * Register tab: username input + RegisterPasskeyButton (WebAuthn registration ceremony).
 * Sign In tab:  PasskeyLoginButton (WebAuthn assertion using discoverable credentials).
 * Demo section: one-click persona buttons + free-form Create input (DEMO_MODE only).
 *
 * Styling: Tailwind utilities driven by the @theme in apps/web/src/index.css.
 *
 * Canonical docs: docs/prd.md
 * Issue: feat: sign-in page and WebAuthn passkey UX with demo bypass
 */

import { useState, useEffect } from 'react';
import { Button } from 'ui';
import { RegisterPasskeyButton, PasskeyLoginButton } from './PasskeyButton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'register' | 'signin';

interface DemoUser {
  id: string;
  username: string;
  role: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Style helpers — Tailwind class strings (theme tokens, no raw hex)
// ---------------------------------------------------------------------------

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 border border-border-strong rounded-lg text-sm outline-none ' +
  'box-border focus:border-accent';

/** Tab button classes, by active state. */
function tabClass(active: boolean): string {
  return [
    'flex-1 p-2.5 bg-transparent border-none cursor-pointer text-sm transition-colors',
    active
      ? 'border-b-2 border-ink font-semibold text-ink'
      : 'border-b-2 border-transparent font-normal text-ink-subtle',
  ].join(' ');
}

/** Demo persona button classes, by loading state. */
function demoButtonClass(loading: boolean): string {
  return [
    'px-3 py-2 border border-border rounded-lg text-sm font-medium text-ink-muted transition-colors',
    loading
      ? 'bg-surface-sunken cursor-not-allowed'
      : 'bg-surface-muted cursor-pointer hover:bg-surface-sunken',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LoginProps {
  onSuccess?: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [tab, setTab] = useState<Tab>('signin');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [demoLoading, setDemoLoading] = useState(false);
  const [createUsername, setCreateUsername] = useState('');

  // Fetch demo users once on mount — if endpoint returns 404 demo section stays hidden
  useEffect(() => {
    fetch('/api/demo/users')
      .then((res) => (res.ok ? (res.json() as Promise<DemoUser[]>) : []))
      .then((users) => {
        setDemoUsers(Array.isArray(users) ? users : []);
      })
      .catch(() => {
        // Demo mode not active — ignore
      });
  }, []);

  function handleSuccess() {
    if (onSuccess) {
      onSuccess();
    } else {
      window.location.href = '/portal';
    }
  }

  function handleError(msg: string) {
    setError(msg);
  }

  async function handleDemoSignIn(userId: string) {
    setError('');
    setDemoLoading(true);
    try {
      const res = await fetch('/api/demo/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Demo sign-in failed');
      }
      handleSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo sign-in failed');
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleDemoCreate() {
    if (!createUsername.trim()) return;
    setError('');
    setDemoLoading(true);
    try {
      const res = await fetch('/api/demo/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: createUsername.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Demo create failed');
      }
      handleSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo create failed');
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-surface-muted flex flex-col justify-center items-center p-4"
      data-testid="login-container"
    >
      <div className="bg-surface p-8 rounded-2xl shadow-sm border border-border w-full max-w-auth">
        <h1 className="text-2xl font-bold text-ink text-center mb-1">Commission Management</h1>
        <p className="text-sm text-ink-subtle text-center mb-6">Sign in to your account</p>

        {/* Tab bar */}
        <div className="flex border-b border-border mb-6">
          <button
            type="button"
            data-testid="tab-register"
            className={tabClass(tab === 'register')}
            onClick={() => {
              setTab('register');
              setError('');
            }}
          >
            Register
          </button>
          <button
            type="button"
            data-testid="tab-signin"
            className={tabClass(tab === 'signin')}
            onClick={() => {
              setTab('signin');
              setError('');
            }}
          >
            Sign In
          </button>
        </div>

        {/* Error box */}
        {error && (
          <div
            className="mb-4 bg-bad-bg border border-bad-fg/30 rounded-lg px-4 py-3 text-sm text-bad-fg"
            data-testid="login-error"
          >
            {error}
          </div>
        )}

        {/* Register tab */}
        {tab === 'register' && (
          <div>
            <div className="mb-4">
              <label
                className="block text-sm font-medium text-ink-muted mb-1.5"
                htmlFor="register-username"
              >
                Email / Username
              </label>
              <input
                id="register-username"
                type="text"
                className={INPUT_CLASS}
                placeholder="you@example.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username webauthn"
              />
            </div>
            <RegisterPasskeyButton
              username={username}
              onSuccess={handleSuccess}
              onError={handleError}
            />

            {/* Demo create-account — dev tooling, kept off the first-impression
                sign-in view (docs/ux-review.md §5). Only available in demo mode. */}
            {demoUsers.length > 0 && (
              <div data-testid="demo-create-section">
                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 border-t border-border" />
                  <span className="text-xs text-ink-faint uppercase tracking-wider font-medium">
                    or create a demo account
                  </span>
                  <div className="flex-1 border-t border-border" />
                </div>
                <div className="flex gap-2 mt-3">
                  <input
                    type="text"
                    data-testid="demo-create-input"
                    className={`${INPUT_CLASS} flex-1 mb-0`}
                    placeholder="username or email"
                    value={createUsername}
                    onChange={(e) => setCreateUsername(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleDemoCreate();
                    }}
                  />
                  <Button
                    type="button"
                    data-testid="demo-create-button"
                    className="whitespace-nowrap"
                    disabled={demoLoading || !createUsername.trim()}
                    onClick={handleDemoCreate}
                  >
                    Create
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sign In tab */}
        {tab === 'signin' && (
          <div>
            <p className="text-sm text-ink-subtle mb-4">
              Use a passkey registered on this device. No username required.
            </p>
            <PasskeyLoginButton onSuccess={handleSuccess} onError={handleError} />
          </div>
        )}

        {/* Demo section — one-click persona grid, visible when demo users are
            available. The create-account control lives behind the Register tab. */}
        {demoUsers.length > 0 && (
          <div className="mt-6 pt-6 border-t border-border" data-testid="demo-section">
            <p className="text-xs text-ink-faint text-center mb-3 uppercase tracking-wider">
              Demo — one-click sign in
            </p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {demoUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  data-testid={`demo-user-${user.id}`}
                  className={demoButtonClass(demoLoading)}
                  disabled={demoLoading}
                  onClick={() => handleDemoSignIn(user.id)}
                >
                  {user.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

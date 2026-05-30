/**
 * Login page component.
 *
 * Renders two tabs: Register (username input + RegisterPasskeyButton) and
 * Sign In (PasskeyLoginButton using discoverable credentials).
 *
 * When the server returns demo users from GET /api/demo/users, a third section
 * appears below with:
 *   - One-click sign-in buttons labelled by human role name (one per persona)
 *   - A text input + 'Create' button for ephemeral account creation
 *
 * Error states: red-bordered box with the error message.
 * Redirect after sign-in: navigates to / on successful session cookie issuance.
 *
 * Canonical docs: docs/prd.md
 * Issue: feat: sign-in page and WebAuthn passkey UX with demo bypass
 */

import { useState, useEffect } from 'react';
import { RegisterPasskeyButton, PasskeyLoginButton } from './PasskeyButton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DemoUser {
  id: string;
  username: string;
  role: string;
  label: string;
}

type Tab = 'register' | 'signin';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  background: '#f9fafb',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#111827',
  padding: '1rem',
};

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '0.75rem',
  boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
  padding: '2rem',
  width: '100%',
  maxWidth: '400px',
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid #e5e7eb',
  marginBottom: '1.5rem',
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '0.625rem',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid #111827' : '2px solid transparent',
    color: active ? '#111827' : '#6b7280',
    fontWeight: active ? 600 : 400,
    fontSize: '0.875rem',
    cursor: 'pointer',
  };
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  borderRadius: '0.375rem',
  border: '1px solid #d1d5db',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  marginBottom: '0.75rem',
};

const errorBoxStyle: React.CSSProperties = {
  padding: '0.75rem',
  borderRadius: '0.375rem',
  border: '1px solid #f87171',
  background: '#fef2f2',
  color: '#b91c1c',
  fontSize: '0.875rem',
  marginBottom: '0.75rem',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.75rem',
};

const dividerStyle: React.CSSProperties = {
  borderTop: '1px solid #e5e7eb',
  marginTop: '1.5rem',
  marginBottom: '1.5rem',
};

const demoButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.5rem 0.75rem',
  marginBottom: '0.5rem',
  borderRadius: '0.375rem',
  border: '1px solid #d1d5db',
  background: '#f9fafb',
  color: '#374151',
  fontSize: '0.875rem',
  cursor: 'pointer',
  textAlign: 'left',
};

const demoCreateRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  marginTop: '0.75rem',
};

const demoCreateInputStyle: React.CSSProperties = {
  ...inputStyle,
  marginBottom: 0,
  flex: 1,
};

const demoCreateButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: '0.375rem',
  border: '1px solid #d1d5db',
  background: '#374151',
  color: '#ffffff',
  fontSize: '0.875rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

// ---------------------------------------------------------------------------
// Login component
// ---------------------------------------------------------------------------

export default function Login() {
  const [tab, setTab] = useState<Tab>('signin');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [demoUsers, setDemoUsers] = useState<DemoUser[] | null>(null);
  const [ephemeralUsername, setEphemeralUsername] = useState('');
  const [demoLoading, setDemoLoading] = useState<string | null>(null);

  // Attempt to load demo users on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/demo/users')
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<DemoUser[]>;
      })
      .then((data) => {
        if (!cancelled && data) setDemoUsers(data);
      })
      .catch(() => {
        // Demo mode not active — section stays hidden
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSuccess() {
    window.location.href = '/';
  }

  function handleError(message: string) {
    setError(message);
  }

  async function handleDemoSignIn(userId: string) {
    setDemoLoading(userId);
    setError(null);
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
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo sign-in failed');
    } finally {
      setDemoLoading(null);
    }
  }

  async function handleDemoCreate() {
    if (!ephemeralUsername.trim()) {
      setError('Username is required');
      return;
    }
    setDemoLoading('create');
    setError(null);
    try {
      const res = await fetch('/api/demo/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ephemeralUsername.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Demo account creation failed');
      }
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo account creation failed');
    } finally {
      setDemoLoading(null);
    }
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: 'center' }}>
          Commission Management
        </h1>

        {/* Tab bar */}
        <div style={tabBarStyle}>
          <button style={tabStyle(tab === 'signin')} onClick={() => { setTab('signin'); setError(null); }}>
            Sign In
          </button>
          <button style={tabStyle(tab === 'register')} onClick={() => { setTab('register'); setError(null); }}>
            Register
          </button>
        </div>

        {/* Error box */}
        {error && <div style={errorBoxStyle}>{error}</div>}

        {/* Register tab */}
        {tab === 'register' && (
          <div>
            <input
              type="email"
              placeholder="Email address"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
              autoComplete="email"
            />
            <RegisterPasskeyButton
              username={username}
              onSuccess={handleSuccess}
              onError={handleError}
            />
          </div>
        )}

        {/* Sign In tab */}
        {tab === 'signin' && (
          <div>
            <PasskeyLoginButton onSuccess={handleSuccess} onError={handleError} />
          </div>
        )}

        {/* Demo section — only rendered when DEMO_MODE is active */}
        {demoUsers && demoUsers.length > 0 && (
          <>
            <div style={dividerStyle} />
            <div>
              <p style={sectionTitleStyle}>Demo — one-click sign in</p>
              {demoUsers.map((u) => (
                <button
                  key={u.id}
                  style={demoButtonStyle}
                  disabled={demoLoading === u.id}
                  onClick={() => handleDemoSignIn(u.id)}
                >
                  {demoLoading === u.id ? 'Signing in…' : u.label}
                </button>
              ))}
              <div style={demoCreateRowStyle}>
                <input
                  type="text"
                  placeholder="Create ephemeral user…"
                  value={ephemeralUsername}
                  onChange={(e) => setEphemeralUsername(e.target.value)}
                  style={demoCreateInputStyle}
                />
                <button
                  style={demoCreateButtonStyle}
                  disabled={demoLoading === 'create'}
                  onClick={handleDemoCreate}
                >
                  {demoLoading === 'create' ? '…' : 'Create'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

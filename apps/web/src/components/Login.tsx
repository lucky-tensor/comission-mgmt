/**
 * Login page component — two-tab layout (Register / Sign In) with optional
 * demo section when GET /api/demo/users returns a non-empty list.
 *
 * Register tab: username input + RegisterPasskeyButton (WebAuthn registration ceremony).
 * Sign In tab:  PasskeyLoginButton (WebAuthn assertion using discoverable credentials).
 * Demo section: one-click persona buttons + free-form Create input (DEMO_MODE only).
 *
 * Canonical docs: docs/prd.md
 * Issue: feat: sign-in page and WebAuthn passkey UX with demo bypass
 */

import { useState, useEffect } from 'react';
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
// Style helpers (inline — no Tailwind dependency)
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f9fafb',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  fontFamily: 'system-ui, sans-serif',
  padding: '1rem',
};

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  padding: '2rem',
  borderRadius: '1rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  border: '1px solid #e5e7eb',
  width: '100%',
  maxWidth: '420px',
};

const headingStyle: React.CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 700,
  color: '#111827',
  textAlign: 'center',
  marginBottom: '0.25rem',
};

const subheadingStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
  textAlign: 'center',
  marginBottom: '1.5rem',
};

const tabRowStyle: React.CSSProperties = {
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
    fontWeight: active ? 600 : 400,
    color: active ? '#111827' : '#6b7280',
    cursor: 'pointer',
    fontSize: '0.875rem',
    transition: 'color 0.15s',
  };
}

const inputWrapStyle: React.CSSProperties = {
  marginBottom: '1rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: '#374151',
  marginBottom: '0.375rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.875rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const errorBoxStyle: React.CSSProperties = {
  marginBottom: '1rem',
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: '0.5rem',
  padding: '0.75rem 1rem',
  fontSize: '0.8125rem',
  color: '#b91c1c',
};

const dividerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  margin: '1.25rem 0',
};

const dividerLineStyle: React.CSSProperties = {
  flex: 1,
  borderTop: '1px solid #e5e7eb',
};

const dividerTextStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  color: '#9ca3af',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 500,
};

const demoSectionStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  paddingTop: '1.5rem',
  borderTop: '1px solid #e5e7eb',
};

const demoHeadingStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#9ca3af',
  textAlign: 'center',
  marginBottom: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const demoGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '0.5rem',
  marginBottom: '1rem',
};

function demoButtonStyle(loading: boolean): React.CSSProperties {
  return {
    padding: '0.5rem 0.75rem',
    background: loading ? '#f3f4f6' : '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '0.5rem',
    cursor: loading ? 'not-allowed' : 'pointer',
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: '#374151',
    transition: 'background 0.15s',
  };
}

const createRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  marginTop: '0.75rem',
};

const createInputStyle: React.CSSProperties = {
  ...inputStyle,
  flex: 1,
  marginBottom: 0,
};

const createBtnStyle: React.CSSProperties = {
  padding: '0.625rem 1rem',
  background: '#374151',
  color: '#ffffff',
  border: 'none',
  borderRadius: '0.5rem',
  fontSize: '0.8125rem',
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const createBtnDisabledStyle: React.CSSProperties = {
  ...createBtnStyle,
  background: '#9ca3af',
  cursor: 'not-allowed',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Login() {
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
      .then((users) => setDemoUsers(Array.isArray(users) ? users : []))
      .catch(() => {
        // Demo mode not active — ignore
      });
  }, []);

  function handleSuccess() {
    window.location.href = '/portal';
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
      window.location.href = '/portal';
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
      window.location.href = '/portal';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo create failed');
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={headingStyle}>Commission Management</h1>
        <p style={subheadingStyle}>Sign in to your account</p>

        {/* Tab bar */}
        <div style={tabRowStyle}>
          <button
            type="button"
            style={tabStyle(tab === 'register')}
            onClick={() => {
              setTab('register');
              setError('');
            }}
          >
            Register
          </button>
          <button
            type="button"
            style={tabStyle(tab === 'signin')}
            onClick={() => {
              setTab('signin');
              setError('');
            }}
          >
            Sign In
          </button>
        </div>

        {/* Error box */}
        {error && <div style={errorBoxStyle}>{error}</div>}

        {/* Register tab */}
        {tab === 'register' && (
          <div>
            <div style={inputWrapStyle}>
              <label style={labelStyle} htmlFor="register-username">
                Email / Username
              </label>
              <input
                id="register-username"
                type="text"
                style={inputStyle}
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
          </div>
        )}

        {/* Sign In tab */}
        {tab === 'signin' && (
          <div>
            <p style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '1rem' }}>
              Use a passkey registered on this device. No username required.
            </p>
            <PasskeyLoginButton onSuccess={handleSuccess} onError={handleError} />
          </div>
        )}

        {/* Demo section — visible only when demo users are available */}
        {demoUsers.length > 0 && (
          <div style={demoSectionStyle}>
            <p style={demoHeadingStyle}>Demo — one-click sign in</p>
            <div style={demoGridStyle}>
              {demoUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  style={demoButtonStyle(demoLoading)}
                  disabled={demoLoading}
                  onClick={() => handleDemoSignIn(user.id)}
                >
                  {user.label}
                </button>
              ))}
            </div>

            <div style={dividerStyle}>
              <div style={dividerLineStyle} />
              <span style={dividerTextStyle}>or create</span>
              <div style={dividerLineStyle} />
            </div>

            <div style={createRowStyle}>
              <input
                type="text"
                style={createInputStyle}
                placeholder="username or email"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleDemoCreate();
                }}
              />
              <button
                type="button"
                style={demoLoading ? createBtnDisabledStyle : createBtnStyle}
                disabled={demoLoading || !createUsername.trim()}
                onClick={handleDemoCreate}
              >
                Create
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

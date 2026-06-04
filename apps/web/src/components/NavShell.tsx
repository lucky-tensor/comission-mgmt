/**
 * NavShell — application navigation shell.
 *
 * Renders the top navigation bar with only the routes permitted for the
 * active role (sourced from roleRoutes.ts). Wraps the page content in a
 * layout container.
 *
 * Route gating: the nav only shows items whose path is in the role's
 * `navItems` list — no component re-implements role gating.
 *
 * Canonical docs: docs/prd.md §3 (User Roles)
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
 */

import type { AppRole } from 'core/auth';
import { ROLE_ROUTES } from '../lib/roleRoutes';
import type { ReactNode } from 'react';

interface NavShellProps {
  role: AppRole;
  currentPath: string;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

const navStyle: React.CSSProperties = {
  background: '#111827',
  color: '#ffffff',
  padding: '0 1.5rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  height: '3.25rem',
  fontFamily: 'system-ui, sans-serif',
  position: 'sticky',
  top: 0,
  zIndex: 100,
};

const brandStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: '0.9375rem',
  color: '#ffffff',
  marginRight: '1rem',
  whiteSpace: 'nowrap',
};

function navItemStyle(active: boolean): React.CSSProperties {
  return {
    padding: '0.4375rem 0.75rem',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 400,
    color: active ? '#ffffff' : '#9ca3af',
    background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
    cursor: 'pointer',
    border: 'none',
    transition: 'color 0.15s, background 0.15s',
  };
}

const spacerStyle: React.CSSProperties = {
  flex: 1,
};

const roleBadgeStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 500,
  color: '#9ca3af',
  padding: '0.25rem 0.625rem',
  background: 'rgba(255,255,255,0.06)',
  borderRadius: '9999px',
  whiteSpace: 'nowrap',
};

export function NavShell({ role, currentPath, onNavigate, children }: NavShellProps) {
  const config = ROLE_ROUTES[role];

  return (
    <div data-testid="nav-shell">
      <nav style={navStyle} data-testid="nav-bar" aria-label="Main navigation">
        <span style={brandStyle}>Commission Mgmt</span>

        {config.navItems.map((item) => (
          <button
            key={item.path}
            type="button"
            data-testid={`nav-item-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
            style={navItemStyle(currentPath === item.path)}
            aria-current={currentPath === item.path ? 'page' : undefined}
            onClick={() => onNavigate(item.path)}
          >
            {item.label}
          </button>
        ))}

        <div style={spacerStyle} />
        <span style={roleBadgeStyle} data-testid="nav-role-badge">
          {role}
        </span>
      </nav>

      <main>{children}</main>
    </div>
  );
}

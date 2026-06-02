/**
 * Forbidden — 403 surface rendered when an authenticated user navigates
 * directly to a route their role is not permitted to access.
 *
 * Displays an explanatory message and a link back to the user's landing page.
 *
 * Canonical docs: docs/prd.md §3 (User Roles)
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
 */

import type { AppRole } from 'core/auth';
import { landingPathForRole } from '../lib/roleRoutes';

interface ForbiddenProps {
  role: AppRole;
  onNavigate: (path: string) => void;
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f9fafb',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  fontFamily: 'system-ui, sans-serif',
  padding: '2rem',
};

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  padding: '2.5rem',
  borderRadius: '1rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  border: '1px solid #e5e7eb',
  textAlign: 'center',
  maxWidth: '480px',
  width: '100%',
};

const codeStyle: React.CSSProperties = {
  fontSize: '4rem',
  fontWeight: 800,
  color: '#d1d5db',
  margin: '0 0 0.5rem',
  lineHeight: 1,
};

const headingStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 700,
  color: '#111827',
  margin: '0 0 0.75rem',
};

const bodyStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
  margin: '0 0 1.5rem',
};

const linkStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.625rem 1.25rem',
  background: '#111827',
  color: '#ffffff',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
};

export function Forbidden({ role, onNavigate }: ForbiddenProps) {
  const landing = landingPathForRole(role);

  return (
    <div style={containerStyle} data-testid="forbidden-surface">
      <div style={cardStyle}>
        <p style={codeStyle}>403</p>
        <h1 style={headingStyle}>Access denied</h1>
        <p style={bodyStyle}>
          You do not have permission to view this page. Your role does not include access to this
          section.
        </p>
        <button
          type="button"
          style={linkStyle}
          data-testid="forbidden-back-btn"
          onClick={() => onNavigate(landing)}
        >
          Go to my home
        </button>
      </div>
    </div>
  );
}

/**
 * PlaceholderSurface — empty-state surface for role home pages that have not
 * yet been implemented in their own issue.
 *
 * Each role surface issue registers a real component here; until then the
 * placeholder keeps routing functional and provides meaningful feedback.
 *
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
 */

export { FinanceAdminSurface as FinanceHome } from './finance/FinanceAdminSurface';

interface PlaceholderSurfaceProps {
  title: string;
  description: string;
  /** data-testid attribute for the wrapper (used in tests). */
  testId: string;
}

const containerStyle: React.CSSProperties = {
  minHeight: 'calc(100vh - 3.25rem)',
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

const headingStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 700,
  color: '#111827',
  margin: '0 0 0.75rem',
};

const bodyStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
  margin: 0,
};

export function PlaceholderSurface({ title, description, testId }: PlaceholderSurfaceProps) {
  return (
    <div style={containerStyle} data-testid={testId}>
      <div style={cardStyle}>
        <h1 style={headingStyle}>{title}</h1>
        <p style={bodyStyle}>{description}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Named placeholder surfaces for each role home
// ---------------------------------------------------------------------------

export function ExecutiveHome() {
  return (
    <PlaceholderSurface
      testId="executive-home"
      title="Executive Dashboard"
      description="Firm-wide margin, liability, disputes, and producer concentration analytics. Coming soon."
    />
  );
}

export function HrHome() {
  return (
    <PlaceholderSurface
      testId="hr-home"
      title="HR / People Ops Home"
      description="Plan acknowledgments, draw balances, and termination payout rules. Coming soon."
    />
  );
}

export function PartnerHome() {
  return (
    <PlaceholderSurface
      testId="partner-home"
      title="Partner Portal"
      description="Your credited placements and payout visibility. Coming soon."
    />
  );
}

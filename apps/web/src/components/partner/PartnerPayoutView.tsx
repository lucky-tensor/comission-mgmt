/**
 * PartnerPayoutView — External Partner scoped payout surface.
 *
 * Renders the list of placements where the authenticated External Partner holds
 * a split/contributor agreement, each showing:
 *   - amount owed (fee_amount)
 *   - payment trigger (start_date / guarantee window)
 *   - payment status (placement status)
 *
 * Other contributors' credit, internal margin, draw balances, and firm-wide
 * data are absent from the API response (masked by the server per #64/#125).
 * This component renders only what the server returns.
 *
 * Fetches from GET /partner/placements (list endpoint, issue #125).
 *
 * Canonical docs: docs/prd.md §5.11, §9 (Visibility and Confidentiality)
 * Issue: feat: External Partner UI — scoped payout view (#116)
 */

import { apiGet, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';

// ---------------------------------------------------------------------------
// Types (mirrors the server's GET /partner/placements response)
// ---------------------------------------------------------------------------

export interface PartnerPlacement {
  id: string;
  org_id: string;
  candidate_id: string | null;
  client_entity_id: string | null;
  job_title: string;
  compensation_base: string | null;
  fee_amount: string | null;
  status: string;
  start_date: string | null;
  guarantee_days: number | null;
  guarantee_expiry_date: string | null;
  is_confidential: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: string | null): string {
  if (!value) return '—';
  const n = parseFloat(value);
  if (isNaN(n)) return value;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function paymentTriggerLabel(placement: PartnerPlacement): string {
  if (placement.guarantee_expiry_date) {
    return `Guarantee expires ${placement.guarantee_expiry_date}`;
  }
  if (placement.guarantee_days != null && placement.start_date) {
    return `${placement.guarantee_days}-day guarantee from ${placement.start_date}`;
  }
  if (placement.start_date) {
    return `Start date: ${placement.start_date}`;
  }
  return '—';
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr 1fr',
  gap: '0.75rem',
  padding: '0.875rem 0',
  borderBottom: '1px solid #f3f4f6',
  alignItems: 'center',
  fontSize: '0.875rem',
  color: '#374151',
};

const headerRowStyle: React.CSSProperties = {
  ...rowStyle,
  fontWeight: 600,
  color: '#6b7280',
  fontSize: '0.75rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  borderBottom: '1px solid #e5e7eb',
};

const statusBadgeStyle = (status: string): React.CSSProperties => {
  const color =
    status === 'Active' || status === 'Closed'
      ? '#059669'
      : status === 'GuaranteeExpired'
        ? '#d97706'
        : '#6b7280';
  return {
    display: 'inline-block',
    padding: '0.2rem 0.5rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 500,
    background: color + '1a',
    color,
  };
};

const confidentialBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.125rem 0.4rem',
  borderRadius: '4px',
  fontSize: '0.7rem',
  fontWeight: 500,
  background: '#fef9c3',
  color: '#854d0e',
  marginLeft: '0.4rem',
  verticalAlign: 'middle',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PlacementRowProps {
  placement: PartnerPlacement;
}

function PlacementRow({ placement }: PlacementRowProps) {
  return (
    <div style={rowStyle} data-testid={`partner-placement-row-${placement.id}`}>
      <div>
        <span data-testid="partner-placement-job-title">{placement.job_title}</span>
        {placement.is_confidential && (
          <span style={confidentialBadgeStyle} data-testid="partner-placement-confidential-badge">
            Confidential
          </span>
        )}
      </div>
      <div data-testid="partner-placement-amount-owed">{formatCurrency(placement.fee_amount)}</div>
      <div data-testid="partner-placement-payment-trigger">{paymentTriggerLabel(placement)}</div>
      <div>
        <span
          style={statusBadgeStyle(placement.status)}
          data-testid="partner-placement-status"
        >
          {placement.status}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlacementsTable — pure presenter (accepts AsyncState shape inline)
// ---------------------------------------------------------------------------

interface PlacementsTableProps {
  loading: boolean;
  error: string | null;
  data: PartnerPlacement[] | null;
}

export function PlacementsTable({ loading, error, data }: PlacementsTableProps) {
  if (loading) return <LoadingState label="your placements" />;
  if (error) return <ErrorState message={error} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState message="No split agreements found. You will see placements here once an agreement is recorded against your account." />
    );
  }

  return (
    <div data-testid="partner-placements-list">
      <div style={headerRowStyle}>
        <div>Position</div>
        <div>Amount Owed</div>
        <div>Payment Trigger</div>
        <div>Status</div>
      </div>
      {data.map((p) => (
        <PlacementRow key={p.id} placement={p} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PartnerPayoutView — fetching container
// ---------------------------------------------------------------------------

export interface PartnerPayoutViewProps {
  /** Called when the session is missing (401). Redirect to login. */
  onUnauthenticated?: () => void;
}

export function PartnerPayoutView({ onUnauthenticated }: PartnerPayoutViewProps) {
  const placements = useAsync<PartnerPlacement[]>(
    () =>
      apiGet<PartnerPlacement[]>('/partner/placements').catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          onUnauthenticated?.();
        }
        throw err;
      }),
    [],
  );

  return (
    <div
      data-testid="partner-payout-view"
      style={{
        minHeight: 'calc(100vh - 3.25rem)',
        background: '#f9fafb',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <header style={{ marginBottom: '2rem' }}>
          <h1
            style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}
          >
            My Placements
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
            Split agreements where you hold a payout interest. Amounts, payment triggers, and
            payment status for your deals only.
          </p>
        </header>

        <PortalCard title="Payout Overview">
          <PlacementsTable
            loading={placements.loading}
            error={placements.error}
            data={placements.data}
          />
        </PortalCard>
      </div>
    </div>
  );
}

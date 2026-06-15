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

import { StatusChip } from 'ui';
import type { StatusVariant } from 'ui';
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

const ROW_CLASS =
  'grid grid-cols-4 gap-3 py-3.5 border-b border-surface-sunken items-center text-sm text-ink-muted';

const HEADER_ROW_CLASS =
  'grid grid-cols-4 gap-3 py-3.5 items-center text-xs font-semibold text-ink-subtle ' +
  'uppercase tracking-wider border-b border-border';

/** Map a partner placement status to a status-chip variant (preserves prior semantics). */
function placementStatusVariant(status: string): StatusVariant {
  if (status === 'Active' || status === 'Closed') return 'green';
  if (status === 'GuaranteeExpired') return 'amber';
  return 'gray';
}

const CONFIDENTIAL_BADGE_CLASS =
  'inline-block px-1.5 py-0.5 rounded-xs text-xs font-medium bg-warn-bg text-warn-fg ml-1.5 align-middle';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PlacementRowProps {
  placement: PartnerPlacement;
}

function PlacementRow({ placement }: PlacementRowProps) {
  return (
    <div className={ROW_CLASS} data-testid={`partner-placement-row-${placement.id}`}>
      <div>
        <span data-testid="partner-placement-job-title">{placement.job_title}</span>
        {placement.is_confidential && (
          <span
            className={CONFIDENTIAL_BADGE_CLASS}
            data-testid="partner-placement-confidential-badge"
          >
            Confidential
          </span>
        )}
      </div>
      <div data-testid="partner-placement-amount-owed">{formatCurrency(placement.fee_amount)}</div>
      <div data-testid="partner-placement-payment-trigger">{paymentTriggerLabel(placement)}</div>
      <div>
        <StatusChip
          variant={placementStatusVariant(placement.status)}
          data-testid="partner-placement-status"
        >
          {placement.status}
        </StatusChip>
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
      <div className={HEADER_ROW_CLASS}>
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
    <div data-testid="partner-payout-view" className="min-h-surface bg-surface-muted px-4 py-8">
      <div className="max-w-report mx-auto">
        <header className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink m-0">My Placements</h1>
          <p className="text-sm text-ink-subtle mt-1 mb-0">
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

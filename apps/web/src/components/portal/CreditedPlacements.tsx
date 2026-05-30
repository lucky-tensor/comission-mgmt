/**
 * CreditedPlacements — the producer's credited commission records (their
 * placements and the commission each generated), from GET /me/commission-records.
 *
 * Pure view + container split (see PayoutStatement.tsx for the rationale).
 * Each row exposes the plain-language explanation and the hold/blocked-phase
 * status so producers understand why a payout is or isn't released.
 *
 * Canonical docs: docs/prd.md §5.8 — Producer Payout Portal
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import type { CommissionRecord } from 'core/producer-portal';
import { apiGet } from '../../lib/apiClient';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import { formatCurrency } from '../../lib/format';
import { PortalCard, LoadingState, ErrorState, EmptyState } from './states';

const rowStyle: React.CSSProperties = {
  padding: '0.875rem 0',
  borderBottom: '1px solid #f3f4f6',
};

/** Pure presentational view — renders one of loading/error/empty/data. */
export function CreditedPlacementsView({ state }: { state: AsyncState<CommissionRecord[]> }) {
  return (
    <PortalCard title="Credited placements">
      {state.loading ? (
        <LoadingState label="credited placements" />
      ) : state.error ? (
        <ErrorState message={state.error} />
      ) : !state.data || state.data.length === 0 ? (
        <EmptyState message="No credited placements yet." />
      ) : (
        <ul data-testid="placements-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {state.data.map((r) => (
            <li key={r.id} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 500, color: '#111827' }}>
                  {formatCurrency(r.net_payable)} net
                </span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: r.status === 'Held' ? '#b45309' : '#047857',
                  }}
                >
                  {r.status}
                </span>
              </div>
              {r.explanation && (
                <p style={{ fontSize: '0.8125rem', color: '#6b7280', margin: '0.375rem 0 0' }}>
                  {r.explanation}
                </p>
              )}
              {r.blocked_phase && (
                <p style={{ fontSize: '0.75rem', color: '#b45309', margin: '0.25rem 0 0' }}>
                  Blocked by phase: {r.blocked_phase.phase_name}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PortalCard>
  );
}

/** Container — fetches GET /me/commission-records and renders the view. */
export function CreditedPlacements() {
  const state = useAsync<CommissionRecord[]>(
    () =>
      apiGet<{ commission_records: CommissionRecord[] }>('/me/commission-records').then(
        (r) => r.commission_records,
      ),
    [],
  );
  return <CreditedPlacementsView state={state} />;
}

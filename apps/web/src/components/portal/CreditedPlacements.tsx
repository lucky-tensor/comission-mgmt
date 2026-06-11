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
import { StatusChip } from 'ui';

const rowStyle: React.CSSProperties = {
  padding: '0.875rem 0',
  borderBottom: '1px solid #f3f4f6',
};

/** A human-readable lead label: role title, else a short placement reference. */
function placementLead(r: CommissionRecord): string {
  if (r.position_title) return r.position_title;
  return `Placement ${r.placement_id.slice(0, 8)}`;
}

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
            <li key={r.id} style={rowStyle} data-testid={`placement-row-${r.id}`}>
              {/* Lead with the role title + amount + a semantic status chip;
                  the placement identity is no longer buried in the explanation. */}
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span
                  data-testid={`placement-lead-${r.id}`}
                  style={{ fontWeight: 600, color: '#111827' }}
                >
                  {placementLead(r)}
                </span>
                <StatusChip status={r.status} data-testid={`placement-status-${r.id}`} />
              </div>
              <div style={{ fontSize: '0.875rem', color: '#374151', marginTop: '0.25rem' }}>
                {formatCurrency(r.net_payable)} net
              </div>

              {/* Plain-language explanation as an expandable detail. */}
              {r.explanation && (
                <details
                  data-testid={`placement-explanation-${r.id}`}
                  style={{ marginTop: '0.5rem' }}
                >
                  <summary
                    style={{
                      fontSize: '0.8125rem',
                      color: '#2563eb',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    How was this calculated?
                  </summary>
                  <p style={{ fontSize: '0.8125rem', color: '#6b7280', margin: '0.375rem 0 0' }}>
                    {r.explanation}
                  </p>
                </details>
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

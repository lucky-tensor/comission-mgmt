/**
 * CreditedPlacements — the producer's credited commission records (their
 * placements and the commission each generated), from GET /me/commission-records.
 *
 * Pure view + container split (see PayoutStatement.tsx for the rationale).
 * Each row exposes the plain-language explanation and the hold/blocked-phase
 * status so producers understand why a payout is or isn't released.
 *
 * Canonical docs: docs/prd.md §5.9 — Producer Payout Portal
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import type { CommissionRecord } from 'core/producer-portal';
import { apiGet } from '../../lib/apiClient';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import { PortalCard, LoadingState, ErrorState, EmptyState } from './states';
import { StatusChip } from 'ui';
import { CommissionBreakdown } from './CommissionBreakdown';

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
        <ul data-testid="placements-list" className="list-none m-0 p-0 space-y-4">
          {state.data.map((r) => (
            <li
              key={r.id}
              className="p-4 rounded-md border border-border-subtle bg-surface-raised"
              data-testid={`placement-row-${r.id}`}
            >
              {/* Header: role title + status chip */}
              <div className="flex justify-between items-start mb-1">
                <span
                  data-testid={`placement-lead-${r.id}`}
                  className="font-semibold text-ink text-base"
                >
                  {placementLead(r)}
                </span>
                <StatusChip
                  status={r.producer_display_status ?? r.status}
                  data-testid={`placement-status-${r.id}`}
                />
              </div>

              {/* Commission breakdown: gross → deductions → net */}
              <CommissionBreakdown record={r} />

              {/* Plain-language explanation as an expandable detail. */}
              {r.explanation && (
                <details
                  data-testid={`placement-explanation-${r.id}`}
                  className="mt-3 pt-3 border-t border-border-subtle"
                >
                  <summary className="text-sm text-accent cursor-pointer select-none font-medium">
                    How was this calculated?
                  </summary>
                  <p className="text-sm text-text-secondary mt-2 mb-0">{r.explanation}</p>
                </details>
              )}

              {/* Phase blocking info if applicable */}
              {r.blocked_phase && (
                <p className="text-xs text-text-secondary mt-3 pt-3 border-t border-border-subtle mb-0">
                  <strong>Blocked by phase:</strong> {r.blocked_phase.phase_name}
                  {r.blocked_phase.blocking_invoice_id &&
                    ` (invoice: ${r.blocked_phase.blocking_invoice_id})`}
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

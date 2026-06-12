/**
 * PayoutStatement — the producer's payout statement table.
 *
 * Split into a pure presentational view (`PayoutStatementView`, driven by an
 * explicit state object so component tests can render loading/empty/error/data
 * in a real browser without any network mock) and a container
 * (`PayoutStatement`) that wires the real GET /me/payouts fetch via apiClient.
 *
 * Columns: role/position, split % (tier rate), commissionable base (gross),
 * calculated amount (net payable), holdback status, payment trigger.
 *
 * Canonical docs: docs/prd.md §5.9 — Producer Payout Portal
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import type { Payout } from 'core/producer-portal';
import { apiGet } from '../../lib/apiClient';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import { formatCurrency, formatRate } from '../../lib/format';
import { PortalCard, LoadingState, ErrorState, EmptyState } from './states';

const CELL_CLASS = 'px-3 py-2 text-[0.8125rem] border-b border-surface-sunken text-left';

const HEAD_CLASS =
  'px-3 py-2 border-b border-surface-sunken text-left font-semibold text-ink-subtle uppercase ' +
  'text-[0.6875rem] tracking-wide';

/** Pure presentational view — renders one of loading/error/empty/data. */
export function PayoutStatementView({ state }: { state: AsyncState<Payout[]> }) {
  return (
    <PortalCard title="Payout statement">
      {state.loading ? (
        <LoadingState label="payout statement" />
      ) : state.error ? (
        <ErrorState message={state.error} />
      ) : !state.data || state.data.length === 0 ? (
        <EmptyState message="No payouts yet. Approved commission runs will appear here." />
      ) : (
        <table data-testid="payout-table" className="w-full border-collapse">
          <thead>
            <tr>
              <th className={HEAD_CLASS}>Position</th>
              <th className={HEAD_CLASS}>Split %</th>
              <th className={HEAD_CLASS}>Commissionable base</th>
              <th className={HEAD_CLASS}>Calculated amount</th>
              <th className={HEAD_CLASS}>Holdback</th>
              <th className={HEAD_CLASS}>Payment trigger</th>
            </tr>
          </thead>
          <tbody>
            {state.data.map((p) => (
              <tr key={p.id}>
                <td className={CELL_CLASS}>{p.position_title ?? '—'}</td>
                <td className={CELL_CLASS}>{formatRate(p.tier_rate)}</td>
                <td className={CELL_CLASS}>{formatCurrency(p.gross_commission)}</td>
                <td className={CELL_CLASS}>{formatCurrency(p.net_payable)}</td>
                <td className={CELL_CLASS}>{p.hold_reason ? p.hold_reason : 'Released'}</td>
                <td className={CELL_CLASS}>{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PortalCard>
  );
}

/** Container — fetches GET /me/payouts and renders the view. */
export function PayoutStatement() {
  const state = useAsync<Payout[]>(
    () => apiGet<{ payouts: Payout[] }>('/me/payouts').then((r) => r.payouts),
    [],
  );
  return <PayoutStatementView state={state} />;
}

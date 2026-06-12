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

const cellStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.8125rem',
  borderBottom: '1px solid #f3f4f6',
  textAlign: 'left',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  fontSize: '0.6875rem',
  letterSpacing: '0.03em',
};

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
        <table data-testid="payout-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headStyle}>Position</th>
              <th style={headStyle}>Split %</th>
              <th style={headStyle}>Commissionable base</th>
              <th style={headStyle}>Calculated amount</th>
              <th style={headStyle}>Holdback</th>
              <th style={headStyle}>Payment trigger</th>
            </tr>
          </thead>
          <tbody>
            {state.data.map((p) => (
              <tr key={p.id}>
                <td style={cellStyle}>{p.position_title ?? '—'}</td>
                <td style={cellStyle}>{formatRate(p.tier_rate)}</td>
                <td style={cellStyle}>{formatCurrency(p.gross_commission)}</td>
                <td style={cellStyle}>{formatCurrency(p.net_payable)}</td>
                <td style={cellStyle}>{p.hold_reason ? p.hold_reason : 'Released'}</td>
                <td style={cellStyle}>{p.status}</td>
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

/**
 * TeamCommissionView — Manager surface for viewing team commission accruals,
 * team placements, and open team disputes.
 *
 * Composed of:
 *   - TeamCommissionViewView — pure presentational view accepting explicit state
 *     props so component tests can render each state without network calls.
 *   - TeamCommissionView     — container that fetches from the real API via
 *     apiClient and wires state to the view.
 *
 * API endpoints used:
 *   GET /me/team/commission-summary  — accruals/payables/holds by producer
 *   GET /me/team/placements          — team placements
 *   GET /me/team/disputes            — open team disputes
 *
 * RBAC: endpoints enforce Manager (or FinanceAdmin) role — any other role gets
 * 403. The component propagates that as an error state.
 *
 * Canonical docs: docs/prd.md §4 (Manager)
 * Issue: feat: Manager UI — team commission view (#108)
 */

import { useEffect } from 'react';
import { apiGet } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';
import { formatCurrency, formatDate } from '../../lib/format';
import type { AsyncState } from '../../lib/useAsync';

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface ProducerSummaryRow {
  producer_id: string;
  total_accrued: string;
  total_payable: string;
  total_held: string;
  record_count: number;
}

export interface TeamPlacementRow {
  id: string;
  org_id: string;
  job_title: string;
  status: string;
  start_date: string | null;
  created_at: string;
}

export interface TeamDisputeRow {
  id: string;
  org_id: string;
  commission_record_id: string;
  submitted_by: string;
  description: string;
  state: string;
  created_at: string;
  placement_id: string;
}

// ---------------------------------------------------------------------------
// View props
// ---------------------------------------------------------------------------

export interface TeamCommissionViewViewProps {
  summary: AsyncState<ProducerSummaryRow[]>;
  placements: AsyncState<TeamPlacementRow[]>;
  disputes: AsyncState<TeamDisputeRow[]>;
}

// ---------------------------------------------------------------------------
// Shared style tokens
// ---------------------------------------------------------------------------

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  borderBottom: '2px solid #e5e7eb',
  color: '#374151',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #f3f4f6',
  color: '#111827',
  verticalAlign: 'top',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.125rem 0.5rem',
  borderRadius: '9999px',
  fontSize: '0.75rem',
  fontWeight: 500,
  background: '#f3f4f6',
  color: '#374151',
};

// ---------------------------------------------------------------------------
// Commission Summary panel
// ---------------------------------------------------------------------------

function CommissionSummaryPanel({ state }: { state: AsyncState<ProducerSummaryRow[]> }) {
  return (
    <PortalCard title="Commission Summary by Producer">
      {state.loading ? (
        <LoadingState label="commission summary" />
      ) : state.error ? (
        <ErrorState message={state.error} />
      ) : !state.data || state.data.length === 0 ? (
        <EmptyState message="No commission records found for your team." />
      ) : (
        <div data-testid="summary-table-wrapper">
          <table style={tableStyle} data-testid="summary-table">
            <thead>
              <tr>
                <th style={thStyle}>Producer</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Accrued</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Payable</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Held</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Records</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((row) => (
                <tr key={row.producer_id} data-testid={`summary-row-${row.producer_id}`}>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {row.producer_id}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {formatCurrency(row.total_accrued)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {formatCurrency(row.total_payable)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {formatCurrency(row.total_held)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{row.record_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// Team Placements panel
// ---------------------------------------------------------------------------

function TeamPlacementsPanel({ state }: { state: AsyncState<TeamPlacementRow[]> }) {
  return (
    <PortalCard title="Team Placements">
      {state.loading ? (
        <LoadingState label="team placements" />
      ) : state.error ? (
        <ErrorState message={state.error} />
      ) : !state.data || state.data.length === 0 ? (
        <EmptyState message="No team placements found." />
      ) : (
        <div data-testid="placements-table-wrapper">
          <table style={tableStyle} data-testid="placements-table">
            <thead>
              <tr>
                <th style={thStyle}>Job Title</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Start Date</th>
                <th style={thStyle}>Created</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((p) => (
                <tr key={p.id} data-testid={`placement-row-${p.id}`}>
                  <td style={tdStyle}>{p.job_title}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle}>{p.status}</span>
                  </td>
                  <td style={tdStyle}>{formatDate(p.start_date)}</td>
                  <td style={tdStyle}>{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// Open Disputes panel
// ---------------------------------------------------------------------------

function OpenDisputesPanel({ state }: { state: AsyncState<TeamDisputeRow[]> }) {
  return (
    <PortalCard title="Open Team Disputes">
      {state.loading ? (
        <LoadingState label="team disputes" />
      ) : state.error ? (
        <ErrorState message={state.error} />
      ) : !state.data || state.data.length === 0 ? (
        <EmptyState message="No open disputes for your team." />
      ) : (
        <div data-testid="disputes-table-wrapper">
          <table style={tableStyle} data-testid="disputes-table">
            <thead>
              <tr>
                <th style={thStyle}>Dispute ID</th>
                <th style={thStyle}>Placement</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((d) => (
                <tr key={d.id} data-testid={`dispute-row-${d.id}`}>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{d.id}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {d.placement_id}
                    </span>
                  </td>
                  <td style={tdStyle}>{d.description}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle}>{d.state}</span>
                  </td>
                  <td style={tdStyle}>{formatDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// Pure view — accepts explicit state props
// ---------------------------------------------------------------------------

export function TeamCommissionViewView({
  summary,
  placements,
  disputes,
}: TeamCommissionViewViewProps) {
  return (
    <div
      data-testid="team-commission-view"
      style={{
        minHeight: '100vh',
        background: '#f9fafb',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <header style={{ marginBottom: '2rem' }}>
          <h1
            data-testid="team-commission-view-heading"
            style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}
          >
            Team Commission View
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
            Commission accruals, placements, and open disputes for your team.
          </p>
        </header>

        <CommissionSummaryPanel state={summary} />
        <TeamPlacementsPanel state={placements} />
        <OpenDisputesPanel state={disputes} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container — fetches from real API endpoints
// ---------------------------------------------------------------------------

export function TeamCommissionView({ onForbidden }: { onForbidden?: () => void }) {
  const summary = useAsync<ProducerSummaryRow[]>(
    () =>
      apiGet<{ summary: ProducerSummaryRow[] }>('/me/team/commission-summary').then(
        (r) => r.summary,
      ),
    [],
  );

  const placements = useAsync<TeamPlacementRow[]>(
    () =>
      apiGet<{ placements: TeamPlacementRow[] }>('/me/team/placements').then((r) => r.placements),
    [],
  );

  const disputes = useAsync<TeamDisputeRow[]>(
    () => apiGet<{ disputes: TeamDisputeRow[] }>('/me/team/disputes').then((r) => r.disputes),
    [],
  );

  // If any endpoint returns 403, invoke the onForbidden callback.
  useEffect(() => {
    const states = [summary, placements, disputes];
    for (const s of states) {
      if (s.error?.includes('403') || s.error?.includes('Forbidden')) {
        onForbidden?.();
        break;
      }
    }
  }, [summary.error, placements.error, disputes.error]);

  return <TeamCommissionViewView summary={summary} placements={placements} disputes={disputes} />;
}

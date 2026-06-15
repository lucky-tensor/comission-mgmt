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
import { StatusChip } from 'ui';
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

const TABLE_CLASS = 'w-full border-collapse text-sm';

const TH_CLASS =
  'text-left px-3 py-2 border-b-2 border-border text-ink-muted font-semibold whitespace-nowrap';

const TH_RIGHT_CLASS = `${TH_CLASS} text-right`;

const TD_CLASS = 'px-3 py-2 border-b border-surface-sunken text-ink align-top';

const TD_RIGHT_CLASS = `${TD_CLASS} text-right`;

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
          <table className={TABLE_CLASS} data-testid="summary-table">
            <thead>
              <tr>
                <th className={TH_CLASS}>Producer</th>
                <th className={TH_RIGHT_CLASS}>Accrued</th>
                <th className={TH_RIGHT_CLASS}>Payable</th>
                <th className={TH_RIGHT_CLASS}>Held</th>
                <th className={TH_RIGHT_CLASS}>Records</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((row) => (
                <tr key={row.producer_id} data-testid={`summary-row-${row.producer_id}`}>
                  <td className={TD_CLASS}>
                    <span className="font-mono text-xs">{row.producer_id}</span>
                  </td>
                  <td className={TD_RIGHT_CLASS}>{formatCurrency(row.total_accrued)}</td>
                  <td className={TD_RIGHT_CLASS}>{formatCurrency(row.total_payable)}</td>
                  <td className={TD_RIGHT_CLASS}>{formatCurrency(row.total_held)}</td>
                  <td className={TD_RIGHT_CLASS}>{row.record_count}</td>
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
          <table className={TABLE_CLASS} data-testid="placements-table">
            <thead>
              <tr>
                <th className={TH_CLASS}>Job Title</th>
                <th className={TH_CLASS}>Status</th>
                <th className={TH_CLASS}>Start Date</th>
                <th className={TH_CLASS}>Created</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((p) => (
                <tr key={p.id} data-testid={`placement-row-${p.id}`}>
                  <td className={TD_CLASS}>{p.job_title}</td>
                  <td className={TD_CLASS}>
                    <StatusChip status={p.status} />
                  </td>
                  <td className={TD_CLASS}>{formatDate(p.start_date)}</td>
                  <td className={TD_CLASS}>{formatDate(p.created_at)}</td>
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
      <div data-testid="open-disputes-panel">
        {state.loading ? (
          <LoadingState label="team disputes" />
        ) : state.error ? (
          <div data-testid="open-disputes-loaded">
            <ErrorState message={state.error} />
          </div>
        ) : !state.data || state.data.length === 0 ? (
          <div data-testid="open-disputes-loaded">
            <EmptyState message="No open disputes for your team." />
          </div>
        ) : (
          <div data-testid="open-disputes-loaded">
            <div data-testid="disputes-table-wrapper">
              <table className={TABLE_CLASS} data-testid="disputes-table">
                <thead>
                  <tr>
                    <th className={TH_CLASS}>Dispute ID</th>
                    <th className={TH_CLASS}>Placement</th>
                    <th className={TH_CLASS}>Description</th>
                    <th className={TH_CLASS}>State</th>
                    <th className={TH_CLASS}>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.map((d) => (
                    <tr key={d.id} data-testid={`dispute-row-${d.id}`}>
                      <td className={TD_CLASS}>
                        <span className="font-mono text-xs">{d.id}</span>
                      </td>
                      <td className={TD_CLASS}>
                        <span className="font-mono text-xs">{d.placement_id}</span>
                      </td>
                      <td className={TD_CLASS}>{d.description}</td>
                      <td className={TD_CLASS}>
                        <StatusChip status={d.state} />
                      </td>
                      <td className={TD_CLASS}>{formatDate(d.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
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
    <div data-testid="team-commission-view" className="min-h-screen bg-surface-muted px-4 py-8">
      <div className="max-w-report mx-auto">
        <header className="mb-8">
          <h1
            data-testid="team-commission-view-heading"
            className="text-xl font-semibold tracking-tight text-ink m-0"
          >
            Team Commission View
          </h1>
          <p className="text-sm text-ink-subtle mt-1 mb-0">
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

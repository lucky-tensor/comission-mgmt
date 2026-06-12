/**
 * DrawBalanceView — HR / People Ops surface for viewing a producer's draw
 * balance and clawback recovery schedules.
 *
 * Behaviour:
 *   An HR operator selects a producer from a text input (producer UUID) and
 *   sees their outstanding draw balance and per-placement clawback recovery
 *   schedules. Read-only.
 *
 * Data sources:
 *   GET /producers/:id/draw-balance — returns draw_balance + recovery_schedules
 *     (per-producer endpoint added in issue #124).
 *
 * States rendered:
 *   - idle      — before any producer is selected (prompt to select)
 *   - loading   — while the fetch is in-flight
 *   - error     — when the fetch fails (ApiError or network)
 *   - empty     — when the producer has no draw and no recovery schedules
 *   - data      — outstanding balance + recovery schedule table
 *
 * Role gating:
 *   This component is only routed to by HR users (role guard lives in App.tsx).
 *   The backend also enforces HR/Producer RBAC on the read endpoint.
 *
 * No Vitest mocking helpers are used — all fetch calls hit the real API server.
 *
 * Canonical docs: docs/prd.md §4 (HR / People Ops), §6 (Draw Balance)
 * Issue: feat: HR/People Ops UI — draw balance and recovery schedule view (#115)
 */

import { useState } from 'react';
import { StatusChip } from 'ui';
import { apiGet } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { formatCurrency, formatDate } from '../../lib/format';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';
import { EntityPicker } from '../EntityPicker';

/** Producer row used to populate the HR draw-balance picker. */
export interface ProducerOption {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Types — mirror the draw-balance API response shape
// ---------------------------------------------------------------------------

export interface DrawBalance {
  id: string | null;
  status: string | null;
  outstanding_balance: string;
  draw_limit: string;
  recovery_start: string | null;
  recovery_end: string | null;
  updated_at: string | null;
}

export interface RecoverySchedule {
  id: string;
  clawback_event_id: string;
  commission_record_id: string;
  placement_id: string;
  clawback_amount: string;
  installment_count: number;
  installment_amount: string;
  created_at: string;
}

export interface DrawBalanceResponse {
  producer_id: string;
  draw_balance: DrawBalance;
  recovery_schedules: RecoverySchedule[];
}

// ---------------------------------------------------------------------------
// DrawBalanceSummary — outstanding draw balance card
// ---------------------------------------------------------------------------

interface DrawBalanceSummaryProps {
  balance: DrawBalance;
}

function DrawBalanceSummary({ balance }: DrawBalanceSummaryProps) {
  const hasBalance = Number(balance.outstanding_balance) > 0;
  const cardClass = hasBalance
    ? 'bg-warn-bg border border-warn-fg/30'
    : 'bg-ok-bg border border-ok-fg/30';
  const amountClass = hasBalance ? 'text-warn-fg' : 'text-ok-fg';

  return (
    <div data-testid="draw-balance-summary" className={`${cardClass} rounded-xl p-6 mb-6`}>
      <div className="flex justify-between items-start flex-wrap gap-4">
        <div>
          <p className="mt-0 mx-0 mb-1 text-sm text-ink-subtle">Outstanding Draw Balance</p>
          <p data-testid="outstanding-balance" className={`m-0 text-3xl font-bold ${amountClass}`}>
            {formatCurrency(balance.outstanding_balance)}
          </p>
        </div>
        <div>
          <p className="mt-0 mx-0 mb-1 text-sm text-ink-subtle">Draw Limit</p>
          <p data-testid="draw-limit" className="m-0 text-xl font-semibold text-ink-muted">
            {formatCurrency(balance.draw_limit)}
          </p>
        </div>
        {balance.status && (
          <div>
            <p className="mt-0 mx-0 mb-1 text-sm text-ink-subtle">Status</p>
            <StatusChip variant={hasBalance ? 'amber' : 'green'} data-testid="draw-balance-status">
              {balance.status}
            </StatusChip>
          </div>
        )}
      </div>
      {(balance.recovery_start || balance.recovery_end) && (
        <div className="mt-4 flex gap-8 flex-wrap">
          {balance.recovery_start && (
            <div>
              <p className="mt-0 mx-0 mb-0.5 text-xs text-ink-subtle">Recovery Start</p>
              <p data-testid="recovery-start" className="m-0 text-sm text-ink-muted">
                {formatDate(balance.recovery_start)}
              </p>
            </div>
          )}
          {balance.recovery_end && (
            <div>
              <p className="mt-0 mx-0 mb-0.5 text-xs text-ink-subtle">Recovery End</p>
              <p data-testid="recovery-end" className="m-0 text-sm text-ink-muted">
                {formatDate(balance.recovery_end)}
              </p>
            </div>
          )}
          {balance.updated_at && (
            <div>
              <p className="mt-0 mx-0 mb-0.5 text-xs text-ink-subtle">Last Updated</p>
              <p className="m-0 text-sm text-ink-muted">{formatDate(balance.updated_at)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecoveryScheduleTable — clawback recovery schedule rows
// ---------------------------------------------------------------------------

interface RecoveryScheduleTableProps {
  schedules: RecoverySchedule[];
}

function RecoveryScheduleTable({ schedules }: RecoveryScheduleTableProps) {
  if (schedules.length === 0) {
    return <EmptyState message="No clawback recovery schedules for this producer." />;
  }

  return (
    <div data-testid="recovery-schedule-table" className="overflow-x-auto">
      <table className="w-full border-collapse text-sm text-ink-muted">
        <thead>
          <tr className="border-b-2 border-border">
            <th className={TH_CLASS}>Placement ID</th>
            <th className={TH_CLASS}>Clawback Amount</th>
            <th className={TH_CLASS}>Installments</th>
            <th className={TH_CLASS}>Per Installment</th>
            <th className={TH_CLASS}>Created</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr
              key={s.id}
              data-testid={`recovery-row-${s.id}`}
              className="border-b border-surface-sunken"
            >
              <td className={TD_CLASS}>
                <span title={s.placement_id} className="font-mono text-[0.8125rem]">
                  {s.placement_id.slice(0, 8)}…
                </span>
              </td>
              <td className={`${TD_CLASS} font-semibold text-warn-fg`}>
                {formatCurrency(s.clawback_amount)}
              </td>
              <td className={TD_CLASS}>{s.installment_count}</td>
              <td className={TD_CLASS}>{formatCurrency(s.installment_amount)}</td>
              <td className={TD_CLASS}>{formatDate(s.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TH_CLASS =
  'text-left px-3 py-2.5 font-semibold text-ink-subtle text-[0.8125rem] uppercase tracking-wider';

const TD_CLASS = 'p-3 align-top';

// ---------------------------------------------------------------------------
// ProducerDrawBalancePanel — fetching panel for a given producerId
// ---------------------------------------------------------------------------

interface ProducerDrawBalancePanelProps {
  producerId: string;
}

function ProducerDrawBalancePanel({ producerId }: ProducerDrawBalancePanelProps) {
  const drawState = useAsync<DrawBalanceResponse>(
    () => apiGet<DrawBalanceResponse>(`/producers/${producerId}/draw-balance`),
    [producerId],
  );

  return (
    <div data-testid="draw-balance-panel">
      {drawState.loading && <LoadingState label="draw balance" />}
      {!drawState.loading && drawState.error && <ErrorState message={drawState.error} />}
      {!drawState.loading && !drawState.error && drawState.data && (
        <>
          <DrawBalanceSummary balance={drawState.data.draw_balance} />
          <PortalCard
            title={`Clawback Recovery Schedules (${drawState.data.recovery_schedules.length})`}
          >
            <RecoveryScheduleTable schedules={drawState.data.recovery_schedules} />
          </PortalCard>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DrawBalanceView — main HR surface component
// ---------------------------------------------------------------------------

export function DrawBalanceView() {
  const [selectedProducerId, setSelectedProducerId] = useState<string | null>(null);

  const producers = useAsync<ProducerOption[]>(
    () => apiGet<{ producers: ProducerOption[] }>('/producers').then((r) => r.producers),
    [],
  );

  return (
    <div
      data-testid="draw-balance-view"
      className="min-h-[calc(100vh-3.25rem)] bg-surface-muted px-4 py-8"
    >
      <div className="max-w-[880px] mx-auto">
        <header className="mb-6">
          <h1
            data-testid="draw-balance-heading"
            className="text-2xl font-bold text-ink mt-0 mx-0 mb-1"
          >
            Draw Balance &amp; Recovery Schedule
          </h1>
          <p className="text-sm text-ink-subtle m-0">
            View a producer's outstanding draw balance and their clawback recovery schedules.
            Read-only — contact Finance Admin to post adjustments.
          </p>
        </header>

        {/* Producer selector — pick a producer by name, not a UUID (#203). */}
        <div
          data-testid="producer-selector"
          className="bg-surface border border-border rounded-xl px-6 py-5 mb-6"
        >
          <EntityPicker
            name="producer"
            label="Producer"
            state={producers}
            value={selectedProducerId}
            onChange={setSelectedProducerId}
            toOption={(p) => ({ id: p.id, label: p.name })}
            placeholder="Select a producer…"
            emptyMessage="No producers found for this organization."
          />
        </div>

        {/* Draw balance panel — renders once a producer is selected */}
        {!selectedProducerId && (
          <EmptyState message="Select a producer above to view their draw balance and recovery schedule." />
        )}
        {selectedProducerId && (
          <ProducerDrawBalancePanel key={selectedProducerId} producerId={selectedProducerId} />
        )}
      </div>
    </div>
  );
}

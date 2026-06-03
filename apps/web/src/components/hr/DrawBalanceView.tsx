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
import { apiGet } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { formatCurrency, formatDate } from '../../lib/format';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';

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
  const statusColor = hasBalance ? '#b45309' : '#15803d';
  const bgColor = hasBalance ? '#fefce8' : '#f0fdf4';
  const borderColor = hasBalance ? '#fde68a' : '#bbf7d0';

  return (
    <div
      data-testid="draw-balance-summary"
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: '0.75rem',
        padding: '1.5rem',
        marginBottom: '1.5rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: '#6b7280' }}>
            Outstanding Draw Balance
          </p>
          <p
            data-testid="outstanding-balance"
            style={{ margin: 0, fontSize: '1.875rem', fontWeight: 700, color: statusColor }}
          >
            {formatCurrency(balance.outstanding_balance)}
          </p>
        </div>
        <div>
          <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: '#6b7280' }}>
            Draw Limit
          </p>
          <p
            data-testid="draw-limit"
            style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#374151' }}
          >
            {formatCurrency(balance.draw_limit)}
          </p>
        </div>
        {balance.status && (
          <div>
            <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: '#6b7280' }}>Status</p>
            <span
              data-testid="draw-balance-status"
              style={{
                display: 'inline-block',
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                background: statusColor,
                color: '#fff',
              }}
            >
              {balance.status}
            </span>
          </div>
        )}
      </div>
      {(balance.recovery_start || balance.recovery_end) && (
        <div style={{ marginTop: '1rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          {balance.recovery_start && (
            <div>
              <p style={{ margin: '0 0 0.125rem', fontSize: '0.75rem', color: '#6b7280' }}>
                Recovery Start
              </p>
              <p
                data-testid="recovery-start"
                style={{ margin: 0, fontSize: '0.875rem', color: '#374151' }}
              >
                {formatDate(balance.recovery_start)}
              </p>
            </div>
          )}
          {balance.recovery_end && (
            <div>
              <p style={{ margin: '0 0 0.125rem', fontSize: '0.75rem', color: '#6b7280' }}>
                Recovery End
              </p>
              <p
                data-testid="recovery-end"
                style={{ margin: 0, fontSize: '0.875rem', color: '#374151' }}
              >
                {formatDate(balance.recovery_end)}
              </p>
            </div>
          )}
          {balance.updated_at && (
            <div>
              <p style={{ margin: '0 0 0.125rem', fontSize: '0.75rem', color: '#6b7280' }}>
                Last Updated
              </p>
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151' }}>
                {formatDate(balance.updated_at)}
              </p>
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
    <div data-testid="recovery-schedule-table" style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
          color: '#374151',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={thStyle}>Placement ID</th>
            <th style={thStyle}>Clawback Amount</th>
            <th style={thStyle}>Installments</th>
            <th style={thStyle}>Per Installment</th>
            <th style={thStyle}>Created</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr
              key={s.id}
              data-testid={`recovery-row-${s.id}`}
              style={{ borderBottom: '1px solid #f3f4f6' }}
            >
              <td style={tdStyle}>
                <span
                  title={s.placement_id}
                  style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
                >
                  {s.placement_id.slice(0, 8)}…
                </span>
              </td>
              <td style={{ ...tdStyle, fontWeight: 600, color: '#b45309' }}>
                {formatCurrency(s.clawback_amount)}
              </td>
              <td style={tdStyle}>{s.installment_count}</td>
              <td style={tdStyle}>{formatCurrency(s.installment_amount)}</td>
              <td style={tdStyle}>{formatDate(s.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.625rem 0.75rem',
  fontWeight: 600,
  color: '#6b7280',
  fontSize: '0.8125rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem',
  verticalAlign: 'top',
};

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
  const [inputValue, setInputValue] = useState('');
  const [selectedProducerId, setSelectedProducerId] = useState<string | null>(null);

  function handleLookup() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setSelectedProducerId(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleLookup();
  }

  return (
    <div
      data-testid="draw-balance-view"
      style={{
        minHeight: 'calc(100vh - 3.25rem)',
        background: '#f9fafb',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '880px', margin: '0 auto' }}>
        <header style={{ marginBottom: '1.5rem' }}>
          <h1
            data-testid="draw-balance-heading"
            style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: '0 0 0.25rem' }}
          >
            Draw Balance &amp; Recovery Schedule
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
            View a producer's outstanding draw balance and their clawback recovery schedules.
            Read-only — contact Finance Admin to post adjustments.
          </p>
        </header>

        {/* Producer selector */}
        <div
          data-testid="producer-selector"
          style={{
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '0.75rem',
            padding: '1.25rem 1.5rem',
            marginBottom: '1.5rem',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 280px' }}>
            <label
              htmlFor="producer-id-input"
              style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: '#374151',
                marginBottom: '0.375rem',
              }}
            >
              Producer ID
            </label>
            <input
              id="producer-id-input"
              data-testid="producer-id-input"
              type="text"
              placeholder="Enter producer UUID…"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                fontFamily: 'monospace',
              }}
            />
          </div>
          <button
            data-testid="lookup-btn"
            onClick={handleLookup}
            disabled={!inputValue.trim()}
            style={{
              padding: '0.5625rem 1.25rem',
              background: inputValue.trim() ? '#2563eb' : '#e5e7eb',
              color: inputValue.trim() ? '#ffffff' : '#9ca3af',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
              fontWeight: 600,
              fontSize: '0.875rem',
            }}
          >
            Look Up
          </button>
        </div>

        {/* Draw balance panel — renders once a producer is selected */}
        {!selectedProducerId && (
          <EmptyState message="Enter a producer ID above to view their draw balance and recovery schedule." />
        )}
        {selectedProducerId && (
          <ProducerDrawBalancePanel key={selectedProducerId} producerId={selectedProducerId} />
        )}
      </div>
    </div>
  );
}

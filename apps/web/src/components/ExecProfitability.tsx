/**
 * ExecProfitability — Executive profitability analytics surface.
 *
 * Renders profitability broken down by the dimensions available in the
 * GET /analytics/executive response (client, recruiter). The team and practice
 * dimensions are not yet present in the analytics response — they are flagged
 * as needing a backend field rather than fabricated.
 *
 * Features:
 *   - Dimension switcher: client | recruiter | team (unavailable) | practice (unavailable)
 *   - Period selector (period_start / period_end)
 *   - Sortable table: clicking "Margin" column header toggles asc/desc
 *   - Loading / empty / error states
 *   - Role-gated: only Executive or FinanceAdmin may access; others see 403 via App routing.
 *
 * Pure view + container split following the portal component pattern.
 *
 * Canonical docs: docs/prd.md §4 (Executive)
 * Issue: feat: Executive UI — profitability analytics (#111)
 */

import { useState } from 'react';
import { apiGet } from '../lib/apiClient';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { formatCurrency } from '../lib/format';
import { LoadingState, ErrorState, EmptyState } from './portal/states';

// ---------------------------------------------------------------------------
// Analytics response shapes (mirrors packages/db/src/analytics-executive.ts)
// ---------------------------------------------------------------------------

interface ProfitabilityByClient {
  clientId: string;
  grossFees: string;
  commissionBurden: string;
}

interface ProfitabilityByProducer {
  producerId: string;
  grossCommission: string;
  netPayable: string;
}

interface ExecutiveAnalytics {
  period: { start: string; end: string };
  gross_fees_booked: string;
  net_fee_income: string;
  commission_accrued: string;
  commission_payable: string;
  commission_held: string;
  clawback_exposure: string;
  guarantee_exposure: string;
  disputed_commission: string;
  exception_rate: number;
  dispute_rate: number;
  total_placements: number;
  profitability_by_client: ProfitabilityByClient[];
  profitability_by_producer: ProfitabilityByProducer[];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Dimension = 'client' | 'recruiter' | 'team' | 'practice';
export type SortDir = 'asc' | 'desc';

export interface ProfitabilityRow {
  label: string;
  grossFees: number;
  commissionBurden: number;
  /** margin = (grossFees - commissionBurden) / grossFees; null when grossFees = 0 */
  margin: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRows(
  data: ExecutiveAnalytics,
  dimension: Dimension,
): ProfitabilityRow[] | 'unavailable' {
  if (dimension === 'team' || dimension === 'practice') {
    return 'unavailable';
  }

  if (dimension === 'client') {
    return data.profitability_by_client.map((c: ProfitabilityByClient) => {
      const gross = parseFloat(c.grossFees) || 0;
      const burden = parseFloat(c.commissionBurden) || 0;
      const margin = gross > 0 ? (gross - burden) / gross : null;
      return { label: c.clientId, grossFees: gross, commissionBurden: burden, margin };
    });
  }

  // recruiter
  return data.profitability_by_producer.map((p: ProfitabilityByProducer) => {
    const gross = parseFloat(p.grossCommission) || 0;
    const net = parseFloat(p.netPayable) || 0;
    // For producer rows: margin = (gross - net) / gross — net payable is the commission burden
    const margin = gross > 0 ? (gross - net) / gross : null;
    return { label: p.producerId, grossFees: gross, commissionBurden: net, margin };
  });
}

function sortRows(rows: ProfitabilityRow[], sortDir: SortDir): ProfitabilityRow[] {
  return [...rows].sort((a, b) => {
    const ma = a.margin ?? -Infinity;
    const mb = b.margin ?? -Infinity;
    return sortDir === 'asc' ? ma - mb : mb - ma;
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: 'client', label: 'Client' },
  { value: 'recruiter', label: 'Recruiter' },
  { value: 'team', label: 'Team' },
  { value: 'practice', label: 'Practice' },
];

interface DimensionSwitcherProps {
  active: Dimension;
  onChange: (d: Dimension) => void;
}

function DimensionSwitcher({ active, onChange }: DimensionSwitcherProps) {
  return (
    <div
      data-testid="dimension-switcher"
      style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}
    >
      {DIMENSIONS.map(({ value, label }) => (
        <button
          key={value}
          data-testid={`dim-btn-${value}`}
          onClick={() => onChange(value)}
          style={{
            padding: '0.375rem 0.875rem',
            borderRadius: '999px',
            border: active === value ? '1.5px solid #2563eb' : '1px solid #d1d5db',
            background: active === value ? '#eff6ff' : '#ffffff',
            color: active === value ? '#1d4ed8' : '#374151',
            fontWeight: active === value ? 600 : 400,
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface PeriodPickerProps {
  start: string;
  end: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}

function PeriodPicker({ start, end, onStartChange, onEndChange }: PeriodPickerProps) {
  return (
    <div
      data-testid="period-picker"
      style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem' }}
    >
      <label style={{ fontSize: '0.875rem', color: '#374151' }}>
        From&nbsp;
        <input
          data-testid="period-start"
          type="date"
          value={start}
          onChange={(e) => onStartChange(e.target.value)}
          style={{ marginLeft: '0.25rem' }}
        />
      </label>
      <label style={{ fontSize: '0.875rem', color: '#374151' }}>
        To&nbsp;
        <input
          data-testid="period-end"
          type="date"
          value={end}
          onChange={(e) => onEndChange(e.target.value)}
          style={{ marginLeft: '0.25rem' }}
        />
      </label>
    </div>
  );
}

interface ProfitabilityTableProps {
  rows: ProfitabilityRow[];
  sortDir: SortDir;
  onSortToggle: () => void;
  dimension: Dimension;
}

function ProfitabilityTable({ rows, sortDir, onSortToggle, dimension }: ProfitabilityTableProps) {
  const labelHeader = dimension === 'client' ? 'Client' : 'Recruiter';
  const grossLabel = dimension === 'client' ? 'Gross Fees' : 'Gross Commission';
  const burdenLabel = dimension === 'client' ? 'Commission Burden' : 'Net Payable';

  if (rows.length === 0) {
    return <EmptyState message={`No ${dimension} profitability data for the selected period.`} />;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        data-testid="profitability-table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th
              style={{
                textAlign: 'left',
                padding: '0.5rem 0.75rem',
                color: '#374151',
                fontWeight: 600,
              }}
            >
              {labelHeader}
            </th>
            <th
              style={{
                textAlign: 'right',
                padding: '0.5rem 0.75rem',
                color: '#374151',
                fontWeight: 600,
              }}
            >
              {grossLabel}
            </th>
            <th
              style={{
                textAlign: 'right',
                padding: '0.5rem 0.75rem',
                color: '#374151',
                fontWeight: 600,
              }}
            >
              {burdenLabel}
            </th>
            <th
              data-testid="sort-margin-btn"
              onClick={onSortToggle}
              style={{
                textAlign: 'right',
                padding: '0.5rem 0.75rem',
                color: '#1d4ed8',
                fontWeight: 600,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              Margin {sortDir === 'desc' ? '▼' : '▲'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              data-testid="profitability-row"
              style={{
                borderBottom: '1px solid #f3f4f6',
                background: i % 2 === 0 ? '#ffffff' : '#f9fafb',
              }}
            >
              <td style={{ padding: '0.5rem 0.75rem', color: '#111827', fontFamily: 'monospace' }}>
                {row.label}
              </td>
              <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#111827' }}>
                {formatCurrency(row.grossFees)}
              </td>
              <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#111827' }}>
                {formatCurrency(row.commissionBurden)}
              </td>
              <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#111827' }}>
                {row.margin === null ? '—' : `${(row.margin * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure view
// ---------------------------------------------------------------------------

export interface ExecProfitabilityViewProps {
  state: AsyncState<ExecutiveAnalytics | null>;
  dimension: Dimension;
  periodStart: string;
  periodEnd: string;
  sortDir: SortDir;
  onDimensionChange: (d: Dimension) => void;
  onSortToggle: () => void;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}

export function ExecProfitabilityView({
  state,
  dimension,
  periodStart,
  periodEnd,
  sortDir,
  onDimensionChange,
  onSortToggle,
  onStartChange,
  onEndChange,
}: ExecProfitabilityViewProps) {
  return (
    <section
      data-testid="exec-profitability"
      style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '0.75rem',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827', marginTop: 0 }}>
        Profitability Analytics
      </h2>

      <DimensionSwitcher active={dimension} onChange={onDimensionChange} />
      <PeriodPicker
        start={periodStart}
        end={periodEnd}
        onStartChange={onStartChange}
        onEndChange={onEndChange}
      />

      {state.loading ? (
        <LoadingState label="profitability data" />
      ) : state.error ? (
        <ErrorState message={state.error} />
      ) : !state.data ? (
        <EmptyState message="No analytics data available for the selected period." />
      ) : dimension === 'team' || dimension === 'practice' ? (
        <div
          data-testid="dimension-unavailable"
          style={{
            padding: '1rem',
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            color: '#92400e',
          }}
        >
          The <strong>{dimension}</strong> dimension is not yet available in the analytics response
          — a backend field is needed. Dimensions available: client, recruiter.
        </div>
      ) : (
        <ProfitabilityTable
          rows={sortRows(toRows(state.data, dimension) as ProfitabilityRow[], sortDir)}
          sortDir={sortDir}
          onSortToggle={onSortToggle}
          dimension={dimension}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

function defaultPeriod(): { start: string; end: string } {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { start, end };
}

export function ExecProfitability() {
  const [dimension, setDimension] = useState<Dimension>('client');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const defaultP = defaultPeriod();
  const [periodStart, setPeriodStart] = useState(defaultP.start);
  const [periodEnd, setPeriodEnd] = useState(defaultP.end);

  const state = useAsync<ExecutiveAnalytics | null>(
    () =>
      apiGet<ExecutiveAnalytics>(
        `/analytics/executive?period_start=${periodStart}&period_end=${periodEnd}`,
      ),
    [periodStart, periodEnd],
  );

  function toggleSort() {
    setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
  }

  return (
    <ExecProfitabilityView
      state={state}
      dimension={dimension}
      periodStart={periodStart}
      periodEnd={periodEnd}
      sortDir={sortDir}
      onDimensionChange={setDimension}
      onSortToggle={toggleSort}
      onStartChange={setPeriodStart}
      onEndChange={setPeriodEnd}
    />
  );
}

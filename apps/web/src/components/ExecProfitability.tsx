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
  /** Human-readable client name (server-derived); shown instead of the UUID. */
  clientName: string;
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
      // Show the human-readable client name, never the raw UUID (#203).
      return {
        label: c.clientName || c.clientId,
        grossFees: gross,
        commissionBurden: burden,
        margin,
      };
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
    <div data-testid="dimension-switcher" className="flex gap-2 mb-4 flex-wrap">
      {DIMENSIONS.map(({ value, label }) => (
        <button
          key={value}
          data-testid={`dim-btn-${value}`}
          onClick={() => onChange(value)}
          className={[
            'px-3.5 py-1.5 rounded-full text-sm cursor-pointer border',
            active === value
              ? 'border-accent bg-surface-sunken text-accent font-semibold'
              : 'border-border-strong bg-surface text-ink-muted font-normal',
          ].join(' ')}
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
    <div data-testid="period-picker" className="flex gap-4 items-center mb-5">
      <label className="text-sm text-ink-muted">
        From&nbsp;
        <input
          data-testid="period-start"
          type="date"
          value={start}
          onChange={(e) => onStartChange(e.target.value)}
          className="ml-1"
        />
      </label>
      <label className="text-sm text-ink-muted">
        To&nbsp;
        <input
          data-testid="period-end"
          type="date"
          value={end}
          onChange={(e) => onEndChange(e.target.value)}
          className="ml-1"
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
    <div className="overflow-x-auto">
      <table data-testid="profitability-table" className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-border">
            <th className="text-left px-3 py-2 text-ink-muted font-semibold">{labelHeader}</th>
            <th className="text-right px-3 py-2 text-ink-muted font-semibold">{grossLabel}</th>
            <th className="text-right px-3 py-2 text-ink-muted font-semibold">{burdenLabel}</th>
            <th
              data-testid="sort-margin-btn"
              onClick={onSortToggle}
              className="text-right px-3 py-2 text-accent font-semibold cursor-pointer select-none"
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
              className={[
                'border-b border-surface-sunken',
                i % 2 === 0 ? 'bg-surface' : 'bg-surface-muted',
              ].join(' ')}
            >
              <td
                className={[
                  'px-3 py-2 text-ink',
                  // Client rows show human-readable names; recruiter rows still
                  // surface raw ids, which read better in monospace.
                  dimension === 'client' ? '' : 'font-mono',
                ].join(' ')}
              >
                {row.label}
              </td>
              <td className="px-3 py-2 text-right text-ink">{formatCurrency(row.grossFees)}</td>
              <td className="px-3 py-2 text-right text-ink">
                {formatCurrency(row.commissionBurden)}
              </td>
              <td className="px-3 py-2 text-right text-ink">
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
      className="bg-surface border border-border rounded-xl p-6 mb-6"
    >
      <h2 className="text-lg font-semibold text-ink mt-0">Profitability Analytics</h2>

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
          className="p-4 bg-warn-bg border border-warn-fg/30 rounded-lg text-sm text-warn-fg"
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

/**
 * ExecFinancialPosition — Executive financial-position dashboard.
 *
 * Renders the five headline metrics from GET /analytics/executive for a
 * selectable period:
 *   - Gross fees booked
 *   - Net fee income
 *   - Commission accrued
 *   - Commission payable
 *   - Clawback exposure
 *
 * The period defaults to the current calendar month. Changing either date
 * input re-fetches the analytics endpoint and re-renders.
 *
 * States rendered:
 *   - loading   — while the fetch is in-flight
 *   - error     — when the fetch fails (ApiError or network)
 *   - empty     — when the server returns a period with zero placements
 *   - data      — five-metric grid stamped with the period
 *
 * RBAC: only Executive (and FinanceAdmin) may reach /executive via roleRoutes.
 * A non-Executive who somehow navigates here will receive a 403 from the API;
 * the error state surfaces that message.
 *
 * Canonical docs: docs/prd.md §4 (Executive), §5 (close overview)
 * Issue: feat: Executive UI — firm financial position dashboard (#110)
 */

import { useState } from 'react';
import { apiGet } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { formatCurrency } from '../../lib/format';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';

// ---------------------------------------------------------------------------
// Types (mirrors ExecutiveAnalytics from packages/db/src/analytics-executive.ts)
// ---------------------------------------------------------------------------

export interface ExecAnalytics {
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return YYYY-MM-01 for the first day of the current calendar month. */
function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Return YYYY-MM-DD for today. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// View component (pure presentational — renders ExecAnalytics or state)
// ---------------------------------------------------------------------------

const containerClass = 'min-h-surface bg-surface-muted p-8';

const periodBarClass = 'flex items-center gap-3 mb-6 flex-wrap';

const labelClass = 'text-sm font-semibold text-ink-muted';

const inputClass = 'text-sm border border-border-strong rounded-md px-2 py-1.5 text-ink';

const gridClass = 'grid grid-cols-metrics gap-4 mt-2';

const metricCardClass = 'bg-surface border border-border rounded-md p-5';

const metricLabelClass = 'text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-2';

const metricValueClass = 'text-2xl font-bold text-ink';

const periodStampClass = 'text-xs text-ink-faint mt-4';

interface MetricTileProps {
  label: string;
  value: string;
  testId: string;
}

function MetricTile({ label, value, testId }: MetricTileProps) {
  return (
    <div className={metricCardClass} data-testid={testId}>
      <div className={metricLabelClass}>{label}</div>
      <div className={metricValueClass} data-testid={`${testId}-value`}>
        {value}
      </div>
    </div>
  );
}

export interface ExecFinancialPositionViewProps {
  periodStart: string;
  periodEnd: string;
  onPeriodStartChange: (v: string) => void;
  onPeriodEndChange: (v: string) => void;
  analytics: ExecAnalytics | null;
  loading: boolean;
  error: string | null;
}

export function ExecFinancialPositionView({
  periodStart,
  periodEnd,
  onPeriodStartChange,
  onPeriodEndChange,
  analytics,
  loading,
  error,
}: ExecFinancialPositionViewProps) {
  return (
    <div className={containerClass} data-testid="exec-financial-position">
      <h1 className="text-xl font-bold text-ink mb-6">Firm Financial Position</h1>

      {/* Period selector */}
      <div className={periodBarClass}>
        <span className={labelClass}>Period:</span>
        <label className={labelClass} htmlFor="exec-period-start">
          From
        </label>
        <input
          id="exec-period-start"
          data-testid="period-start-input"
          type="date"
          value={periodStart}
          onChange={(e) => onPeriodStartChange(e.target.value)}
          className={inputClass}
        />
        <label className={labelClass} htmlFor="exec-period-end">
          To
        </label>
        <input
          id="exec-period-end"
          data-testid="period-end-input"
          type="date"
          value={periodEnd}
          onChange={(e) => onPeriodEndChange(e.target.value)}
          className={inputClass}
        />
      </div>

      {/* States */}
      {loading && <LoadingState label="financial position" />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && analytics !== null && analytics.total_placements === 0 && (
        <EmptyState message="No placements found for the selected period." />
      )}

      {/* Data */}
      {!loading && !error && analytics !== null && analytics.total_placements > 0 && (
        <PortalCard title="Headline Metrics">
          <div className={gridClass}>
            <MetricTile
              label="Gross Fees Booked"
              value={formatCurrency(analytics.gross_fees_booked)}
              testId="metric-gross-fees"
            />
            <MetricTile
              label="Net Fee Income"
              value={formatCurrency(analytics.net_fee_income)}
              testId="metric-net-fee-income"
            />
            <MetricTile
              label="Commission Accrued"
              value={formatCurrency(analytics.commission_accrued)}
              testId="metric-commission-accrued"
            />
            <MetricTile
              label="Commission Payable"
              value={formatCurrency(analytics.commission_payable)}
              testId="metric-commission-payable"
            />
            <MetricTile
              label="Clawback Exposure"
              value={formatCurrency(analytics.clawback_exposure)}
              testId="metric-clawback-exposure"
            />
          </div>
          <p className={periodStampClass} data-testid="period-stamp">
            Period: {analytics.period.start} — {analytics.period.end}
          </p>
        </PortalCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connected component — fetches from the real API
// ---------------------------------------------------------------------------

export function ExecFinancialPosition() {
  const [periodStart, setPeriodStart] = useState(currentMonthStart);
  const [periodEnd, setPeriodEnd] = useState(today);

  const { data, loading, error } = useAsync<ExecAnalytics>(
    () =>
      apiGet<ExecAnalytics>(
        `/analytics/executive?period_start=${periodStart}&period_end=${periodEnd}`,
      ),
    [periodStart, periodEnd],
  );

  return (
    <ExecFinancialPositionView
      periodStart={periodStart}
      periodEnd={periodEnd}
      onPeriodStartChange={setPeriodStart}
      onPeriodEndChange={setPeriodEnd}
      analytics={data}
      loading={loading}
      error={error}
    />
  );
}

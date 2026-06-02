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

const containerStyle: React.CSSProperties = {
  minHeight: 'calc(100vh - 3.25rem)',
  background: '#f9fafb',
  padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
};

const periodBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  marginBottom: '1.5rem',
  flexWrap: 'wrap',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#374151',
};

const inputStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.375rem',
  padding: '0.375rem 0.5rem',
  color: '#111827',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '1rem',
  marginTop: '0.5rem',
};

const metricCardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '0.75rem',
  padding: '1.25rem',
};

const metricLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.5rem',
};

const metricValueStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 700,
  color: '#111827',
};

const periodStampStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#9ca3af',
  marginTop: '1rem',
};

interface MetricTileProps {
  label: string;
  value: string;
  testId: string;
}

function MetricTile({ label, value, testId }: MetricTileProps) {
  return (
    <div style={metricCardStyle} data-testid={testId}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={metricValueStyle} data-testid={`${testId}-value`}>
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
    <div style={containerStyle} data-testid="exec-financial-position">
      <h1
        style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', marginBottom: '1.5rem' }}
      >
        Firm Financial Position
      </h1>

      {/* Period selector */}
      <div style={periodBarStyle}>
        <span style={labelStyle}>Period:</span>
        <label style={labelStyle} htmlFor="exec-period-start">
          From
        </label>
        <input
          id="exec-period-start"
          data-testid="period-start-input"
          type="date"
          value={periodStart}
          onChange={(e) => onPeriodStartChange(e.target.value)}
          style={inputStyle}
        />
        <label style={labelStyle} htmlFor="exec-period-end">
          To
        </label>
        <input
          id="exec-period-end"
          data-testid="period-end-input"
          type="date"
          value={periodEnd}
          onChange={(e) => onPeriodEndChange(e.target.value)}
          style={inputStyle}
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
          <div style={gridStyle}>
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
          <p style={periodStampStyle} data-testid="period-stamp">
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

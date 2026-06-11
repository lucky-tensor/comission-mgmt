/**
 * ExecTrends — Executive surface for exception-rate and dispute-rate trends.
 *
 * Composed of:
 *   - ExecTrendsView   — pure presentational view (accepts explicit state props
 *     so tests render each state in real headless Chromium without any network
 *     interaction)
 *   - ExecTrends       — container wiring real API calls via apiClient
 *
 * Design decisions:
 *   - `GET /analytics/executive` accepts `period_start` / `period_end` and
 *     returns a single-period aggregated metric bag, including `exception_rate`
 *     and `dispute_rate`. To produce time-series data the container fans out one
 *     request per monthly bucket within the selected range and collects the
 *     results into an ordered series. This avoids requiring a new backend
 *     endpoint (see issue #112 out-of-scope note).
 *   - Read-only; no mutation.
 *   - Accessible to Executive role only (App.tsx gates the route; Forbidden is
 *     rendered for all other roles by the shell).
 *   - No vi.mock / vi.fn / vi.spyOn — mock-ban gate compliant.
 *
 * API endpoints used:
 *   GET /analytics/executive?period_start=YYYY-MM-DD&period_end=YYYY-MM-DD
 *
 * Canonical docs: docs/prd.md §4 (Executive), §5.4
 * Issue: feat: Executive UI — exception and dispute-rate trends (#112)
 */

import { useState, useEffect } from 'react';
import { apiGet } from '../../lib/apiClient';

/**
 * Default trends range — the last six months through today. The UX review
 * (docs/ux-review.md §3) wants the user to land on a populated trend, not an
 * empty date form, so this range loads on mount and the form filters it.
 */
export function defaultTrendsRange(): { start: string; end: string } {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 5);
  startDate.setDate(1);
  const start = startDate.toISOString().slice(0, 10);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutiveAnalytics {
  period: { start: string; end: string };
  exception_rate: number;
  dispute_rate: number;
  total_placements: number;
  gross_fees_booked: number | string;
  net_fee_income: number | string;
  commission_accrued: number | string;
  commission_payable: number | string;
  commission_held: number | string;
  clawback_exposure: number | string;
  guarantee_exposure: number | string;
  disputed_commission: number | string;
  profitability_by_client: unknown[];
  profitability_by_producer: unknown[];
}

/** One bucket in the trend series — one month (or one custom sub-period). */
export interface TrendBucket {
  /** Human-readable label, e.g. "Apr 2025". */
  label: string;
  /** ISO period start for this bucket (YYYY-MM-DD). */
  period_start: string;
  /** ISO period end for this bucket (YYYY-MM-DD). */
  period_end: string;
  /** 0-1 decimal rate. */
  exception_rate: number;
  /** 0-1 decimal rate. */
  dispute_rate: number;
  /** Total placements in this bucket. */
  total_placements: number;
}

export type TrendsPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'data'; buckets: TrendBucket[] };

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  minHeight: 'calc(100vh - 3.25rem)',
  background: '#f9fafb',
  fontFamily: 'system-ui, sans-serif',
  padding: '2rem 1rem',
};

const innerStyle: React.CSSProperties = {
  maxWidth: '960px',
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '0.75rem',
  padding: '1.5rem',
  marginBottom: '1.5rem',
};

const headingStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  color: '#111827',
  marginTop: 0,
  marginBottom: '1rem',
};

const btnStyle: React.CSSProperties = {
  padding: '0.375rem 0.75rem',
  borderRadius: '0.375rem',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.8125rem',
  fontWeight: 600,
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#2563eb',
  color: '#ffffff',
};

const disabledBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#e5e7eb',
  color: '#9ca3af',
  cursor: 'not-allowed',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 600,
  marginBottom: '0.25rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.5rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
};

// ---------------------------------------------------------------------------
// RangeForm — selects date range and fires onFetch
// ---------------------------------------------------------------------------

export interface RangeFormProps {
  onFetch: (rangeStart: string, rangeEnd: string) => Promise<void>;
  loading: boolean;
  fetchError: string | null;
}

export function RangeForm({ onFetch, loading, fetchError }: RangeFormProps) {
  const defaults = defaultTrendsRange();
  const [rangeStart, setRangeStart] = useState(defaults.start);
  const [rangeEnd, setRangeEnd] = useState(defaults.end);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void onFetch(rangeStart, rangeEnd);
  }

  return (
    <div data-testid="trends-range-form" style={cardStyle}>
      <h2 style={headingStyle}>Select range</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="trends-range-start" style={labelStyle}>
              Start date
            </label>
            <input
              id="trends-range-start"
              data-testid="trends-range-start-input"
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="trends-range-end" style={labelStyle}>
              End date
            </label>
            <input
              id="trends-range-end"
              data-testid="trends-range-end-input"
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
          <button
            type="submit"
            data-testid="trends-fetch-button"
            style={loading ? disabledBtnStyle : primaryBtnStyle}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load trends'}
          </button>
        </div>
        {fetchError && (
          <div
            data-testid="trends-fetch-error"
            role="alert"
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: '0.5rem',
              color: '#b91c1c',
              fontSize: '0.875rem',
            }}
          >
            {fetchError}
          </div>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrendBar — simple inline bar chart row for a rate value (0–1)
// ---------------------------------------------------------------------------

interface TrendBarProps {
  /** 0-1 decimal rate. */
  rate: number;
  /** Hex colour for the bar fill. */
  color: string;
  /** data-testid prefix. */
  testIdPrefix: string;
}

function TrendBar({ rate, color, testIdPrefix }: TrendBarProps) {
  const pct = Math.min(100, Math.max(0, rate * 100));
  return (
    <div
      data-testid={`${testIdPrefix}-bar`}
      style={{
        height: '0.75rem',
        background: '#f3f4f6',
        borderRadius: '9999px',
        overflow: 'hidden',
        flex: 1,
        minWidth: '80px',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${pct.toFixed(1)}%`,
          background: color,
          borderRadius: '9999px',
          transition: 'width 0.25s ease',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrendTable — renders both series in a table layout
// ---------------------------------------------------------------------------

interface TrendTableProps {
  buckets: TrendBucket[];
}

function TrendTable({ buckets }: TrendTableProps) {
  return (
    <div data-testid="trends-table" style={cardStyle}>
      <h2 style={headingStyle}>Exception &amp; dispute rate trends</h2>
      {buckets.length === 0 ? (
        <div data-testid="trends-empty" style={{ fontSize: '0.875rem', color: '#6b7280' }}>
          No data available for the selected range.
        </div>
      ) : (
        <table
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
                  padding: '0.5rem 0.75rem 0.5rem 0',
                  fontWeight: 600,
                  color: '#374151',
                  whiteSpace: 'nowrap',
                }}
              >
                Period
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  whiteSpace: 'nowrap',
                }}
              >
                Exception rate
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  whiteSpace: 'nowrap',
                }}
              >
                Dispute rate
              </th>
              <th
                style={{
                  textAlign: 'right',
                  padding: '0.5rem 0 0.5rem 0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  whiteSpace: 'nowrap',
                }}
              >
                Placements
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr
                key={bucket.period_start}
                data-testid={`trends-row-${bucket.period_start}`}
                style={{ borderBottom: '1px solid #f3f4f6' }}
              >
                <td
                  style={{
                    padding: '0.75rem 0.75rem 0.75rem 0',
                    color: '#111827',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {bucket.label}
                </td>
                <td style={{ padding: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <TrendBar
                      rate={bucket.exception_rate}
                      color="#2563eb"
                      testIdPrefix={`exception-${bucket.period_start}`}
                    />
                    <span
                      data-testid={`exception-rate-${bucket.period_start}`}
                      style={{ minWidth: '3rem', textAlign: 'right', color: '#374151' }}
                    >
                      {(bucket.exception_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td style={{ padding: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <TrendBar
                      rate={bucket.dispute_rate}
                      color="#d97706"
                      testIdPrefix={`dispute-${bucket.period_start}`}
                    />
                    <span
                      data-testid={`dispute-rate-${bucket.period_start}`}
                      style={{ minWidth: '3rem', textAlign: 'right', color: '#374151' }}
                    >
                      {(bucket.dispute_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td
                  style={{
                    padding: '0.75rem 0 0.75rem 0.75rem',
                    textAlign: 'right',
                    color: '#374151',
                  }}
                >
                  {bucket.total_placements}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExecTrendsView — pure presentational component
// ---------------------------------------------------------------------------

export interface ExecTrendsViewProps {
  phase: TrendsPhase;
  onFetch: (rangeStart: string, rangeEnd: string) => Promise<void>;
  loading: boolean;
  fetchError: string | null;
}

export function ExecTrendsView({ phase, onFetch, loading, fetchError }: ExecTrendsViewProps) {
  return (
    <div data-testid="exec-trends" style={containerStyle}>
      <div style={innerStyle}>
        <header style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            Exception &amp; Dispute Rate Trends
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
            View exception and dispute rates over time to evaluate whether commission plan rules are
            working. Select a date range to load monthly trend buckets.
          </p>
        </header>

        <RangeForm onFetch={onFetch} loading={loading} fetchError={fetchError} />

        {phase.kind === 'loading' && (
          <div data-testid="trends-loading-state" style={{ ...cardStyle, color: '#6b7280' }}>
            Loading trends…
          </div>
        )}

        {phase.kind === 'error' && (
          <div
            data-testid="trends-error-state"
            role="alert"
            style={{
              ...cardStyle,
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              color: '#b91c1c',
            }}
          >
            {phase.message}
          </div>
        )}

        {phase.kind === 'data' && <TrendTable buckets={phase.buckets} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers — build monthly buckets from a date range
// ---------------------------------------------------------------------------

/**
 * Build an array of monthly sub-period tuples covering [rangeStart, rangeEnd].
 *
 * Each tuple is [bucketStart, bucketEnd] in YYYY-MM-DD form. The first bucket
 * begins at rangeStart; the last bucket ends at rangeEnd. Up to 24 buckets are
 * produced to avoid excessive fan-out.
 */
export function buildMonthlyBuckets(
  rangeStart: string,
  rangeEnd: string,
): Array<{ start: string; end: string; label: string }> {
  const start = new Date(`${rangeStart}T00:00:00Z`);
  const end = new Date(`${rangeEnd}T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const buckets: Array<{ start: string; end: string; label: string }> = [];
  let cursor = new Date(start);
  const MAX_BUCKETS = 24;

  while (cursor <= end && buckets.length < MAX_BUCKETS) {
    const bucketStart = new Date(cursor);

    // Advance to last day of this month
    const lastOfMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const bucketEnd = lastOfMonth < end ? lastOfMonth : end;

    const label = bucketStart.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

    buckets.push({
      start: bucketStart.toISOString().slice(0, 10),
      end: bucketEnd.toISOString().slice(0, 10),
      label,
    });

    // Move cursor to first day of next month
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// ExecTrends — container wiring real API calls
// ---------------------------------------------------------------------------

/**
 * Executive exception/dispute rate trends container.
 *
 * Fans out one `GET /analytics/executive` call per monthly bucket within
 * the selected range, then assembles the results into an ordered series for
 * ExecTrendsView.
 */
export function ExecTrends() {
  const [phase, setPhase] = useState<TrendsPhase>({ kind: 'idle' });
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function handleFetch(rangeStart: string, rangeEnd: string): Promise<void> {
    setLoading(true);
    setFetchError(null);
    setPhase({ kind: 'loading' });

    const monthBuckets = buildMonthlyBuckets(rangeStart, rangeEnd);

    if (monthBuckets.length === 0) {
      const msg = 'Invalid date range — start must be on or before end.';
      setPhase({ kind: 'error', message: msg });
      setFetchError(msg);
      setLoading(false);
      return;
    }

    try {
      const results = await Promise.all(
        monthBuckets.map((b) =>
          apiGet<ExecutiveAnalytics>(
            `/analytics/executive?period_start=${encodeURIComponent(b.start)}&period_end=${encodeURIComponent(b.end)}`,
          ),
        ),
      );

      const buckets: TrendBucket[] = results.map((analytics, i) => ({
        label: monthBuckets[i].label,
        period_start: monthBuckets[i].start,
        period_end: monthBuckets[i].end,
        exception_rate: typeof analytics.exception_rate === 'number' ? analytics.exception_rate : 0,
        dispute_rate: typeof analytics.dispute_rate === 'number' ? analytics.dispute_rate : 0,
        total_placements:
          typeof analytics.total_placements === 'number' ? analytics.total_placements : 0,
      }));

      setPhase({ kind: 'data', buckets });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load trends';
      setPhase({ kind: 'error', message });
      setFetchError(message);
    } finally {
      setLoading(false);
    }
  }

  // Data-first (#203): load the default range immediately on mount; the date
  // form acts as a filter rather than a gate.
  useEffect(() => {
    const { start, end } = defaultTrendsRange();
    void handleFetch(start, end);
  }, []);

  return (
    <ExecTrendsView phase={phase} onFetch={handleFetch} loading={loading} fetchError={fetchError} />
  );
}

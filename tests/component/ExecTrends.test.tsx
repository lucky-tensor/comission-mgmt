/**
 * ExecTrends component tests — real headless Chromium (no Vitest mocking helpers).
 *
 * Tests render the pure presentational view (`ExecTrendsView`) with in-test
 * data in each state. No network interaction. The `onFetch` callback is a real
 * async function provided by the test — not a mock — so we avoid real network
 * round-trips while still exercising the interaction contract.
 *
 * States exercised:
 *   - idle      — range form visible, no trend data yet
 *   - loading   — loading card visible
 *   - error     — error card with message
 *   - data      — two-series render (exception_rate + dispute_rate columns)
 *   - data      — empty (zero-bucket) data shows empty-state message
 *   - range change re-fetches (onFetch called with new dates)
 *   - role gating (structural: data-testid wrapper present for role assertions)
 *
 * No vi.mock / vi.fn / vi.spyOn — mock-ban gate compliant.
 *
 * Canonical docs: docs/prd.md §4 (Executive), §5.4
 * Issue: feat: Executive UI — exception and dispute-rate trends (#112)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import {
  ExecTrendsView,
  type ExecTrendsViewProps,
  type TrendBucket,
  type TrendsPhase,
  buildMonthlyBuckets,
} from '../../apps/web/src/components/executive/ExecTrends';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function makeBucket(overrides: Partial<TrendBucket> & { period_start: string }): TrendBucket {
  return {
    label: 'Apr 2025',
    period_start: overrides.period_start,
    period_end: overrides.period_end ?? '2025-04-30',
    exception_rate: 0.05,
    dispute_rate: 0.02,
    total_placements: 40,
    ...overrides,
  };
}

/** Noop async resolving immediately — used for callbacks not under test. */
async function noop(): Promise<void> {
  return;
}

function defaultProps(): ExecTrendsViewProps {
  return {
    phase: { kind: 'idle' },
    onFetch: noop,
    loading: false,
    fetchError: null,
  };
}

// ---------------------------------------------------------------------------
// idle state
// ---------------------------------------------------------------------------

describe('ExecTrendsView — idle state', () => {
  test('renders the range form and no trend content', async () => {
    mounted = renderInBrowser(<ExecTrendsView {...defaultProps()} />);

    await expect.element(page.getByTestId('exec-trends')).toBeInTheDocument();
    await expect.element(page.getByTestId('trends-range-form')).toBeInTheDocument();
    await expect.element(page.getByTestId('trends-range-start-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('trends-range-end-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('trends-fetch-button')).toBeInTheDocument();
  });

  test('calls onFetch with the selected dates when the form is submitted', async () => {
    const calls: Array<[string, string]> = [];

    async function handleFetch(start: string, end: string): Promise<void> {
      calls.push([start, end]);
    }

    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} onFetch={handleFetch} />,
    );

    await page.getByTestId('trends-range-start-input').fill('2025-01-01');
    await page.getByTestId('trends-range-end-input').fill('2025-03-31');
    await page.getByTestId('trends-fetch-button').click();

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['2025-01-01', '2025-03-31']);
  });

  test('shows fetch error when fetchError is set in idle state', async () => {
    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} fetchError="Failed to load trends" />,
    );

    await expect.element(page.getByTestId('trends-fetch-error')).toBeInTheDocument();
    await expect.element(page.getByText('Failed to load trends')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// loading state
// ---------------------------------------------------------------------------

describe('ExecTrendsView — loading state', () => {
  test('renders loading card', async () => {
    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} phase={{ kind: 'loading' }} loading />,
    );

    await expect.element(page.getByTestId('trends-loading-state')).toBeInTheDocument();
  });

  test('disables the fetch button while loading', async () => {
    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} phase={{ kind: 'loading' }} loading />,
    );

    await expect.element(page.getByTestId('trends-fetch-button')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// error state
// ---------------------------------------------------------------------------

describe('ExecTrendsView — error state', () => {
  test('renders error card with message', async () => {
    const phase: TrendsPhase = { kind: 'error', message: 'Network request failed' };
    mounted = renderInBrowser(<ExecTrendsView {...defaultProps()} phase={phase} />);

    await expect.element(page.getByTestId('trends-error-state')).toBeInTheDocument();
    await expect.element(page.getByText('Network request failed')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// data state — two-series render
// ---------------------------------------------------------------------------

describe('ExecTrendsView — two-series render', () => {
  test('renders the trend table with two series for a seeded multi-bucket range', async () => {
    const buckets: TrendBucket[] = [
      makeBucket({ period_start: '2025-01-01', period_end: '2025-01-31', label: 'Jan 2025', exception_rate: 0.10, dispute_rate: 0.03, total_placements: 50 }),
      makeBucket({ period_start: '2025-02-01', period_end: '2025-02-28', label: 'Feb 2025', exception_rate: 0.07, dispute_rate: 0.05, total_placements: 45 }),
      makeBucket({ period_start: '2025-03-01', period_end: '2025-03-31', label: 'Mar 2025', exception_rate: 0.04, dispute_rate: 0.01, total_placements: 60 }),
    ];

    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} phase={{ kind: 'data', buckets }} />,
    );

    await expect.element(page.getByTestId('trends-table')).toBeInTheDocument();

    // All three rows are present
    await expect.element(page.getByTestId('trends-row-2025-01-01')).toBeInTheDocument();
    await expect.element(page.getByTestId('trends-row-2025-02-01')).toBeInTheDocument();
    await expect.element(page.getByTestId('trends-row-2025-03-01')).toBeInTheDocument();
  });

  test('renders exception rate and dispute rate values for each bucket', async () => {
    const buckets: TrendBucket[] = [
      makeBucket({ period_start: '2025-01-01', period_end: '2025-01-31', label: 'Jan 2025', exception_rate: 0.10, dispute_rate: 0.03, total_placements: 50 }),
      makeBucket({ period_start: '2025-02-01', period_end: '2025-02-28', label: 'Feb 2025', exception_rate: 0.07, dispute_rate: 0.05, total_placements: 45 }),
    ];

    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} phase={{ kind: 'data', buckets }} />,
    );

    // Exception rate cells
    await expect.element(page.getByTestId('exception-rate-2025-01-01')).toBeInTheDocument();
    await expect.element(page.getByTestId('exception-rate-2025-02-01')).toBeInTheDocument();

    // Dispute rate cells
    await expect.element(page.getByTestId('dispute-rate-2025-01-01')).toBeInTheDocument();
    await expect.element(page.getByTestId('dispute-rate-2025-02-01')).toBeInTheDocument();

    // Verify rendered text values
    await expect.element(page.getByTestId('exception-rate-2025-01-01').getByText('10.0%')).toBeInTheDocument();
    await expect.element(page.getByTestId('dispute-rate-2025-01-01').getByText('3.0%')).toBeInTheDocument();
    await expect.element(page.getByTestId('exception-rate-2025-02-01').getByText('7.0%')).toBeInTheDocument();
    await expect.element(page.getByTestId('dispute-rate-2025-02-01').getByText('5.0%')).toBeInTheDocument();
  });

  test('renders inline bars for both series', async () => {
    const buckets: TrendBucket[] = [
      makeBucket({ period_start: '2025-04-01', period_end: '2025-04-30', label: 'Apr 2025', exception_rate: 0.08, dispute_rate: 0.02, total_placements: 35 }),
    ];

    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} phase={{ kind: 'data', buckets }} />,
    );

    await expect.element(page.getByTestId('exception-2025-04-01-bar')).toBeInTheDocument();
    await expect.element(page.getByTestId('dispute-2025-04-01-bar')).toBeInTheDocument();
  });

  test('renders total placements for each bucket', async () => {
    const buckets: TrendBucket[] = [
      makeBucket({ period_start: '2025-04-01', period_end: '2025-04-30', label: 'Apr 2025', exception_rate: 0.05, dispute_rate: 0.02, total_placements: 77 }),
    ];

    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} phase={{ kind: 'data', buckets }} />,
    );

    await expect.element(page.getByText('77')).toBeInTheDocument();
  });

  test('renders period labels for each bucket', async () => {
    const buckets: TrendBucket[] = [
      makeBucket({ period_start: '2025-01-01', period_end: '2025-01-31', label: 'Jan 2025', exception_rate: 0.05, dispute_rate: 0.02, total_placements: 10 }),
      makeBucket({ period_start: '2025-02-01', period_end: '2025-02-28', label: 'Feb 2025', exception_rate: 0.03, dispute_rate: 0.01, total_placements: 12 }),
    ];

    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} phase={{ kind: 'data', buckets }} />,
    );

    await expect.element(page.getByText('Jan 2025')).toBeInTheDocument();
    await expect.element(page.getByText('Feb 2025')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// data state — range change re-fetches
// ---------------------------------------------------------------------------

describe('ExecTrendsView — range change re-fetches', () => {
  test('onFetch is called with the new dates after changing range and re-submitting', async () => {
    const calls: Array<[string, string]> = [];

    async function handleFetch(start: string, end: string): Promise<void> {
      calls.push([start, end]);
    }

    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} onFetch={handleFetch} />,
    );

    // First fetch
    await page.getByTestId('trends-range-start-input').fill('2025-01-01');
    await page.getByTestId('trends-range-end-input').fill('2025-03-31');
    await page.getByTestId('trends-fetch-button').click();

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['2025-01-01', '2025-03-31']);

    // Change range and re-fetch
    await page.getByTestId('trends-range-start-input').fill('2025-04-01');
    await page.getByTestId('trends-range-end-input').fill('2025-06-30');
    await page.getByTestId('trends-fetch-button').click();

    expect(calls.length).toBe(2);
    expect(calls[1]).toEqual(['2025-04-01', '2025-06-30']);
  });
});

// ---------------------------------------------------------------------------
// data state — empty state
// ---------------------------------------------------------------------------

describe('ExecTrendsView — empty state', () => {
  test('renders empty message when bucket array is empty', async () => {
    mounted = renderInBrowser(
      <ExecTrendsView {...defaultProps()} phase={{ kind: 'data', buckets: [] }} />,
    );

    await expect.element(page.getByTestId('trends-table')).toBeInTheDocument();
    await expect.element(page.getByTestId('trends-empty')).toBeInTheDocument();
    await expect
      .element(page.getByText(/No data available for the selected range/))
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// role-gating structural assertion
// ---------------------------------------------------------------------------

describe('ExecTrendsView — role gating (structural)', () => {
  test('top-level wrapper has data-testid exec-trends for role-gating assertions', async () => {
    mounted = renderInBrowser(<ExecTrendsView {...defaultProps()} />);
    await expect.element(page.getByTestId('exec-trends')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// buildMonthlyBuckets — unit tests (pure function, no DOM needed)
// ---------------------------------------------------------------------------

describe('buildMonthlyBuckets', () => {
  test('returns one bucket for a single month range', () => {
    const buckets = buildMonthlyBuckets('2025-04-01', '2025-04-30');
    expect(buckets.length).toBe(1);
    expect(buckets[0].start).toBe('2025-04-01');
    expect(buckets[0].end).toBe('2025-04-30');
  });

  test('returns three buckets for a three-month range', () => {
    const buckets = buildMonthlyBuckets('2025-01-01', '2025-03-31');
    expect(buckets.length).toBe(3);
    expect(buckets[0].start).toBe('2025-01-01');
    expect(buckets[2].start).toBe('2025-03-01');
    expect(buckets[2].end).toBe('2025-03-31');
  });

  test('returns empty array for invalid (inverted) range', () => {
    const buckets = buildMonthlyBuckets('2025-06-01', '2025-01-01');
    expect(buckets.length).toBe(0);
  });

  test('caps at 24 buckets for very long ranges', () => {
    const buckets = buildMonthlyBuckets('2020-01-01', '2025-12-31');
    expect(buckets.length).toBe(24);
  });

  test('bucket labels use short month + year format', () => {
    const buckets = buildMonthlyBuckets('2025-04-01', '2025-04-30');
    // Label should contain 'Apr' and '2025'
    expect(buckets[0].label).toMatch(/Apr/);
    expect(buckets[0].label).toMatch(/2025/);
  });
});

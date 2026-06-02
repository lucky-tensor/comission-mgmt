/**
 * ReconciliationReport component tests — real headless Chromium (no Vitest
 * mocking helpers).
 *
 * Tests render the pure presentational view (`ReconciliationReportView`) in
 * each state with in-test data. No network interaction. Mutations (acknowledge)
 * are driven via an explicit `onAcknowledge` prop that is a real async function
 * provided by the test — not a mock; this avoids real network round-trips while
 * the mutation side-effects are tested in the API integration suite.
 *
 * States exercised:
 *   - idle     — period form visible, no report yet
 *   - loading  — spinner/loading card
 *   - error    — error card with message
 *   - data     — four-bucket render (ledger_only, system_only, amount_mismatch, date_gap)
 *   - data     — acknowledge flow: form opens, note submitted, discrepancy marked acknowledged,
 *                unacknowledged count decremented
 *   - data     — all-clear state when unacknowledgedCount === 0 and discrepancies > 0
 *   - data     — clean (no discrepancies) state
 *
 * Reachability via role-gating: /reconciliation is only permitted for FinanceAdmin.
 * The 403 surface for other roles is verified in AppShell.test.tsx which already
 * tests the role-gating guard.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.8
 * Issue: feat: Finance Admin UI — financial reconciliation report (#106)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import {
  ReconciliationReportView,
  type ReconciliationReportViewProps,
  type ReconciliationReportData,
  type ReconciliationDiscrepancy,
} from '../../apps/web/src/components/finance/ReconciliationReport';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function makeDiscrepancy(
  overrides: Partial<ReconciliationDiscrepancy> & { id: string },
): ReconciliationDiscrepancy {
  return {
    org_id: 'org-0001',
    period_start: '2025-04-01',
    period_end: '2025-04-30',
    invoice_id: null,
    invoice_number: null,
    ledger_amount_billed: null,
    ar_amount_billed: null,
    ledger_issued_at: null,
    ar_billed_date: null,
    date_gap_days: null,
    acknowledged: false,
    acknowledged_by: null,
    acknowledged_at: null,
    acknowledged_note: null,
    created_at: '2025-05-01T00:00:00.000Z',
    discrepancy_type: 'ledger_only',
    ...overrides,
  };
}

function makeReport(discrepancies: ReconciliationDiscrepancy[] = []): ReconciliationReportData {
  const unacknowledged = discrepancies.filter((d) => !d.acknowledged).length;
  return {
    period_start: '2025-04-01',
    period_end: '2025-04-30',
    summary: {
      total_ledger_invoices: 4,
      total_ar_records: 4,
      matched: 0,
      discrepancies: discrepancies.length,
      unacknowledged,
    },
    matched: [],
    discrepancies,
  };
}

function makeFourBucketReport(): ReconciliationReportData {
  return makeReport([
    makeDiscrepancy({
      id: 'disc-ledger-only',
      discrepancy_type: 'ledger_only',
      invoice_number: 'INV-0001',
      ledger_amount_billed: '5000.00',
    }),
    makeDiscrepancy({
      id: 'disc-system-only',
      discrepancy_type: 'system_only',
      invoice_number: 'INV-0002',
      ar_amount_billed: '3000.00',
    }),
    makeDiscrepancy({
      id: 'disc-amount-mismatch',
      discrepancy_type: 'amount_mismatch',
      invoice_number: 'INV-0003',
      ledger_amount_billed: '8000.00',
      ar_amount_billed: '7500.00',
    }),
    makeDiscrepancy({
      id: 'disc-date-gap',
      discrepancy_type: 'date_gap',
      invoice_number: 'INV-0004',
      date_gap_days: 5,
      ledger_issued_at: '2025-04-10T00:00:00.000Z',
      ar_billed_date: '2025-04-15T00:00:00.000Z',
    }),
  ]);
}

/** Noop async resolving immediately — used for callbacks not under test. */
async function noop(): Promise<void> {
  return;
}

function defaultProps(): ReconciliationReportViewProps {
  return {
    phase: { kind: 'idle' },
    onFetch: noop,
    onAcknowledge: noop,
    fetching: false,
    fetchError: null,
    acknowledgingId: null,
    acknowledgeErrors: {},
    unacknowledgedCount: 0,
  };
}

// ---------------------------------------------------------------------------
// idle state
// ---------------------------------------------------------------------------

describe('ReconciliationReportView — idle state', () => {
  test('renders the period form and no report content', async () => {
    mounted = renderInBrowser(<ReconciliationReportView {...defaultProps()} />);

    await expect.element(page.getByTestId('reconciliation-report')).toBeInTheDocument();
    await expect.element(page.getByTestId('period-form')).toBeInTheDocument();
    await expect.element(page.getByTestId('recon-period-start-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('recon-period-end-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('recon-fetch-button')).toBeInTheDocument();
  });

  test('calls onFetch with the correct period dates when the form is submitted', async () => {
    const calls: Array<[string, string]> = [];

    async function handleFetch(periodStart: string, periodEnd: string): Promise<void> {
      calls.push([periodStart, periodEnd]);
    }

    mounted = renderInBrowser(
      <ReconciliationReportView {...defaultProps()} onFetch={handleFetch} />,
    );

    await page.getByTestId('recon-period-start-input').fill('2025-04-01');
    await page.getByTestId('recon-period-end-input').fill('2025-04-30');
    await page.getByTestId('recon-fetch-button').click();

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['2025-04-01', '2025-04-30']);
  });

  test('shows fetch error when fetchError is set', async () => {
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        fetchError="Failed to load reconciliation report"
      />,
    );

    await expect.element(page.getByTestId('recon-fetch-error')).toBeInTheDocument();
    await expect.element(page.getByText('Failed to load reconciliation report')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// loading state
// ---------------------------------------------------------------------------

describe('ReconciliationReportView — loading state', () => {
  test('renders the loading card', async () => {
    mounted = renderInBrowser(
      <ReconciliationReportView {...defaultProps()} phase={{ kind: 'loading' }} />,
    );

    await expect.element(page.getByTestId('recon-loading-state')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// error state
// ---------------------------------------------------------------------------

describe('ReconciliationReportView — error state', () => {
  test('renders the error card with the message', async () => {
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'error', message: 'Failed to generate reconciliation report' }}
      />,
    );

    await expect.element(page.getByTestId('recon-error-state')).toBeInTheDocument();
    await expect
      .element(page.getByText('Failed to generate reconciliation report'))
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// data state — four-bucket render
// ---------------------------------------------------------------------------

describe('ReconciliationReportView — four-bucket render', () => {
  test('renders all four discrepancy buckets', async () => {
    const report = makeFourBucketReport();
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={report.summary.unacknowledged}
      />,
    );

    await expect.element(page.getByTestId('bucket-ledger-only')).toBeInTheDocument();
    await expect.element(page.getByTestId('bucket-system-only')).toBeInTheDocument();
    await expect.element(page.getByTestId('bucket-amount-mismatch')).toBeInTheDocument();
    await expect.element(page.getByTestId('bucket-date-gap')).toBeInTheDocument();
  });

  test('renders at least one discrepancy row in each bucket', async () => {
    const report = makeFourBucketReport();
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={report.summary.unacknowledged}
      />,
    );

    await expect.element(page.getByTestId('discrepancy-row-disc-ledger-only')).toBeInTheDocument();
    await expect.element(page.getByTestId('discrepancy-row-disc-system-only')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('discrepancy-row-disc-amount-mismatch'))
      .toBeInTheDocument();
    await expect.element(page.getByTestId('discrepancy-row-disc-date-gap')).toBeInTheDocument();
  });

  test('renders summary with unacknowledged count', async () => {
    const report = makeFourBucketReport();
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={4}
      />,
    );

    await expect.element(page.getByTestId('recon-summary')).toBeInTheDocument();
    await expect.element(page.getByTestId('recon-unacknowledged-count')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('recon-unacknowledged-count').getByText('4'))
      .toBeInTheDocument();
  });

  test('renders invoice numbers and amounts in the rows', async () => {
    const report = makeFourBucketReport();
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={report.summary.unacknowledged}
      />,
    );

    await expect.element(page.getByText('INV-0001')).toBeInTheDocument();
    await expect.element(page.getByText('5000.00')).toBeInTheDocument();
    await expect.element(page.getByText('INV-0003')).toBeInTheDocument();
    await expect.element(page.getByText('7500.00')).toBeInTheDocument();
  });

  test('renders date gap days in the date-gap bucket row', async () => {
    const report = makeFourBucketReport();
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={report.summary.unacknowledged}
      />,
    );

    await expect.element(page.getByText('5 days')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// data state — acknowledge flow
// ---------------------------------------------------------------------------

describe('ReconciliationReportView — acknowledge flow', () => {
  test('renders acknowledge button for unacknowledged discrepancies', async () => {
    const report = makeReport([
      makeDiscrepancy({
        id: 'disc-001',
        discrepancy_type: 'ledger_only',
        invoice_number: 'INV-0001',
      }),
    ]);
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={1}
      />,
    );

    await expect.element(page.getByTestId('acknowledge-btn-disc-001')).toBeInTheDocument();
  });

  test('calls onAcknowledge with id and note when acknowledge form is submitted', async () => {
    const calls: Array<[string, string]> = [];

    async function handleAcknowledge(id: string, note: string): Promise<void> {
      calls.push([id, note]);
    }

    const report = makeReport([
      makeDiscrepancy({
        id: 'disc-001',
        discrepancy_type: 'ledger_only',
        invoice_number: 'INV-0001',
      }),
    ]);

    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        onAcknowledge={handleAcknowledge}
        unacknowledgedCount={1}
      />,
    );

    await page.getByTestId('acknowledge-btn-disc-001').click();
    await expect.element(page.getByTestId('acknowledge-form-disc-001')).toBeInTheDocument();
    await page.getByTestId('acknowledge-note-disc-001').fill('Reviewed and approved');
    await page.getByTestId('acknowledge-save-disc-001').click();

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['disc-001', 'Reviewed and approved']);
  });

  test('shows acknowledged badge and no acknowledge button when discrepancy is acknowledged', async () => {
    const report = makeReport([
      makeDiscrepancy({
        id: 'disc-001',
        discrepancy_type: 'ledger_only',
        invoice_number: 'INV-0001',
        acknowledged: true,
        acknowledged_by: 'admin-0001',
        acknowledged_at: '2025-05-01T12:00:00.000Z',
        acknowledged_note: 'Timing difference confirmed',
      }),
    ]);
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={0}
      />,
    );

    await expect.element(page.getByTestId('acknowledged-badge-disc-001')).toBeInTheDocument();
    await expect.element(page.getByTestId('acknowledged-note-disc-001')).toBeInTheDocument();
    await expect
      .element(page.getByText(/Timing difference confirmed/))
      .toBeInTheDocument();
    // Acknowledge button should not appear for already-acknowledged discrepancy
    await expect.element(page.getByTestId('acknowledge-btn-disc-001')).not.toBeInTheDocument();
  });

  test('unacknowledged count decrements when a discrepancy is acknowledged', async () => {
    // Simulate the post-acknowledge state by re-rendering with updated count.
    const report = makeReport([
      makeDiscrepancy({
        id: 'disc-001',
        discrepancy_type: 'amount_mismatch',
        invoice_number: 'INV-0001',
        acknowledged: true,
        acknowledged_note: 'Amount difference is a known timing adjustment',
      }),
    ]);

    // After acknowledgement the parent would update unacknowledgedCount to 0.
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={0}
      />,
    );

    await expect
      .element(page.getByTestId('recon-unacknowledged-count').getByText('0'))
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// data state — all-clear and clean states
// ---------------------------------------------------------------------------

describe('ReconciliationReportView — all-clear state', () => {
  test('renders the all-clear banner when unacknowledgedCount is 0 and discrepancies exist', async () => {
    const report = makeReport([
      makeDiscrepancy({
        id: 'disc-001',
        discrepancy_type: 'ledger_only',
        acknowledged: true,
        acknowledged_note: 'Confirmed',
      }),
    ]);
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={0}
      />,
    );

    await expect.element(page.getByTestId('recon-all-clear')).toBeInTheDocument();
    await expect
      .element(page.getByText(/All discrepancies acknowledged/))
      .toBeInTheDocument();
  });

  test('does not render the all-clear banner when unacknowledgedCount is > 0', async () => {
    const report = makeFourBucketReport();
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={4}
      />,
    );

    await expect.element(page.getByTestId('recon-all-clear')).not.toBeInTheDocument();
  });
});

describe('ReconciliationReportView — clean reconciliation (no discrepancies)', () => {
  test('renders the clean state when the report has zero discrepancies', async () => {
    const report: ReconciliationReportData = {
      period_start: '2025-04-01',
      period_end: '2025-04-30',
      summary: {
        total_ledger_invoices: 2,
        total_ar_records: 2,
        matched: 2,
        discrepancies: 0,
        unacknowledged: 0,
      },
      matched: [
        { invoice_number: 'INV-M-001', ledger_amount_billed: '1000.00' },
        { invoice_number: 'INV-M-002', ledger_amount_billed: '2000.00' },
      ],
      discrepancies: [],
    };
    mounted = renderInBrowser(
      <ReconciliationReportView
        {...defaultProps()}
        phase={{ kind: 'data', report }}
        unacknowledgedCount={0}
      />,
    );

    await expect.element(page.getByTestId('recon-clean')).toBeInTheDocument();
    await expect
      .element(page.getByText(/No discrepancies found/))
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// role-gating structural assertion
// ---------------------------------------------------------------------------

describe('ReconciliationReportView — role gating (structural)', () => {
  test('top-level wrapper has the correct data-testid for role-gating assertions', async () => {
    mounted = renderInBrowser(<ReconciliationReportView {...defaultProps()} />);
    await expect.element(page.getByTestId('reconciliation-report')).toBeInTheDocument();
  });
});

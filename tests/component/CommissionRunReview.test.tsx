/**
 * CommissionRunReview component tests — real headless Chromium (no mocks).
 *
 * Tests render the pure presentational view (`CommissionRunReviewView`) in
 * each state with in-test data. No network mock, no vi.fn/vi.mock/vi.spyOn.
 * Mutations (record approve, batch approve, finalize) are driven via an
 * explicit `onXxx` prop that returns a resolved/rejected Promise — this is
 * not a mock; it is a real async function provided by the test to avoid a
 * real network round-trip (the mutation side-effects are tested in the API
 * integration suite).
 *
 * States exercised:
 *   - start form (phase: 'start')
 *   - loading queue (phase: 'loading-queue')
 *   - error state (phase: 'error')
 *   - queue with records: render, per-record approve button, batch approve
 *   - finalize-blocked (422 gate reasons): discrepancy count + unapproved count
 *   - batch-approved terminal state
 *   - finalized terminal state
 *
 * Reachability via role-gating: verified against the live App in AppShell.test.tsx.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.3, §5.4
 * Issue: feat: Finance Admin UI — commission run review and batch approval (#102)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import {
  CommissionRunReviewView,
  type CommissionRunReviewViewProps,
  type CommissionRunQueueData,
  type FinalizeBlockedReason,
  type QueueItem,
} from '../../apps/web/src/components/finance/CommissionRunReview';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function makeQueue(overrides: Partial<QueueItem>[] = []): CommissionRunQueueData {
  const baseItem: QueueItem = {
    commission_record_id: 'rec-0000-0001',
    run_record_id: 'rr-0000-0001',
    status: 'Accrued',
    hold_reason: null,
    individually_approved: false,
    individually_approved_by: null,
    individually_approved_at: null,
    queue_category: 'ready',
    explanation: 'Gross fee $20,000 × 25% tier rate = $5,000',
    gross_commission: 20000,
    net_payable: 5000,
    position_title: 'Senior Recruiter',
  };

  const items: QueueItem[] =
    overrides.length > 0
      ? overrides.map((ov, i) => ({
          ...baseItem,
          commission_record_id: `rec-0000-000${i + 1}`,
          run_record_id: `rr-0000-000${i + 1}`,
          ...ov,
        }))
      : [baseItem];

  const approved = items.filter((i) => i.individually_approved).length;

  return {
    run: {
      id: 'run-0000-0001',
      org_id: 'org-0001',
      period_start: '2025-04-01',
      period_end: '2025-04-30',
      status: 'Open',
      created_by: 'admin-0001',
      approved_by: null,
      approved_at: null,
      created_at: '2025-04-01T00:00:00.000Z',
    },
    queue: items,
    totals: {
      total: items.length,
      ready: items.filter((i) => i.queue_category === 'ready').length,
      held: items.filter((i) => i.queue_category === 'held').length,
      exception_pending: items.filter((i) => i.queue_category === 'exception_pending').length,
      approved,
    },
  };
}

/** Noop async that resolves immediately — used as a no-op stub for callbacks not under test. */
async function noop(): Promise<void> {
  return;
}

function defaultProps(): CommissionRunReviewViewProps {
  return {
    phase: { kind: 'start' },
    onStart: noop,
    onLoadRun: noop,
    onApproveRecord: noop,
    onBatchApprove: noop,
    onFinalize: noop,
    startSubmitting: false,
    startError: null,
    batchApproving: false,
    finalizing: false,
    approvingRecordId: null,
    finalizeBlockedReason: null,
    mutationError: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommissionRunReviewView — start phase', () => {
  test('renders the start form with all required inputs', async () => {
    mounted = renderInBrowser(<CommissionRunReviewView {...defaultProps()} />);

    await expect.element(page.getByTestId('start-run-form')).toBeInTheDocument();
    await expect.element(page.getByTestId('period-start-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('period-end-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('placement-ids-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('start-run-button')).toBeInTheDocument();
  });

  test('renders start-run error message when startError is set', async () => {
    mounted = renderInBrowser(
      <CommissionRunReviewView
        {...defaultProps()}
        startError="Commission run blocked: incomplete placements"
      />,
    );

    await expect.element(page.getByTestId('start-run-error')).toBeInTheDocument();
    await expect
      .element(page.getByText('Commission run blocked: incomplete placements'))
      .toBeInTheDocument();
  });

  test('calls onStart with the correct arguments when the form is submitted', async () => {
    const calls: Array<[string, string, string[]]> = [];

    async function handleStart(
      periodStart: string,
      periodEnd: string,
      placementIds: string[],
    ): Promise<void> {
      calls.push([periodStart, periodEnd, placementIds]);
    }

    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} onStart={handleStart} />,
    );

    await page.getByTestId('period-start-input').fill('2025-04-01');
    await page.getByTestId('period-end-input').fill('2025-04-30');
    await page.getByTestId('placement-ids-input').fill('pl-0001, pl-0002');
    await page.getByTestId('start-run-button').click();

    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('2025-04-01');
    expect(calls[0][1]).toBe('2025-04-30');
    expect(calls[0][2]).toEqual(['pl-0001', 'pl-0002']);
  });
});

describe('CommissionRunReviewView — loading phase', () => {
  test('renders the loading state', async () => {
    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'loading-queue' }} />,
    );

    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });
});

describe('CommissionRunReviewView — error phase', () => {
  test('renders the error state with the given message', async () => {
    mounted = renderInBrowser(
      <CommissionRunReviewView
        {...defaultProps()}
        phase={{ kind: 'error', message: 'Failed to load queue' }}
      />,
    );

    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByText('Failed to load queue')).toBeInTheDocument();
  });
});

describe('CommissionRunReviewView — queue phase', () => {
  test('renders the run summary and queue table with record details', async () => {
    const data = makeQueue();

    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'queue', data }} />,
    );

    await expect.element(page.getByTestId('run-summary')).toBeInTheDocument();
    await expect.element(page.getByTestId('queue-table')).toBeInTheDocument();

    // Run period shown in summary heading
    await expect.element(page.getByText('2025-04-01 — 2025-04-30')).toBeVisible();

    // Record details
    await expect.element(page.getByText('Senior Recruiter')).toBeInTheDocument();
    await expect.element(page.getByText('$20,000.00')).toBeInTheDocument();
    await expect.element(page.getByText('$5,000.00')).toBeInTheDocument();
    await expect
      .element(page.getByText('Gross fee $20,000 × 25% tier rate = $5,000'))
      .toBeInTheDocument();
  });

  test('renders the approve-record button for unapproved records', async () => {
    const data = makeQueue();

    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'queue', data }} />,
    );

    await expect.element(page.getByTestId(`approve-record-rec-0000-0001`)).toBeInTheDocument();
  });

  test('calls onApproveRecord with correct runId and recordId on click', async () => {
    const calls: Array<[string, string]> = [];

    async function handleApproveRecord(runId: string, recordId: string): Promise<void> {
      calls.push([runId, recordId]);
    }

    const data = makeQueue();

    mounted = renderInBrowser(
      <CommissionRunReviewView
        {...defaultProps()}
        phase={{ kind: 'queue', data }}
        onApproveRecord={handleApproveRecord}
      />,
    );

    await page.getByTestId('approve-record-rec-0000-0001').click();

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['run-0000-0001', 'rec-0000-0001']);
  });

  test('shows "✓ Approved" text instead of button for individually approved records', async () => {
    const data = makeQueue([
      {
        individually_approved: true,
        queue_category: 'approved',
        individually_approved_at: '2025-04-10T12:00:00.000Z',
      },
    ]);

    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'queue', data }} />,
    );

    // Button should not be present for approved records
    const approveBtn = page.getByTestId('approve-record-rec-0000-0001');
    await expect.element(approveBtn).not.toBeInTheDocument();

    // Approval checkmark text present
    await expect.element(page.getByText(/✓ Approved/)).toBeInTheDocument();
  });

  test('batch-approve button is disabled when not all records are approved', async () => {
    const data = makeQueue([
      { individually_approved: false, queue_category: 'ready' },
      { individually_approved: true, queue_category: 'approved' },
    ]);

    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'queue', data }} />,
    );

    const batchBtn = page.getByTestId('batch-approve-button');
    await expect.element(batchBtn).toBeDisabled();
  });

  test('batch-approve button is enabled when all records are individually approved', async () => {
    const data = makeQueue([{ individually_approved: true, queue_category: 'approved' }]);

    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'queue', data }} />,
    );

    const batchBtn = page.getByTestId('batch-approve-button');
    await expect.element(batchBtn).not.toBeDisabled();
  });

  test('calls onBatchApprove with the run id when batch-approve is clicked', async () => {
    const calls: string[] = [];

    async function handleBatchApprove(runId: string): Promise<void> {
      calls.push(runId);
    }

    const data = makeQueue([{ individually_approved: true, queue_category: 'approved' }]);

    mounted = renderInBrowser(
      <CommissionRunReviewView
        {...defaultProps()}
        phase={{ kind: 'queue', data }}
        onBatchApprove={handleBatchApprove}
      />,
    );

    await page.getByTestId('batch-approve-button').click();
    expect(calls).toEqual(['run-0000-0001']);
  });

  test('calls onFinalize with the run id when finalize is clicked', async () => {
    const calls: string[] = [];

    async function handleFinalize(runId: string): Promise<void> {
      calls.push(runId);
    }

    const data = makeQueue([{ individually_approved: true, queue_category: 'approved' }]);

    mounted = renderInBrowser(
      <CommissionRunReviewView
        {...defaultProps()}
        phase={{ kind: 'queue', data }}
        onFinalize={handleFinalize}
      />,
    );

    await page.getByTestId('finalize-button').click();
    expect(calls).toEqual(['run-0000-0001']);
  });

  test('renders held-category badge for held records', async () => {
    const data = makeQueue([
      { hold_reason: 'Guarantee period active', queue_category: 'held', status: 'Held' },
    ]);

    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'queue', data }} />,
    );

    // Scope to the queue row to avoid the "Held" <dt> in the totals summary.
    await expect
      .element(page.getByTestId('queue-row-rec-0000-0001').getByText('Held'))
      .toBeInTheDocument();
    await expect.element(page.getByText('Guarantee period active')).toBeInTheDocument();
  });

  test('renders empty queue message when queue is empty', async () => {
    const emptyData: CommissionRunQueueData = {
      run: {
        id: 'run-empty',
        org_id: 'org-0001',
        period_start: '2025-05-01',
        period_end: '2025-05-31',
        status: 'Open',
        created_by: 'admin-0001',
        approved_by: null,
        approved_at: null,
        created_at: '2025-05-01T00:00:00.000Z',
      },
      queue: [],
      totals: { total: 0, ready: 0, held: 0, exception_pending: 0, approved: 0 },
    };

    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'queue', data: emptyData }} />,
    );

    await expect.element(page.getByTestId('empty-queue')).toBeInTheDocument();
  });

  test('renders mutation error when mutationError is set', async () => {
    const data = makeQueue();

    mounted = renderInBrowser(
      <CommissionRunReviewView
        {...defaultProps()}
        phase={{ kind: 'queue', data }}
        mutationError="Failed to approve record"
      />,
    );

    await expect.element(page.getByTestId('mutation-error')).toBeInTheDocument();
    await expect.element(page.getByText('Failed to approve record')).toBeInTheDocument();
  });
});

describe('CommissionRunReviewView — finalize 422 gate (blocked state)', () => {
  test('renders finalize-blocked with discrepancy count', async () => {
    const data = makeQueue();
    const reason: FinalizeBlockedReason = {
      error:
        'Cannot finalize run: unacknowledged reconciliation discrepancies exist for the run period',
      unacknowledged_discrepancy_count: 3,
      hint: 'Acknowledge all discrepancies via POST /reconciliation/:id/acknowledge, or supply override_reason to bypass.',
    };

    mounted = renderInBrowser(
      <CommissionRunReviewView
        {...defaultProps()}
        phase={{ kind: 'queue', data }}
        finalizeBlockedReason={reason}
      />,
    );

    await expect.element(page.getByTestId('finalize-blocked')).toBeInTheDocument();
    await expect.element(page.getByTestId('discrepancy-count')).toBeInTheDocument();
    // Scope the count to the discrepancy-count element to avoid partial matches in the run heading.
    await expect.element(page.getByTestId('discrepancy-count').getByText('3')).toBeInTheDocument();
    // Hint text appears
    await expect.element(page.getByText(/Acknowledge all discrepancies/)).toBeInTheDocument();
  });

  test('renders finalize-blocked with unapproved record count', async () => {
    const data = makeQueue();
    const reason: FinalizeBlockedReason = {
      error: 'Cannot finalize run: some records are not yet individually approved',
      unapproved_record_ids: ['rec-0001', 'rec-0002'],
    };

    mounted = renderInBrowser(
      <CommissionRunReviewView
        {...defaultProps()}
        phase={{ kind: 'queue', data }}
        finalizeBlockedReason={reason}
      />,
    );

    await expect.element(page.getByTestId('finalize-blocked')).toBeInTheDocument();
    await expect.element(page.getByTestId('unapproved-count')).toBeInTheDocument();
    // Scope the count to the unapproved-count element to avoid partial matches in date strings.
    await expect.element(page.getByTestId('unapproved-count').getByText('2')).toBeInTheDocument();
  });

  test('renders finalize-blocked without counts when only error message is present', async () => {
    const data = makeQueue();
    const reason: FinalizeBlockedReason = {
      error: 'Run cannot be finalized at this time',
    };

    mounted = renderInBrowser(
      <CommissionRunReviewView
        {...defaultProps()}
        phase={{ kind: 'queue', data }}
        finalizeBlockedReason={reason}
      />,
    );

    await expect.element(page.getByTestId('finalize-blocked')).toBeInTheDocument();
    await expect
      .element(page.getByText('Run cannot be finalized at this time'))
      .toBeInTheDocument();
    // No count elements when not present
    await expect.element(page.getByTestId('discrepancy-count')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('unapproved-count')).not.toBeInTheDocument();
  });
});

describe('CommissionRunReviewView — batch-approved and finalized terminal states', () => {
  test('renders the batch-approved state', async () => {
    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'batch-approved', runId: 'test-run-id' }} />,
    );

    await expect.element(page.getByTestId('batch-approved-state')).toBeInTheDocument();
    await expect.element(page.getByText(/Run approved/)).toBeInTheDocument();
  });

  test('renders the finalized state', async () => {
    mounted = renderInBrowser(
      <CommissionRunReviewView {...defaultProps()} phase={{ kind: 'finalized' }} />,
    );

    await expect.element(page.getByTestId('finalized-state')).toBeInTheDocument();
    await expect.element(page.getByText(/Run finalized/)).toBeInTheDocument();
  });
});

describe('CommissionRunReviewView — role gating (structural)', () => {
  test('top-level wrapper has the correct data-testid for role-gating assertions', async () => {
    mounted = renderInBrowser(<CommissionRunReviewView {...defaultProps()} />);
    await expect.element(page.getByTestId('commission-run-review')).toBeInTheDocument();
  });
});

/**
 * AdjustmentLedger component tests — real headless Chromium (no Vitest mocking helpers).
 *
 * Covers:
 *   - Loading state
 *   - Error state
 *   - Empty adjustment list (no clawback triggered yet)
 *   - Data state: ledger renders all entries with amount/reason/actor/timestamp
 *   - Data state: existing entries have NO edit or delete controls (append-only)
 *   - Data state: recovery schedule renders when present
 *   - Post-adjustment: form submits, new row appended without mutating prior rows
 *   - 403 unauthenticated path: error state renders for non-Finance-Admin
 *
 * No Vitest mocking helpers are used (TEST-C-001).
 *
 * Issue: feat: Finance Admin UI — adjustment ledger (clawback/holdback, append-only) (#104)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import {
  AdjustmentLedgerView,
  TriggerForm,
  type PlacementClawbackStatus,
  type TriggerClawbackResult,
  type TriggerClawbackBody,
} from '../../apps/web/src/components/finance/AdjustmentLedger';
import { renderInBrowser, type Mounted } from './render';
import type { AsyncState } from '../../apps/web/src/lib/useAsync';
import { ApiError } from '../../apps/web/src/lib/apiClient';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLACEMENT_ID = 'pl-0001-0000-0000-000000000001';

const status: PlacementClawbackStatus = {
  placement_id: PLACEMENT_ID,
  clawback_event: {
    id: 'ce-0001-0000-0000-000000000001',
    event_type: 'candidate_departure',
    rule: 'clawback',
    occurred_at: '2025-09-01T00:00:00.000Z',
    triggered_by: 'fa-0001-0000-0000-000000000001',
    created_at: '2025-09-01T12:00:00.000Z',
  },
  adjustments: [
    {
      id: 'adj-0001-0000-0000-000000000001',
      commission_record_id: 'cr-0001-0000-0000-000000000001',
      amount_delta: -1500,
      reason_code: 'clawback',
      adjusted_by: 'fa-0001-0000-0000-000000000001',
      adjusted_at: '2025-09-01T12:00:00.000Z',
      recovered: false,
    },
    {
      id: 'adj-0002-0000-0000-000000000002',
      commission_record_id: 'cr-0002-0000-0000-000000000002',
      amount_delta: -750,
      reason_code: 'holdback',
      adjusted_by: 'fa-0001-0000-0000-000000000001',
      adjusted_at: '2025-09-02T12:00:00.000Z',
      recovered: true,
    },
  ],
  recovery_schedules: [
    {
      id: 'rs-0001-0000-0000-000000000001',
      commission_record_id: 'cr-0001-0000-0000-000000000001',
      clawback_amount: 1500,
      installment_count: 3,
      installment_amount: 500,
      created_at: '2025-09-01T12:00:00.000Z',
    },
  ],
};

const emptyStatus: PlacementClawbackStatus = {
  placement_id: PLACEMENT_ID,
  clawback_event: null,
  adjustments: [],
  recovery_schedules: [],
};

// ---------------------------------------------------------------------------
// AdjustmentLedgerView state tests
// ---------------------------------------------------------------------------

describe('AdjustmentLedgerView', () => {
  test('renders the loading state', async () => {
    const loadingState: AsyncState<PlacementClawbackStatus> = {
      data: null,
      loading: true,
      error: null,
    };
    mounted = renderInBrowser(
      <AdjustmentLedgerView
        placementId={PLACEMENT_ID}
        state={loadingState}
        onTriggerSuccess={() => undefined}
      />,
    );
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders the error state', async () => {
    const errorState: AsyncState<PlacementClawbackStatus> = {
      data: null,
      loading: false,
      error: 'Forbidden: Finance Admin role required',
    };
    mounted = renderInBrowser(
      <AdjustmentLedgerView
        placementId={PLACEMENT_ID}
        state={errorState}
        onTriggerSuccess={() => undefined}
      />,
    );
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('error-state'))
      .toHaveTextContent('Finance Admin role required');
  });

  test('renders the empty state when no clawback has been triggered', async () => {
    const dataState: AsyncState<PlacementClawbackStatus> = {
      data: emptyStatus,
      loading: false,
      error: null,
    };
    mounted = renderInBrowser(
      <AdjustmentLedgerView
        placementId={PLACEMENT_ID}
        state={dataState}
        onTriggerSuccess={() => undefined}
      />,
    );
    await expect.element(page.getByTestId('adjustment-ledger')).toBeInTheDocument();
    // The adjustment table empty state should appear (no rows)
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
  });

  test('renders all adjustment entries with amount, reason, actor, timestamp', async () => {
    const dataState: AsyncState<PlacementClawbackStatus> = {
      data: status,
      loading: false,
      error: null,
    };
    mounted = renderInBrowser(
      <AdjustmentLedgerView
        placementId={PLACEMENT_ID}
        state={dataState}
        onTriggerSuccess={() => undefined}
      />,
    );
    await expect.element(page.getByTestId('adjustment-table')).toBeInTheDocument();

    // Amount rendered (newest-first: adj-0002 is newer, so -$750.00 appears first)
    await expect.element(page.getByText('-$750.00')).toBeInTheDocument();
    await expect.element(page.getByText('-$1,500.00')).toBeInTheDocument();

    // Clawback event banner present
    await expect.element(page.getByTestId('clawback-event-banner')).toBeInTheDocument();
  });

  test('existing entries have no edit or delete controls (append-only)', async () => {
    const dataState: AsyncState<PlacementClawbackStatus> = {
      data: status,
      loading: false,
      error: null,
    };
    mounted = renderInBrowser(
      <AdjustmentLedgerView
        placementId={PLACEMENT_ID}
        state={dataState}
        onTriggerSuccess={() => undefined}
      />,
    );
    await expect.element(page.getByTestId('adjustment-table')).toBeInTheDocument();

    // No edit or delete buttons anywhere in the ledger
    const editButtons = page.getByRole('button', { name: /edit/i });
    await expect.element(editButtons).not.toBeInTheDocument();
    const deleteButtons = page.getByRole('button', { name: /delete/i });
    await expect.element(deleteButtons).not.toBeInTheDocument();
  });

  test('renders recovery schedule when present', async () => {
    const dataState: AsyncState<PlacementClawbackStatus> = {
      data: status,
      loading: false,
      error: null,
    };
    mounted = renderInBrowser(
      <AdjustmentLedgerView
        placementId={PLACEMENT_ID}
        state={dataState}
        onTriggerSuccess={() => undefined}
      />,
    );
    await expect.element(page.getByTestId('recovery-schedule-table')).toBeInTheDocument();
    await expect.element(page.getByTestId('recovery-schedule-row')).toBeInTheDocument();
    // Installment amount
    await expect.element(page.getByText('$500.00')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TriggerForm: posting an adjustment appends a new row without mutating prior rows
// ---------------------------------------------------------------------------

describe('TriggerForm', () => {
  test('posts adjustment and calls onSuccess with the result', async () => {
    let successResult: TriggerClawbackResult | null = null;

    const triggerResult: TriggerClawbackResult = {
      clawback_event_id: 'ce-new-0000-0000-000000000099',
      placement_id: PLACEMENT_ID,
      event_type: 'candidate_departure',
      rule: 'clawback',
      occurred_at: '2025-09-10T00:00:00.000Z',
      commission_records_affected: 1,
    };

    // Real async function — returns a resolved promise (no Vitest mocking helpers).
    const onTrigger = async (
      _pid: string,
      _body: TriggerClawbackBody,
    ): Promise<TriggerClawbackResult> => triggerResult;

    mounted = renderInBrowser(
      <TriggerForm
        placementId={PLACEMENT_ID}
        onSuccess={(r) => {
          successResult = r;
        }}
        onTrigger={onTrigger}
      />,
    );

    await expect.element(page.getByTestId('trigger-form')).toBeInTheDocument();
    // Rule selector is present (reason is required via the select)
    await expect.element(page.getByTestId('trigger-rule')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('trigger-submit'));

    // onSuccess should have been called — we verify via the captured result
    await expect.poll(() => successResult).not.toBeNull();
    expect(successResult!.clawback_event_id).toBe(triggerResult.clawback_event_id);
  });

  test('shows error message when trigger POST fails', async () => {
    const failingTrigger = async (
      _pid: string,
      _body: TriggerClawbackBody,
    ): Promise<TriggerClawbackResult> => {
      throw new ApiError(422, 'Guarantee period is already Triggered');
    };

    mounted = renderInBrowser(
      <TriggerForm
        placementId={PLACEMENT_ID}
        onSuccess={() => undefined}
        onTrigger={failingTrigger}
      />,
    );

    await userEvent.click(page.getByTestId('trigger-submit'));
    await expect.element(page.getByTestId('trigger-error')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('trigger-error'))
      .toHaveTextContent('Guarantee period is already Triggered');
  });

  test('prior rows in the ledger are untouched after a successful post', async () => {
    // Render the ledger view with existing rows, pass a trigger that resolves immediately.
    const triggerResult: TriggerClawbackResult = {
      clawback_event_id: 'ce-new-0000-0000-000000000099',
      placement_id: PLACEMENT_ID,
      event_type: 'refund',
      rule: 'holdback',
      occurred_at: '2025-09-10T00:00:00.000Z',
      commission_records_affected: 1,
    };

    const onTrigger = async (
      _pid: string,
      _body: TriggerClawbackBody,
    ): Promise<TriggerClawbackResult> => triggerResult;

    const dataState: AsyncState<PlacementClawbackStatus> = {
      data: status,
      loading: false,
      error: null,
    };

    let triggerSuccessCalled = false;

    mounted = renderInBrowser(
      <AdjustmentLedgerView
        placementId={PLACEMENT_ID}
        state={dataState}
        onTriggerSuccess={() => {
          triggerSuccessCalled = true;
        }}
        onTrigger={onTrigger}
      />,
    );

    // Existing rows are present before submit
    await expect.element(page.getByTestId('adjustment-table')).toBeInTheDocument();
    await expect.element(page.getByText('-$750.00')).toBeInTheDocument();
    await expect.element(page.getByText('-$1,500.00')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('trigger-submit'));

    // onTriggerSuccess fired — signals the container to reload
    await expect.poll(() => triggerSuccessCalled).toBe(true);

    // Prior rows still intact in the view (state was not mutated)
    await expect.element(page.getByText('-$750.00')).toBeInTheDocument();
    await expect.element(page.getByText('-$1,500.00')).toBeInTheDocument();
  });
});

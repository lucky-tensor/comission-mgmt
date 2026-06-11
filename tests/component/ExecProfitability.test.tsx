/**
 * ExecProfitability component tests — real headless Chromium (no mocking).
 *
 * Asserts the Client column shows the human-readable client display name from
 * the analytics payload, not the raw client UUID (#203, docs/ux-review.md §1).
 *
 * Issue: feat: webapp — UX overhaul: entity pickers / client display names (#203)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { renderInBrowser, type Mounted } from './render';
import {
  ExecProfitabilityView,
  type ExecProfitabilityViewProps,
} from '../../apps/web/src/components/ExecProfitability';
import type { AsyncState } from '../../apps/web/src/lib/useAsync';

let mounted: Mounted | undefined;
afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // already removed
  }
  mounted = undefined;
});

const CLIENT_ID = '6908cc9b-23d1-4965-b195-641fbba44c2c';
const CLIENT_NAME = 'Summit Partners (6908)';

const analytics = {
  period: { start: '2025-01-01', end: '2025-01-31' },
  gross_fees_booked: '50000.00',
  net_fee_income: '0',
  commission_accrued: '0',
  commission_payable: '0',
  commission_held: '0',
  clawback_exposure: '0',
  guarantee_exposure: '0',
  disputed_commission: '0',
  exception_rate: 0,
  dispute_rate: 0,
  total_placements: 1,
  profitability_by_client: [
    {
      clientId: CLIENT_ID,
      clientName: CLIENT_NAME,
      grossFees: '50000.00',
      commissionBurden: '10000.00',
    },
  ],
  profitability_by_producer: [],
};

function render(props: Partial<ExecProfitabilityViewProps> = {}) {
  const state = { data: analytics, loading: false, error: null } as AsyncState<typeof analytics>;
  const defaults: ExecProfitabilityViewProps = {
    state: state as never,
    dimension: 'client',
    periodStart: '2025-01-01',
    periodEnd: '2025-01-31',
    sortDir: 'desc',
    onDimensionChange: () => {},
    onSortToggle: () => {},
    onStartChange: () => {},
    onEndChange: () => {},
  };
  mounted = renderInBrowser(<ExecProfitabilityView {...defaults} {...props} />);
}

describe('ExecProfitability — client display name', () => {
  test('the Client column shows the client display name, not the raw UUID', async () => {
    render();
    await expect.element(page.getByTestId('profitability-table')).toBeInTheDocument();
    await expect.element(page.getByText(CLIENT_NAME)).toBeInTheDocument();
    // The raw UUID must not appear anywhere in the table.
    expect(mounted!.container.textContent ?? '').not.toContain(CLIENT_ID);
  });
});

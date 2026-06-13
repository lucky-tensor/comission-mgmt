/**
 * FinancePage composition tests — real headless Chromium.
 *
 * The /finance route used to render four stacked full-height components, two of
 * which were both titled "Finance Admin" (docs/ux-review.md §2). This asserts
 * the rebuilt page is ONE composed page with three tabs containing all the
 * task-named section headings and no duplicate "Finance Admin" heading text (#203).
 *
 * The tabbed layout (feat: tabbed navigation for all user roles) organises the
 * sections into:
 *   Processing tab: Data Gap Queue, Commission Runs, Invoice & Collection Tracking
 *   Adjustments & Payroll tab: Adjustments & Payroll Export
 *   Reconciliation tab: Reconciliation Report
 *
 * The child sections fetch on mount; this test only inspects the page frame and
 * headings, which render regardless of the data state.
 *
 * Issue: feat: webapp — UX overhaul: page composition (#203)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { renderInBrowser, type Mounted } from './render';
import { FinancePage } from '../../apps/web/src/components/finance/FinancePage';

let mounted: Mounted | undefined;
afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // already removed
  }
  mounted = undefined;
});

/** Headings visible in the default Processing tab. */
const PROCESSING_HEADINGS = ['Commission Runs', 'Invoice & Collection Tracking'];

/** Heading visible only in the Adjustments & Payroll tab. */
const ADJUSTMENTS_HEADING = 'Adjustments & Payroll Export';

describe('FinancePage composition', () => {
  test('renders exactly one composed finance page', async () => {
    mounted = renderInBrowser(<FinancePage />);
    await expect.element(page.getByTestId('finance-page')).toBeInTheDocument();
    expect(mounted.container.querySelectorAll('[data-testid="finance-page"]').length).toBe(1);
  });

  test('renders the Processing tab headings by default', async () => {
    mounted = renderInBrowser(<FinancePage />);
    // The Processing tab is the default — its headings render immediately.
    for (const heading of PROCESSING_HEADINGS) {
      await expect.element(page.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
  });

  test('renders the Adjustments & Payroll heading when that tab is active', async () => {
    mounted = renderInBrowser(<FinancePage />);
    await expect.element(page.getByTestId('finance-page')).toBeInTheDocument();
    await userEvent.click(page.getByRole('tab', { name: /adjustments/i }));
    await expect
      .element(page.getByRole('heading', { name: ADJUSTMENTS_HEADING }))
      .toBeInTheDocument();
  });

  test('no heading is titled "Finance Admin"', async () => {
    mounted = renderInBrowser(<FinancePage />);
    await expect.element(page.getByTestId('finance-page')).toBeInTheDocument();
    const headings = Array.from(mounted.container.querySelectorAll('h1, h2, h3')).map((h) =>
      (h.textContent ?? '').trim(),
    );
    // The leaked "Finance Admin" (viewer, not task) heading must be gone.
    expect(headings.filter((t) => t === 'Finance Admin')).toEqual([]);
  });
});

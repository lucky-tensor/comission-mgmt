/**
 * FinancePage composition tests — real headless Chromium.
 *
 * The /finance route used to render four stacked full-height components, two of
 * which were both titled "Finance Admin" (docs/ux-review.md §2). This asserts
 * the rebuilt page is ONE composed page with four task-named section headings
 * and no duplicate "Finance Admin" heading text (#203).
 *
 * The child sections fetch on mount; this test only inspects the page frame and
 * headings, which render regardless of the data state.
 *
 * Issue: feat: webapp — UX overhaul: page composition (#203)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
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

const PROCESSING_HEADINGS = ['Data Gap Queue', 'Commission Runs', 'Invoice & Collection Tracking'];

describe('FinancePage composition', () => {
  test('renders exactly one composed finance page', async () => {
    mounted = renderInBrowser(<FinancePage />);
    await expect.element(page.getByTestId('finance-page')).toBeInTheDocument();
    expect(mounted.container.querySelectorAll('[data-testid="finance-page"]').length).toBe(1);
  });

  test('renders the four task-named section headings', async () => {
    mounted = renderInBrowser(<FinancePage />);
    for (const heading of PROCESSING_HEADINGS) {
      await expect.element(page.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    await page.getByRole('tab', { name: 'Adjustments & Payroll' }).click();
    await expect
      .element(page.getByRole('heading', { name: 'Adjustments & Payroll Export' }))
      .toBeInTheDocument();
  });

  test('no heading is titled "Finance Admin"; each task heading appears once', async () => {
    mounted = renderInBrowser(<FinancePage />);
    await expect.element(page.getByTestId('finance-page')).toBeInTheDocument();
    let headings = Array.from(mounted.container.querySelectorAll('h1, h2, h3')).map((h) =>
      (h.textContent ?? '').trim(),
    );
    expect(headings.filter((t) => t === 'Finance Admin')).toEqual([]);
    for (const task of PROCESSING_HEADINGS) {
      expect(headings.filter((t) => t === task).length).toBe(1);
    }

    await page.getByRole('tab', { name: 'Adjustments & Payroll' }).click();
    headings = Array.from(mounted.container.querySelectorAll('h1, h2, h3')).map((h) =>
      (h.textContent ?? '').trim(),
    );
    expect(headings.filter((t) => t === 'Finance Admin')).toEqual([]);
    expect(headings.filter((t) => t === 'Adjustments & Payroll Export').length).toBe(1);
  });
});

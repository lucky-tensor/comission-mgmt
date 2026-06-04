/**
 * Producer — user story E2E tests.
 *
 * Every test mounts the full App, navigates to '/', logs in through the
 * Login UI by clicking the 'Producer' demo button, then drives the story
 * steps via userEvent against real DOM elements.
 *
 * Stories covered (docs/prd.md §4, Producer):
 *   PR-1  Credited placement detail
 *   PR-2  Tier progress
 *   PR-3  Hold status and reason
 *   PR-4  Submit dispute
 *
 * Canonical docs: docs/prd.md §4, §5.9
 * Test plan: docs/code-review/test-plan.md
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { navigate } from '../../../apps/web/src/App';
import { loginAs, type Mounted } from './helpers';

let current: Mounted | undefined;

afterEach(() => {
  try { current?.unmount(); } catch { /* already unmounted */ }
  current = undefined;
  navigate('/');
});

// ---------------------------------------------------------------------------
// PR-1 — Credited placement detail
// ---------------------------------------------------------------------------

describe('PR-1: Producer sees credited placement detail', () => {
  test('login lands on /portal with the payout portal rendered', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('Producer');
    expect(window.location.pathname).toBe('/portal');
    await expect.element(page.getByText('Producer Payout Portal')).toBeInTheDocument();
  });

  test('payout table renders with at least one payout amount', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('payout-table')).toBeInTheDocument();
    const amountCell = page.getByTestId('payout-table').getByRole('cell', { name: '$5,000.00' });
    await expect.element(amountCell).toBeInTheDocument();
  });

  test('payout table row shows contributor role', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('payout-table')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('payout-table'))
      .toHaveTextContent('CandidateOwner');
  });

  test('payout table row shows a split percentage', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('payout-table')).toBeInTheDocument();
    // Split percentage cell should contain a % value.
    await expect
      .element(page.getByTestId('payout-table'))
      .toHaveTextContent('%');
  });

  test('credited placements list renders', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('placements-list')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PR-2 — Tier progress
// ---------------------------------------------------------------------------

describe('PR-2: Producer sees tier progress', () => {
  test('tier-progress widget renders on /portal', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('tier-progress')).toBeInTheDocument();
  });

  test('current production figure is displayed', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('tier-production')).toBeInTheDocument();
    const text = (await page.getByTestId('tier-production').element())?.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  test('current tier rate is displayed', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('tier-progress')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('tier-progress'))
      .toHaveTextContent('%');
  });

  test('next threshold or at-cap message is displayed', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('tier-progress')).toBeInTheDocument();
    // Either a next-threshold element or an at-cap element must be present.
    const hasThreshold = (await page.getByTestId('tier-next-threshold').elements()).length > 0;
    const hasAtCap = (await page.getByTestId('tier-at-cap').elements()).length > 0;
    expect(hasThreshold || hasAtCap).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PR-3 — Hold status and reason
// ---------------------------------------------------------------------------

describe('PR-3: Producer sees hold status and reason for held payouts', () => {
  test('placements list shows a collection-gated hold reason', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('placements-list')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('placements-list'))
      .toHaveTextContent('Payment is pending client collection.');
  });

  test('placements list shows a guarantee-window hold reason', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('placements-list')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('placements-list'))
      .toHaveTextContent('guarantee window');
  });

  test('placements list shows a pending-approval hold reason', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('placements-list')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('placements-list'))
      .toHaveTextContent('pending approval');
  });
});

// ---------------------------------------------------------------------------
// PR-4 — Submit dispute
// ---------------------------------------------------------------------------

describe('PR-4: Producer submits a dispute', () => {
  test('dispute form renders on /portal', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('dispute-form')).toBeInTheDocument();
  });

  test('dispute-record select contains at least one commission record option', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('dispute-form')).toBeInTheDocument();
    const select = page.getByTestId('dispute-record');
    await expect.element(select).toBeInTheDocument();
    const options = await select.element()?.querySelectorAll('option');
    expect((options?.length ?? 0)).toBeGreaterThan(0);
  });

  test('filling the form and submitting shows the confirmation', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('dispute-form')).toBeInTheDocument();
    // Select the first commission record.
    const select = page.getByTestId('dispute-record');
    const selectEl = await select.element() as HTMLSelectElement;
    const firstOption = selectEl?.querySelectorAll('option')[0];
    if (firstOption) {
      await userEvent.selectOptions(selectEl, firstOption.getAttribute('value') ?? '');
    }
    await userEvent.fill(
      page.getByTestId('dispute-description'),
      'My net payout looks lower than expected for this placement.',
    );
    await userEvent.click(page.getByTestId('dispute-submit'));
    await expect.element(page.getByTestId('dispute-confirmation')).toBeInTheDocument();
    await expect.element(page.getByTestId('dispute-state')).toHaveTextContent('Submitted');
  });
});

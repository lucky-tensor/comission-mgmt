/**
 * External Partner — user story E2E tests.
 *
 * Every test mounts the full App, navigates to '/', logs in through the
 * Login UI by clicking the 'External Partner' demo button, then drives the
 * story steps via userEvent against real DOM elements.
 *
 * Stories covered (docs/prd.md §4, External Partner):
 *   EP-1  Scoped payout visibility
 *
 * Canonical docs: docs/prd.md §4, §5.11, §9 (Visibility and Confidentiality)
 * Test plan: docs/code-review/test-plan.md
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { PARTNER } from '../fixtures/ids';
import { navigate } from '../../../apps/web/src/App';
import { loginAs, loadFixture, type Mounted, type E2EFixture } from './helpers';

let fixture: E2EFixture;
let current: Mounted | undefined;

beforeAll(async () => {
  fixture = await loadFixture();
});

afterEach(() => {
  try {
    current?.unmount();
  } catch {
    /* already unmounted */
  }
  current = undefined;
  navigate('/');
});

// ---------------------------------------------------------------------------
// EP-1 — Scoped payout visibility
// ---------------------------------------------------------------------------

describe('EP-1: External Partner sees only their own deals', () => {
  test('login lands on /partner with the partner payout surface', async () => {
    current = await loginAs('External Partner');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('ExternalPartner');
    expect(window.location.pathname).toBe('/partner');
    await expect.element(page.getByTestId('partner-payout-view')).toBeInTheDocument();
  });

  test('partner-placements-list renders', async () => {
    current = await loginAs('External Partner');
    await expect.element(page.getByTestId('partner-placements-list')).toBeInTheDocument();
  });

  test('own split deal row is visible', async () => {
    current = await loginAs('External Partner');
    await expect.element(page.getByTestId('partner-placements-list')).toBeInTheDocument();
    await expect
      .element(page.getByTestId(`partner-placement-row-${fixture.partnerPlacementId}`))
      .toBeInTheDocument();
  });

  test('amount-owed cell shows the correct seeded fee amount', async () => {
    current = await loginAs('External Partner');
    await expect
      .element(page.getByTestId(`partner-placement-row-${fixture.partnerPlacementId}`))
      .toBeInTheDocument();
    const amountCell = page
      .getByTestId(`partner-placement-row-${fixture.partnerPlacementId}`)
      .getByTestId('partner-placement-amount-owed');
    await expect
      .element(amountCell)
      .toHaveTextContent(
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
          Number(PARTNER.feeAmount),
        ),
      );
  });

  test('payment-trigger cell shows the placement start date', async () => {
    current = await loginAs('External Partner');
    await expect
      .element(page.getByTestId(`partner-placement-row-${fixture.partnerPlacementId}`))
      .toBeInTheDocument();
    const triggerCell = page
      .getByTestId(`partner-placement-row-${fixture.partnerPlacementId}`)
      .getByTestId('partner-placement-payment-trigger');
    await expect.element(triggerCell).toHaveTextContent(PARTNER.startDate);
  });

  test('payment-status badge is present on the own deal row', async () => {
    current = await loginAs('External Partner');
    await expect
      .element(page.getByTestId(`partner-placement-row-${fixture.partnerPlacementId}`))
      .toBeInTheDocument();
    await expect
      .element(
        page
          .getByTestId(`partner-placement-row-${fixture.partnerPlacementId}`)
          .getByTestId('partner-placement-status'),
      )
      .toBeInTheDocument();
  });

  test('unrelated placement row is absent from the list', async () => {
    current = await loginAs('External Partner');
    await expect.element(page.getByTestId('partner-placements-list')).toBeInTheDocument();
    await expect
      .element(page.getByTestId(`partner-placement-row-${fixture.unrelatedPlacementId}`))
      .not.toBeInTheDocument();
  });

  test('navigating to /finance renders the Forbidden surface', async () => {
    current = await loginAs('External Partner');
    await expect.element(page.getByTestId('partner-payout-view')).toBeInTheDocument();
    navigate('/finance');
    await expect.element(page.getByTestId('forbidden-surface')).toBeInTheDocument();
  });
});

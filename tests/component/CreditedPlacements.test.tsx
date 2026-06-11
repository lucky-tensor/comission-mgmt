/**
 * CreditedPlacements component tests — real headless Chromium (no mocks).
 * Loading / error / empty / data states asserted against the real DOM.
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import type { CommissionRecord } from 'core/producer-portal';
import { CreditedPlacementsView } from '../../apps/web/src/components/portal/CreditedPlacements';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

const record: CommissionRecord = {
  id: 'r1',
  org_id: 'o1',
  placement_id: 'pl1',
  contributor_id: 'c1',
  plan_version_id: 'pv1',
  gross_commission: 20000,
  net_payable: 15750,
  tier_rate: 0.25,
  status: 'Payable',
  hold_reason: null,
  billing_phase_id: null,
  blocked_phase: null,
  explanation: 'Gross fee 20000 × 25% tier rate',
  approval_actor: null,
  approval_at: null,
  created_at: '2025-04-01T00:00:00.000Z',
};

describe('CreditedPlacementsView', () => {
  test('renders the loading state', async () => {
    mounted = renderInBrowser(
      <CreditedPlacementsView state={{ data: null, loading: true, error: null }} />,
    );
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders the empty state', async () => {
    mounted = renderInBrowser(
      <CreditedPlacementsView state={{ data: [], loading: false, error: null }} />,
    );
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
  });

  test('renders the error state', async () => {
    mounted = renderInBrowser(
      <CreditedPlacementsView state={{ data: null, loading: false, error: 'boom' }} />,
    );
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
  });

  test('renders records with explanation in the data state', async () => {
    mounted = renderInBrowser(
      <CreditedPlacementsView state={{ data: [record], loading: false, error: null }} />,
    );
    await expect.element(page.getByTestId('placements-list')).toBeInTheDocument();
    await expect.element(page.getByText('$15,750.00 net')).toBeInTheDocument();
    await expect.element(page.getByText('Gross fee 20000 × 25% tier rate')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // #203 — lead with role title + status chip; explanation is expandable
  // -------------------------------------------------------------------------

  test('leads with the role title and a semantic status chip', async () => {
    const withTitle = { ...record, position_title: 'Staff Engineer' };
    mounted = renderInBrowser(
      <CreditedPlacementsView state={{ data: [withTitle], loading: false, error: null }} />,
    );
    await expect
      .element(page.getByTestId(`placement-lead-${record.id}`))
      .toHaveTextContent('Staff Engineer');
    // Payable maps to the green (paid/complete) semantic variant.
    const chip = page.getByTestId(`placement-status-${record.id}`);
    await expect.element(chip).toBeInTheDocument();
    expect((await chip.element())?.getAttribute('data-variant')).toBe('green');
  });

  test('falls back to a short placement reference when no title is provided', async () => {
    mounted = renderInBrowser(
      <CreditedPlacementsView state={{ data: [record], loading: false, error: null }} />,
    );
    await expect
      .element(page.getByTestId(`placement-lead-${record.id}`))
      .toHaveTextContent('Placement');
  });

  test('renders the explanation inside an expandable details element', async () => {
    mounted = renderInBrowser(
      <CreditedPlacementsView state={{ data: [record], loading: false, error: null }} />,
    );
    const details = page.getByTestId(`placement-explanation-${record.id}`);
    await expect.element(details).toBeInTheDocument();
    expect((await details.element())?.tagName).toBe('DETAILS');
  });
});

/**
 * PayoutStatement component tests — real headless Chromium (no mocks).
 *
 * Renders the presentational view in each state (loading, error, empty, data)
 * and asserts the rendered DOM via real browser locators. Data values are
 * constructed in-test in the seeded API's response shape — no network mock and
 * no mock helpers (TEST-C-001).
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import type { Payout } from 'core/producer-portal';
import { PayoutStatementView } from '../../apps/web/src/components/portal/PayoutStatement';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

const payout: Payout = {
  id: 'p1',
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
  position_title: 'Senior Recruiter',
  client_name: null,
};

describe('PayoutStatementView', () => {
  test('renders the loading state', async () => {
    mounted = renderInBrowser(
      <PayoutStatementView state={{ data: null, loading: true, error: null }} />,
    );
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders the empty state', async () => {
    mounted = renderInBrowser(
      <PayoutStatementView state={{ data: [], loading: false, error: null }} />,
    );
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
  });

  test('renders the error state', async () => {
    mounted = renderInBrowser(
      <PayoutStatementView state={{ data: null, loading: false, error: 'API down' }} />,
    );
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByText('API down')).toBeInTheDocument();
  });

  test('renders payout figures in the data state', async () => {
    mounted = renderInBrowser(
      <PayoutStatementView state={{ data: [payout], loading: false, error: null }} />,
    );
    await expect.element(page.getByTestId('payout-table')).toBeInTheDocument();
    await expect.element(page.getByText('Senior Recruiter')).toBeInTheDocument();
    await expect.element(page.getByText('$15,750.00')).toBeInTheDocument();
    await expect.element(page.getByText('25%')).toBeInTheDocument();
  });
});

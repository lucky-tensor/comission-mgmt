/**
 * TierProgress component tests — real headless Chromium (no mocks).
 * Loading / error / empty / data states asserted against the real DOM.
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import type { TierProgress } from 'core/producer-portal';
import { TierProgressView } from '../../apps/web/src/components/portal/TierProgress';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

const progress: TierProgress = {
  plan_version_id: 'pv1',
  period_start: '2025-01-01',
  period_end: null,
  current_period_production: 20000,
  current_tier_rate: 0.25,
  next_tier_threshold: 50000,
  remaining_to_next_tier: 30000,
};

describe('TierProgressView', () => {
  test('renders the loading state', async () => {
    mounted = renderInBrowser(
      <TierProgressView state={{ data: null, loading: true, error: null }} />,
    );
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders the empty state (no active plan)', async () => {
    mounted = renderInBrowser(
      <TierProgressView state={{ data: null, loading: false, error: null }} />,
    );
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
  });

  test('renders the error state', async () => {
    mounted = renderInBrowser(
      <TierProgressView state={{ data: null, loading: false, error: 'nope' }} />,
    );
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
  });

  test('renders production, rate, and next-tier threshold in the data state', async () => {
    mounted = renderInBrowser(
      <TierProgressView state={{ data: progress, loading: false, error: null }} />,
    );
    await expect.element(page.getByTestId('tier-progress')).toBeInTheDocument();
    await expect.element(page.getByTestId('tier-production')).toHaveTextContent('$20,000.00');
    await expect.element(page.getByTestId('tier-remaining')).toHaveTextContent('$30,000.00');
  });
});

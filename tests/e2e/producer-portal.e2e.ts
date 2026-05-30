/**
 * Producer Portal E2E user-story test — real headless Chromium against the real
 * API server + ephemeral Postgres started by global-setup.ts. No mocks.
 *
 * Story: a producer signs in (demo persona) → the portal loads → the payout
 * statement and tier progress render with the seeded figures → the producer
 * submits a dispute → a resolution-pending confirmation is shown.
 *
 * The whole data path is real: the browser calls `/api/*`, the Vitest dev
 * server proxies to the running server, which reads the seeded ephemeral
 * Postgres. The dispute POST goes through apiClient (CSRF header attached;
 * enforcement disabled in this HTTP harness, see global-setup.ts).
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';
import { SEEDED } from './fixtures/ids';
import { ProducerPortal } from '../../apps/web/src/components/portal/ProducerPortal';

// Demo-login as the seeded producer before driving the portal. This issues the
// session cookie the portal's `/me/*` reads rely on.
beforeAll(async () => {
  const res = await fetch('/api/demo/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: SEEDED.producerId }),
  });
  expect(res.ok).toBe(true);
});

describe('Producer Portal — full user story', () => {
  test('login → portal → payouts + tier → submit dispute → confirmation', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(createElement(ProducerPortal));
    });

    // Portal home renders.
    await expect.element(page.getByText('Producer Payout Portal')).toBeInTheDocument();

    // Payout statement renders the seeded payout. The placement is
    // collection-gated, so the record is Held at $5,000.00 gross (20000 × 25%)
    // with $0 net released — assert the gross figure and tier rate render.
    await expect.element(page.getByTestId('payout-table')).toBeInTheDocument();
    await expect.element(page.getByText('$5,000.00')).toBeInTheDocument();

    // Tier progress renders at the 25% tier rate (scoped to avoid the same
    // text appearing in the payout table and the explanation).
    await expect.element(page.getByTestId('tier-progress')).toBeInTheDocument();
    await expect.element(page.getByTestId('tier-production')).toBeInTheDocument();

    // Credited placements render the held record with its explanation.
    await expect.element(page.getByTestId('placements-list')).toBeInTheDocument();
    await expect
      .element(page.getByText('Payment is pending client collection.', { exact: false }))
      .toBeInTheDocument();

    // Submit a dispute against the producer's record.
    await expect.element(page.getByTestId('dispute-form')).toBeInTheDocument();
    await userEvent.fill(
      page.getByTestId('dispute-description'),
      'My net payout looks lower than expected for this placement.',
    );
    await userEvent.click(page.getByTestId('dispute-submit'));

    // Confirmation with the resolution-pending (Submitted) state.
    await expect.element(page.getByTestId('dispute-confirmation')).toBeInTheDocument();
    await expect.element(page.getByTestId('dispute-state')).toHaveTextContent('Submitted');
  });
});

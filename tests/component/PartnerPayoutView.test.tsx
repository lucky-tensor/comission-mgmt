/**
 * PartnerPayoutView component tests — real headless Chromium (no mocking helpers).
 *
 * Tests (Acceptance criteria §116):
 *   AC#1 — Loading state renders while data is in-flight.
 *   AC#2 — Empty state renders when the partner has no split agreements.
 *   AC#3 — A partner placement renders amount owed, payment trigger, and status.
 *   AC#4 — Confidential placement: job_title and client_entity_id are masked
 *           ("Confidential" / null) and no other-contributor or margin fields appear.
 *   AC#5 — Error state renders on API failure.
 *   AC#6 — Scope enforcement: the ExternalPartner role's permitted set contains
 *           only /partner; every other standard route is absent (verified via
 *           ROLE_ROUTES structural assertion).
 *
 * No Vitest mocking helpers are used. The PlacementsTable presenter receives
 * inline data objects — the server shape is unit-tested separately (AC#1–5).
 * AC#6 is a pure import-time assertion that does not require a running server.
 *
 * Canonical docs: docs/prd.md §5.11, §9
 * Issue: feat: External Partner UI — scoped payout view (#116)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import {
  PlacementsTable,
  type PartnerPlacement,
} from '../../apps/web/src/components/partner/PartnerPayoutView';
import { ROLE_ROUTES, ROUTES } from '../../apps/web/src/lib/roleRoutes';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const placement: PartnerPlacement = {
  id: 'pl-aaa-001',
  org_id: 'org-001',
  candidate_id: 'cand-001',
  client_entity_id: 'client-001',
  job_title: 'VP Engineering',
  compensation_base: '250000',
  fee_amount: '50000',
  status: 'Active',
  start_date: '2025-03-01',
  guarantee_days: 90,
  guarantee_expiry_date: '2025-05-30',
  is_confidential: false,
  created_at: '2025-01-15T00:00:00.000Z',
  updated_at: '2025-02-01T00:00:00.000Z',
};

const confidentialPlacement: PartnerPlacement = {
  ...placement,
  id: 'pl-conf-002',
  job_title: 'Confidential',
  client_entity_id: null,
  is_confidential: true,
  fee_amount: '35000',
};

// ---------------------------------------------------------------------------
// AC#1 — Loading state
// ---------------------------------------------------------------------------

describe('PartnerPayoutView — loading state', () => {
  test('renders loading-state element while data is in-flight', async () => {
    mounted = renderInBrowser(<PlacementsTable loading={true} error={null} data={null} />);
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
    expect(page.getByTestId('partner-placements-list').elements()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — Empty state
// ---------------------------------------------------------------------------

describe('PartnerPayoutView — empty state', () => {
  test('renders empty-state element when no placements exist', async () => {
    mounted = renderInBrowser(<PlacementsTable loading={false} error={null} data={[]} />);
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
    expect(page.getByTestId('partner-placements-list').elements()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — Data state: amount owed, payment trigger, payment status
// ---------------------------------------------------------------------------

describe('PartnerPayoutView — data state', () => {
  test('renders placements-list with amount owed, payment trigger, and status', async () => {
    mounted = renderInBrowser(<PlacementsTable loading={false} error={null} data={[placement]} />);

    await expect.element(page.getByTestId('partner-placements-list')).toBeInTheDocument();

    // Amount owed (fee_amount formatted)
    const amountCell = page.getByTestId('partner-placement-amount-owed');
    await expect.element(amountCell).toBeInTheDocument();
    await expect.element(amountCell).toHaveTextContent('$50,000.00');

    // Payment trigger (guarantee_expiry_date takes precedence)
    const triggerCell = page.getByTestId('partner-placement-payment-trigger');
    await expect.element(triggerCell).toBeInTheDocument();
    await expect.element(triggerCell).toHaveTextContent('Guarantee expires 2025-05-30');

    // Payment status badge
    const statusCell = page.getByTestId('partner-placement-status');
    await expect.element(statusCell).toBeInTheDocument();
    await expect.element(statusCell).toHaveTextContent('Active');
  });

  test('renders job_title for a non-confidential placement', async () => {
    mounted = renderInBrowser(<PlacementsTable loading={false} error={null} data={[placement]} />);
    const titleCell = page.getByTestId('partner-placement-job-title');
    await expect.element(titleCell).toBeInTheDocument();
    await expect.element(titleCell).toHaveTextContent('VP Engineering');
    // Confidential badge must NOT appear on a non-confidential placement.
    expect(page.getByTestId('partner-placement-confidential-badge').elements()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Confidential placement: masked fields absent / masked
// ---------------------------------------------------------------------------

describe('PartnerPayoutView — confidential placement masking', () => {
  test('masked job_title renders "Confidential" and the confidential badge is shown', async () => {
    mounted = renderInBrowser(
      <PlacementsTable loading={false} error={null} data={[confidentialPlacement]} />,
    );

    const titleCell = page.getByTestId('partner-placement-job-title');
    await expect.element(titleCell).toBeInTheDocument();
    await expect.element(titleCell).toHaveTextContent('Confidential');

    await expect
      .element(page.getByTestId('partner-placement-confidential-badge'))
      .toBeInTheDocument();
  });

  test('client_entity_id is null (absent) and not rendered in the DOM', async () => {
    mounted = renderInBrowser(
      <PlacementsTable loading={false} error={null} data={[confidentialPlacement]} />,
    );
    await expect.element(page.getByTestId('partner-placements-list')).toBeInTheDocument();

    // The component does not expose client_entity_id at all; assert the raw
    // uuid value does not appear anywhere in the rendered list element.
    const listEl = page.getByTestId('partner-placements-list');
    const el = listEl.element() as HTMLElement;
    expect(el.innerText ?? el.textContent ?? '').not.toContain('client-001');
  });

  test('fee_amount (amount owed) is still rendered for confidential placements', async () => {
    mounted = renderInBrowser(
      <PlacementsTable loading={false} error={null} data={[confidentialPlacement]} />,
    );
    const amountCell = page.getByTestId('partner-placement-amount-owed');
    await expect.element(amountCell).toBeInTheDocument();
    await expect.element(amountCell).toHaveTextContent('$35,000.00');
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Error state
// ---------------------------------------------------------------------------

describe('PartnerPayoutView — error state', () => {
  test('renders error-state element when loader rejects', async () => {
    mounted = renderInBrowser(
      <PlacementsTable loading={false} error="Failed to load placements" data={null} />,
    );
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('error-state'))
      .toHaveTextContent('Failed to load placements');
  });
});

// ---------------------------------------------------------------------------
// AC#6 — Scope enforcement: ExternalPartner only reaches /partner
// ---------------------------------------------------------------------------

describe('PartnerPayoutView — scope enforcement (roleRoutes structural)', () => {
  test('ExternalPartner permitted set contains only /partner', () => {
    const config = ROLE_ROUTES['ExternalPartner'];
    expect(config.permitted.has(ROUTES.PARTNER)).toBe(true);

    // Every other standard route must be absent from the permitted set.
    const otherRoutes = [
      ROUTES.PORTAL,
      ROUTES.FINANCE,
      ROUTES.RECONCILIATION,
      ROUTES.MANAGER,
      ROUTES.EXECUTIVE,
      ROUTES.HR,
    ];
    for (const r of otherRoutes) {
      expect(config.permitted.has(r), `ExternalPartner must not be permitted to reach ${r}`).toBe(
        false,
      );
    }
  });

  test('ExternalPartner nav exposes My Placements and Docs', () => {
    const config = ROLE_ROUTES['ExternalPartner'];
    expect(config.navItems).toHaveLength(2);
    expect(config.navItems[0].path).toBe(ROUTES.PARTNER);
    expect(config.navItems[1].path).toBe(ROUTES.DOCS);
  });

  test('ExternalPartner landing is /partner', () => {
    expect(ROLE_ROUTES['ExternalPartner'].landing).toBe(ROUTES.PARTNER);
  });
});

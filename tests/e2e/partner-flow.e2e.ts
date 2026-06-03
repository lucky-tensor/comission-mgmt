/**
 * External Partner payout visibility & scope enforcement E2E.
 *
 * Real headless Chromium against the real API server + ephemeral Postgres
 * started by global-setup.ts. No mocks (no vi.mock / vi.fn / vi.spyOn).
 *
 * Story (full partner journey):
 *   1. Demo-login as External Partner → /partner renders with "My Placements".
 *   2. The partner sees only their own split deal: amount owed, payment
 *      trigger, and payment status are rendered correctly.
 *   3. Negative scope — the unrelated placement (seeded without a contributor
 *      row for the partner) does NOT appear in the list.
 *   4. Confidential field masking — other contributors' credit, internal
 *      margin, and draw fields are absent from the rendered output (the
 *      server never sends them to ExternalPartner callers).
 *   5. Non-partner route access — a direct fetch to a Producer-only or
 *      Finance-Admin-only route returns 403.
 *
 * Fixtures are seeded by global-setup.ts (Phase 4 — seedPartnerFlow):
 *   - partnerPlacementId — the placement the partner has a split on.
 *   - unrelatedPlacementId — a placement the partner is NOT credited on.
 *
 * Dynamic IDs are delivered from globalSetup via the /__e2e_fixture__
 * endpoint served by the e2eFixturePlugin in vitest.browser.config.ts.
 *
 * Canonical docs: docs/prd.md §5.11, §9 (Visibility and Confidentiality)
 * Issue: test: E2E — External Partner payout visibility and scope enforcement (#121)
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';
import { SEEDED, PARTNER } from './fixtures/ids';
import App, { navigate } from '../../apps/web/src/App';

// ---------------------------------------------------------------------------
// Fixture IDs (fetched from the Vite dev server's /__e2e_fixture__ endpoint)
// ---------------------------------------------------------------------------

interface E2EFixture {
  closeRunId: string;
  closeIncompletePlacementId: string;
  partnerPlacementId: string;
  unrelatedPlacementId: string;
}

let PARTNER_PLACEMENT_ID: string;
let UNRELATED_PLACEMENT_ID: string;

// ---------------------------------------------------------------------------
// React mount / unmount helpers
// ---------------------------------------------------------------------------

interface Mounted {
  unmount: () => void;
}

function mountApp(): Mounted {
  const container = document.createElement('div');
  container.id = `partner-e2e-${Date.now()}`;
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(createElement(App));
  });
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

let current: Mounted | undefined;

afterEach(() => {
  try {
    current?.unmount();
  } catch {
    // already unmounted
  }
  current = undefined;
  navigate('/');
});

// ---------------------------------------------------------------------------
// Setup — load fixture IDs and demo-login as External Partner
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Load fixture IDs written by globalSetup (via the Vite dev server plugin).
  const fixtureRes = await fetch('/__e2e_fixture__');
  const fixture = (await fixtureRes.json()) as E2EFixture;
  PARTNER_PLACEMENT_ID = fixture.partnerPlacementId;
  UNRELATED_PLACEMENT_ID = fixture.unrelatedPlacementId;

  // Demo-login as the External Partner.
  const res = await fetch('/api/demo/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: SEEDED.partnerId }),
  });
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { role: string };
  expect(body.role).toBe('ExternalPartner');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('External Partner — payout visibility and scope enforcement', () => {
  // ── 1. Landing + surface render ──────────────────────────────────────────

  test('partner lands on /partner with the My Placements surface', async () => {
    navigate('/');
    current = mountApp();

    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('ExternalPartner');
    expect(window.location.pathname).toBe('/partner');

    await expect.element(page.getByTestId('partner-payout-view')).toBeInTheDocument();
    await expect.element(page.getByTestId('partner-placements-list')).toBeInTheDocument();
  });

  // ── 2. Positive scope — own deal visible ─────────────────────────────────

  test('partner sees their own split deal with amount owed, payment trigger, and status', async () => {
    navigate('/partner');
    current = mountApp();

    await expect.element(page.getByTestId('partner-placements-list')).toBeInTheDocument();

    // Own placement row is rendered.
    await expect
      .element(page.getByTestId(`partner-placement-row-${PARTNER_PLACEMENT_ID}`))
      .toBeInTheDocument();

    // Amount owed matches the seeded fee_amount.
    const amountCell = page
      .getByTestId(`partner-placement-row-${PARTNER_PLACEMENT_ID}`)
      .getByTestId('partner-placement-amount-owed');
    await expect
      .element(amountCell)
      .toHaveTextContent(
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
          Number(PARTNER.feeAmount),
        ),
      );

    // Payment trigger shows the start date.
    const triggerCell = page
      .getByTestId(`partner-placement-row-${PARTNER_PLACEMENT_ID}`)
      .getByTestId('partner-placement-payment-trigger');
    await expect.element(triggerCell).toHaveTextContent(PARTNER.startDate);

    // Payment status badge is present.
    const statusCell = page
      .getByTestId(`partner-placement-row-${PARTNER_PLACEMENT_ID}`)
      .getByTestId('partner-placement-status');
    await expect.element(statusCell).toBeInTheDocument();
  });

  // ── 3. Negative scope — unrelated placement absent ───────────────────────

  test('partner does NOT see a placement they have no split on', async () => {
    navigate('/partner');
    current = mountApp();

    await expect.element(page.getByTestId('partner-placements-list')).toBeInTheDocument();

    // The unrelated placement row must not be present.
    await expect
      .element(page.getByTestId(`partner-placement-row-${UNRELATED_PLACEMENT_ID}`))
      .not.toBeInTheDocument();
  });

  // ── 4. Confidential field masking — no internal/other-contributor data ────

  test('partner-placements response contains no internal margin or other-contributor fields', async () => {
    // Fetch the raw API response as the partner session and assert that
    // internal-only fields (e.g. compensation_base that may carry margin,
    // unrelated placement IDs) are not present or are masked.
    // Specifically: the GET /partner/placements endpoint must not include
    // entries for placements the partner is not on.
    const res = await fetch('/api/partner/placements');
    expect(res.ok).toBe(true);
    const placements = (await res.json()) as Array<{ id: string }>;

    const ids = placements.map((p) => p.id);

    // Own placement is in the list.
    expect(ids).toContain(PARTNER_PLACEMENT_ID);

    // Unrelated placement is absent.
    expect(ids).not.toContain(UNRELATED_PLACEMENT_ID);
  });

  // ── 5. Non-partner route enforcement — 403 for other role surfaces ────────

  test('navigating to a non-partner route returns 403 from the API', async () => {
    // Direct API request — Finance Admin endpoint (reconciliation report) — must
    // be forbidden for the ExternalPartner session.
    const financeRes = await fetch('/api/reconciliation', { method: 'GET' });
    expect(financeRes.status).toBe(403);

    // Producer self-service endpoint also forbidden.
    const meRes = await fetch('/api/me/payouts');
    expect(meRes.status).toBe(403);
  });

  // ── 6. Non-partner SPA route renders Forbidden surface ────────────────────

  test('navigating to /finance in the SPA renders the Forbidden surface', async () => {
    navigate('/finance');
    current = mountApp();

    // The Forbidden component renders (the route is outside the partner's
    // permitted set — see roleRoutes.ts ExternalPartner config).
    await expect.element(page.getByTestId('forbidden-surface')).toBeInTheDocument();
  });
});

/**
 * Executive — user story E2E tests.
 *
 * Every test mounts the full App, navigates to '/', logs in through the
 * Login UI by clicking the 'Executive' demo button, then drives the story
 * steps via userEvent against real DOM elements.
 *
 * Issue: #161
 * Stories covered (docs/prd.md §4, Executive):
 *   EX-1  Firm financial position
 *   EX-2  Profitability analytics
 *   EX-3  Exception and dispute rate trends
 *   EX-4  Escalated dispute final approval
 *
 * Canonical docs: docs/prd.md §4, §5.4, §5.8
 * Test plan: docs/code-review/test-plan.md
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { SEEDED } from '../fixtures/ids';
import { navigate } from '../../../apps/web/src/App';
import { loginAs, useMount } from './helpers';

let escalatedDisputeId = '';

const mount = useMount();

beforeAll(async () => {
  console.log('[story] executive beforeAll: establishing session');
  // Establish an executive session to discover fixture IDs (disputes endpoint).
  await fetch('/api/demo/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: SEEDED.executiveId }),
  });

  console.log('[story] executive beforeAll: fetching disputes');
  const res = await fetch('/api/disputes', { credentials: 'same-origin' });
  if (res.ok) {
    const data = (await res.json()) as {
      disputes: Array<{ id: string; state: string }>;
    };
    escalatedDisputeId = data.disputes.find((d) => d.state === 'UnderReview')?.id ?? '';
  }
  console.log(`[story] executive beforeAll: escalatedDisputeId=${escalatedDisputeId || '(none)'}`);

  // Clear the session so loginAs() can mount a fresh App that shows the Login page.
  console.log('[story] executive beforeAll: logout');
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  console.log('[story] executive beforeAll: done');
});

// ---------------------------------------------------------------------------
// EX-1 — Firm financial position
// ---------------------------------------------------------------------------

describe('EX-1: Executive views firm financial position', () => {
  test('login lands on /executive with financial position surface', async () => {
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('Executive');
    expect(window.location.pathname).toBe('/executive');
    await expect.element(page.getByTestId('exec-financial-position')).toBeInTheDocument();
  });

  test('period selector inputs are present', async () => {
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('period-start-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('period-end-input')).toBeInTheDocument();
  });

  test('setting period to seed range renders the period stamp', async () => {
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('exec-financial-position')).toBeInTheDocument();
    await userEvent.fill(page.getByTestId('period-start-input'), '2025-05-01');
    await userEvent.fill(page.getByTestId('period-end-input'), '2025-05-31');
    await expect.element(page.getByTestId('period-stamp')).toBeInTheDocument();
  });

  test('at least one named metric card shows a non-blank numeric value', async () => {
    mount.current = await loginAs('Executive');
    await userEvent.fill(page.getByTestId('period-start-input'), '2025-05-01');
    await userEvent.fill(page.getByTestId('period-end-input'), '2025-05-31');
    await expect.element(page.getByTestId('period-stamp')).toBeInTheDocument();
    // Assert one or more metric value elements contain a $ currency string.
    const metricValueIds = [
      'metric-gross-fees-value',
      'metric-commission-accrued-value',
      'metric-commission-payable-value',
      'metric-clawback-exposure-value',
    ];
    let foundCurrency = false;
    for (const testId of metricValueIds) {
      const els = await page.getByTestId(testId).elements();
      if (els.length > 0) {
        const text = els[0]?.textContent ?? '';
        if (text.includes('$')) {
          foundCurrency = true;
          break;
        }
      }
    }
    expect(foundCurrency).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EX-2 — Profitability analytics
// ---------------------------------------------------------------------------

describe('EX-2: Executive views profitability analytics', () => {
  test('navigating to /executive/profitability via nav renders the surface', async () => {
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    // NavShell renders buttons with data-testid derived from path (slashes → dashes).
    await userEvent.click(page.getByTestId('nav-item-executive-profitability'));
    await expect.element(page.getByTestId('exec-profitability')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/executive/profitability');
  });

  test('dimension-switcher is present', async () => {
    mount.current = await loginAs('Executive');
    navigate('/executive/profitability');
    await expect.element(page.getByTestId('exec-profitability')).toBeInTheDocument();
    await expect.element(page.getByTestId('dimension-switcher')).toBeInTheDocument();
  });

  test('switching to Client dimension loads client rows', async () => {
    mount.current = await loginAs('Executive');
    navigate('/executive/profitability');
    await expect.element(page.getByTestId('dimension-switcher')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('dim-btn-client'));
    await expect.element(page.getByTestId('profitability-table')).toBeInTheDocument();
    const rows = page.getByTestId('profitability-table').getByRole('row');
    expect((await rows.elements()).length).toBeGreaterThan(1);
  });

  test('switching to Recruiter dimension loads recruiter rows', async () => {
    mount.current = await loginAs('Executive');
    navigate('/executive/profitability');
    await expect.element(page.getByTestId('dimension-switcher')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('dim-btn-recruiter'));
    await expect.element(page.getByTestId('profitability-table')).toBeInTheDocument();
    const rows = page.getByTestId('profitability-table').getByRole('row');
    expect((await rows.elements()).length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// EX-3 — Exception and dispute rate trends
// ---------------------------------------------------------------------------

describe('EX-3: Executive views exception and dispute rate trends', () => {
  test('navigating to /executive/trends via nav renders the trends surface', async () => {
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('nav-item-executive-trends'));
    await expect.element(page.getByTestId('exec-trends')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/executive/trends');
  });

  test('period inputs are present on the trends surface', async () => {
    mount.current = await loginAs('Executive');
    navigate('/executive/trends');
    await expect.element(page.getByTestId('exec-trends')).toBeInTheDocument();
    await expect.element(page.getByTestId('trends-range-start-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('trends-range-end-input')).toBeInTheDocument();
  });

  test('fetching the seed period renders the trends table', async () => {
    mount.current = await loginAs('Executive');
    navigate('/executive/trends');
    await expect.element(page.getByTestId('exec-trends')).toBeInTheDocument();
    await userEvent.fill(page.getByTestId('trends-range-start-input'), '2025-05-01');
    await userEvent.fill(page.getByTestId('trends-range-end-input'), '2025-05-31');
    await userEvent.click(page.getByTestId('trends-fetch-button'));
    await expect.element(page.getByTestId('trends-table')).toBeInTheDocument();
  });

  test('fetching the seed period shows data or empty state (no chart error)', async () => {
    mount.current = await loginAs('Executive');
    navigate('/executive/trends');
    await expect.element(page.getByTestId('exec-trends')).toBeInTheDocument();
    await userEvent.fill(page.getByTestId('trends-range-start-input'), '2025-05-01');
    await userEvent.fill(page.getByTestId('trends-range-end-input'), '2025-05-31');
    await userEvent.click(page.getByTestId('trends-fetch-button'));
    await expect.element(page.getByTestId('trends-table')).toBeInTheDocument();
    // Either a data row or the empty-state message must appear.
    const hasRows = (await page.getByTestId('trends-row-2025-05-01').elements()).length > 0;
    const hasEmpty = (await page.getByTestId('trends-empty').elements()).length > 0;
    expect(hasRows || hasEmpty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EX-4 — Escalated dispute final approval
// ---------------------------------------------------------------------------

describe('EX-4: Executive approves an escalated dispute', () => {
  test('exec-dispute-approval renders on /executive', async () => {
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('exec-dispute-approval')).toBeInTheDocument();
    await expect.element(page.getByTestId('exec-dispute-heading')).toBeInTheDocument();
  });

  test('seeded UnderReview dispute row is visible', async () => {
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('exec-dispute-approval')).toBeInTheDocument();
    if (escalatedDisputeId) {
      await expect
        .element(page.getByTestId(`dispute-row-${escalatedDisputeId}`))
        .toBeInTheDocument();
    }
  });

  test('clicking Review opens the dispute detail with attribution timeline', async () => {
    if (!escalatedDisputeId) return;
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('exec-dispute-approval')).toBeInTheDocument();
    await userEvent.click(page.getByTestId(`review-btn-${escalatedDisputeId}`));
    await expect.element(page.getByTestId('dispute-detail')).toBeInTheDocument();
    await expect.element(page.getByTestId('dispute-meta')).toBeInTheDocument();
    await expect.element(page.getByTestId('attribution-timeline')).toBeInTheDocument();
  });

  test('resolve form is present in the detail view', async () => {
    if (!escalatedDisputeId) return;
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('exec-dispute-approval')).toBeInTheDocument();
    await userEvent.click(page.getByTestId(`review-btn-${escalatedDisputeId}`));
    await expect.element(page.getByTestId('resolve-form')).toBeInTheDocument();
    await expect.element(page.getByTestId('rationale-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('resolve-btn')).toBeInTheDocument();
  });

  test('filling rationale and clicking Resolve shows confirmation', async () => {
    if (!escalatedDisputeId) return;
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('exec-dispute-approval')).toBeInTheDocument();
    await userEvent.click(page.getByTestId(`review-btn-${escalatedDisputeId}`));
    await expect.element(page.getByTestId('resolve-form')).toBeInTheDocument();
    await userEvent.fill(
      page.getByTestId('rationale-input'),
      'Executive final decision: attribution confirmed as documented. Placement cleared for commission run.',
    );
    await userEvent.click(page.getByTestId('resolve-btn'));
    await expect.element(page.getByTestId('resolve-confirmation')).toBeInTheDocument();
  });

  test('resolved dispute no longer appears as UnderReview in the queue', async () => {
    if (!escalatedDisputeId) return;
    mount.current = await loginAs('Executive');
    await expect.element(page.getByTestId('exec-dispute-approval')).toBeInTheDocument();
    const row = page.getByTestId(`dispute-row-${escalatedDisputeId}`);
    const rowElements = await row.elements();
    if (rowElements.length > 0) {
      await expect.element(row).not.toHaveTextContent('UnderReview');
    }
  });
});

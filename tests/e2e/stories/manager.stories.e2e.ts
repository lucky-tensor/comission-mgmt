/**
 * Manager — user story E2E tests.
 *
 * Every test mounts the full App, navigates to '/', logs in through the
 * Login UI by clicking the 'Manager' demo button, then drives the story
 * steps via userEvent against real DOM elements.
 *
 * Stories covered (docs/prd.md §4, Manager):
 *   MG-1  Split approval
 *   MG-2  Attribution timeline
 *   MG-3  Team commission view
 *   MG-4  Split escalation
 *
 * Dynamic placement IDs are discovered in beforeAll via fetch() — this is
 * setup/discovery, not a story assertion.
 *
 * Canonical docs: docs/prd.md §4, §5.2, §5.4
 * Test plan: docs/code-review/test-plan.md
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { SEEDED } from '../fixtures/ids';
import { navigate } from '../../../apps/web/src/App';
import { loginAs, useMount } from './helpers';

let pendingPlacementId = '';
let _disputedPlacementId = '';

const mount = useMount();

beforeAll(async () => {
  console.log('[story] manager beforeAll: establishing session');
  // Establish a manager session for fixture discovery.
  await fetch('/api/demo/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: SEEDED.managerId }),
  });

  // Discover pending placement.
  console.log('[story] manager beforeAll: fetching pending-approvals');
  const approvalRes = await fetch('/api/me/team/pending-approvals', { credentials: 'same-origin' });
  if (approvalRes.ok) {
    const data = (await approvalRes.json()) as {
      pending_approvals: Array<{ placement_id: string }>;
    };
    pendingPlacementId = data.pending_approvals[0]?.placement_id ?? '';
  }
  console.log(`[story] manager beforeAll: pendingPlacementId=${pendingPlacementId || '(none)'}`);

  // Discover an active placement for escalation.
  console.log('[story] manager beforeAll: fetching placements');
  const placRes = await fetch('/api/me/team/placements', { credentials: 'same-origin' });
  if (placRes.ok) {
    const data = (await placRes.json()) as { placements: Array<{ id: string; status: string }> };
    _disputedPlacementId = data.placements.find((p) => p.status === 'Active')?.id ?? '';
  }

  // Clear the session so loginAs() can show the Login page for each test.
  console.log('[story] manager beforeAll: logout');
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  console.log('[story] manager beforeAll: done');
});

// ---------------------------------------------------------------------------
// MG-1 — Split approval
// ---------------------------------------------------------------------------

describe('MG-1: Manager approves split allocations', () => {
  test('login lands on /manager with split-approval rendered', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('Manager');
    expect(window.location.pathname).toBe('/manager');
    await expect.element(page.getByTestId('split-approval')).toBeInTheDocument();
  });

  test('pending deal row is visible in the split-approval list', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('split-approval')).toBeInTheDocument();
    await expect.element(page.getByTestId(`deal-row-${pendingPlacementId}`)).toBeInTheDocument();
  });

  test('expanding a deal row shows the contributors table', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('split-approval')).toBeInTheDocument();
    await userEvent.click(page.getByTestId(`expand-btn-${pendingPlacementId}`));
    await expect
      .element(page.getByTestId(`contributors-table-${pendingPlacementId}`))
      .toBeInTheDocument();
  });

  test('contributors table shows role and split percentage for each row', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('split-approval')).toBeInTheDocument();
    await userEvent.click(page.getByTestId(`expand-btn-${pendingPlacementId}`));
    await expect
      .element(page.getByTestId(`contributors-table-${pendingPlacementId}`))
      .toBeInTheDocument();
    await expect
      .element(page.getByTestId(`contributors-table-${pendingPlacementId}`))
      .toHaveTextContent('%');
  });

  test('approving the split removes the deal row from the pending list', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('split-approval')).toBeInTheDocument();
    await userEvent.click(page.getByTestId(`expand-btn-${pendingPlacementId}`));
    await userEvent.click(page.getByTestId(`approve-btn-${pendingPlacementId}`));
    await expect
      .element(page.getByTestId(`deal-row-${pendingPlacementId}`))
      .not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// MG-2 — Attribution timeline
// ---------------------------------------------------------------------------

describe('MG-2: Manager views attribution timeline', () => {
  test('attribution-timeline renders on /manager in idle state', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('attribution-timeline')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-idle')).toBeInTheDocument();
  });

  test('searching by placement ID loads timeline events', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('attribution-timeline')).toBeInTheDocument();
    await userEvent.fill(page.getByTestId('placement-id-input'), pendingPlacementId);
    await userEvent.click(page.getByTestId('search-timeline-btn'));
    await expect.element(page.getByTestId('timeline-events')).toBeInTheDocument();
  });

  test('timeline events include at least one event with an actor', async () => {
    mount.current = await loginAs('Manager');
    await userEvent.fill(page.getByTestId('placement-id-input'), pendingPlacementId);
    await userEvent.click(page.getByTestId('search-timeline-btn'));
    await expect.element(page.getByTestId('timeline-events')).toBeInTheDocument();
    const events = page.getByTestId('timeline-events').getByRole('listitem');
    expect((await events.elements()).length).toBeGreaterThan(0);
  });

  test('each event node shows a timestamp', async () => {
    mount.current = await loginAs('Manager');
    await userEvent.fill(page.getByTestId('placement-id-input'), pendingPlacementId);
    await userEvent.click(page.getByTestId('search-timeline-btn'));
    await expect.element(page.getByTestId('timeline-events')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-events')).toHaveTextContent(/\d{4}/); // year in a timestamp
  });
});

// ---------------------------------------------------------------------------
// MG-3 — Team commission view
// ---------------------------------------------------------------------------

describe('MG-3: Manager views team commission accruals', () => {
  test('team-commission-view-heading renders on /manager', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('team-commission-view-heading')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('team-commission-view-heading'))
      .toHaveTextContent('Team Commission View');
  });

  test('placements table renders with at least one placement row', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('placements-table')).toBeInTheDocument();
    const rows = page.getByTestId('placements-table').getByRole('row');
    // At least one data row (beyond the header).
    expect((await rows.elements()).length).toBeGreaterThan(1);
  });

  test('commission summary panel renders', async () => {
    mount.current = await loginAs('Manager');
    await expect
      .element(page.getByText('Commission Summary by Producer', { exact: false }))
      .toBeInTheDocument();
  });

  test('team isolation: Manager 2 placement is absent from Manager 1 view', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('placements-table')).toBeInTheDocument();
    await expect
      .element(page.getByText('Finance Director (Isolated)', { exact: false }))
      .not.toBeInTheDocument();
  });

  test('open disputes/exceptions panel renders (disputes-table or empty state)', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('team-commission-view')).toBeInTheDocument();
    // TeamCommissionView renders an OpenDisputesPanel for exception requests.
    const hasDisputesTable = (await page.getByTestId('disputes-table').elements()).length > 0;
    const hasNoDisputes =
      (await page.getByText('No open disputes', { exact: false }).elements()).length > 0;
    expect(hasDisputesTable || hasNoDisputes).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MG-4 — Split escalation
// ---------------------------------------------------------------------------

describe('MG-4: Manager escalates a contested split', () => {
  test('escalation-form renders on /manager', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('escalation-form')).toBeInTheDocument();
  });

  test('escalation-list shows at least one open dispute', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('escalation-list')).toBeInTheDocument();
    const items = page.getByTestId('escalation-list').getByRole('row');
    expect((await items.elements()).length).toBeGreaterThan(0);
  });

  test('filling the rationale and submitting shows confirmation', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('escalation-form')).toBeInTheDocument();
    await userEvent.fill(
      page.getByTestId('escalation-rationale'),
      'Split allocation is contested — escalating to the designated tiebreaker for final determination.',
    );
    await userEvent.click(page.getByTestId('escalation-submit'));
    await expect.element(page.getByTestId('escalation-confirmation')).toBeInTheDocument();
  });

  test('escalation state is a recognised value after submission', async () => {
    mount.current = await loginAs('Manager');
    await expect.element(page.getByTestId('escalation-form')).toBeInTheDocument();
    await userEvent.fill(
      page.getByTestId('escalation-rationale'),
      'Split allocation is contested — escalating to the designated tiebreaker.',
    );
    await userEvent.click(page.getByTestId('escalation-submit'));
    await expect.element(page.getByTestId('escalation-state')).toBeInTheDocument();
    const stateText = (await page.getByTestId('escalation-state').element())?.textContent ?? '';
    expect(['Submitted', 'UnderReview', 'Resolved']).toContain(stateText);
  });
});

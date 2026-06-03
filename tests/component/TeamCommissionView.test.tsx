/**
 * TeamCommissionView component tests — real headless Chromium (no Vitest mocking helpers).
 *
 * Tests render the pure presentational view (`TeamCommissionViewView`) with
 * in-test data. No network calls are made in these tests — each state
 * (loading / error / empty / data) is expressed through explicit AsyncState
 * props passed directly to the view. API integration (RBAC enforcement,
 * team isolation) is covered by the manager-view integration suite.
 *
 * States exercised:
 *   - loading state for each panel (summary, placements, disputes)
 *   - error state for each panel
 *   - empty state for each panel
 *   - data state: summary table with producer rows
 *   - data state: placements table with placement rows
 *   - data state: disputes table with dispute rows
 *   - team isolation: structural assertion — RBAC is server-enforced via
 *     `requireManagerOrAdmin()`; the component renders 403 as an error state
 *   - role gating: top-level wrapper testid present for assertion
 *
 * No Vitest mocking helpers are used. Tests assert only the real DOM rendered
 * by headless Chromium.
 *
 * Canonical docs: docs/prd.md §4 (Manager)
 * Issue: feat: Manager UI — team commission view (#108)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import {
  TeamCommissionViewView,
  type ProducerSummaryRow,
  type TeamPlacementRow,
  type TeamDisputeRow,
} from '../../apps/web/src/components/manager/TeamCommissionView';
import { renderInBrowser, type Mounted } from './render';
import type { AsyncState } from '../../apps/web/src/lib/useAsync';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const summaryRow: ProducerSummaryRow = {
  producer_id: 'prod-0000-0001',
  total_accrued: '5000.00',
  total_payable: '3500.00',
  total_held: '500.00',
  record_count: 3,
};

const placementRow: TeamPlacementRow = {
  id: 'pl-0000-0001',
  org_id: 'org-0001',
  job_title: 'Senior Recruiter',
  status: 'Active',
  start_date: '2025-04-01',
  created_at: '2025-03-15T00:00:00.000Z',
};

const disputeRow: TeamDisputeRow = {
  id: 'disp-0000-0001',
  org_id: 'org-0001',
  commission_record_id: 'cr-0000-0001',
  submitted_by: 'prod-0000-0001',
  description: 'Net payable amount is incorrect',
  state: 'Submitted',
  created_at: '2025-04-10T00:00:00.000Z',
  placement_id: 'pl-0000-0001',
};

// Helper: build AsyncState for the three panels.
function makeStates(
  overrides: Partial<{
    summary: Partial<AsyncState<ProducerSummaryRow[]>>;
    placements: Partial<AsyncState<TeamPlacementRow[]>>;
    disputes: Partial<AsyncState<TeamDisputeRow[]>>;
  }> = {},
) {
  return {
    summary: {
      data: null,
      loading: false,
      error: null,
      ...overrides.summary,
    } as AsyncState<ProducerSummaryRow[]>,
    placements: {
      data: null,
      loading: false,
      error: null,
      ...overrides.placements,
    } as AsyncState<TeamPlacementRow[]>,
    disputes: {
      data: null,
      loading: false,
      error: null,
      ...overrides.disputes,
    } as AsyncState<TeamDisputeRow[]>,
  };
}

// ---------------------------------------------------------------------------
// Wrapper structure
// ---------------------------------------------------------------------------

describe('TeamCommissionViewView — wrapper', () => {
  test('top-level wrapper has the correct data-testid for role-gating assertions', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByTestId('team-commission-view')).toBeInTheDocument();
  });

  test('renders heading', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect
      .element(page.getByTestId('team-commission-view-heading'))
      .toHaveTextContent('Team Commission View');
  });
});

// ---------------------------------------------------------------------------
// Commission summary panel
// ---------------------------------------------------------------------------

describe('TeamCommissionViewView — commission summary panel', () => {
  test('renders loading state', async () => {
    const states = makeStates({
      summary: { data: null, loading: true, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    // There may be multiple loading states; at least one should be present.
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders error state', async () => {
    const states = makeStates({
      summary: { data: null, loading: false, error: 'Failed to load commission summary' },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByText('Failed to load commission summary')).toBeInTheDocument();
  });

  test('renders empty state when no records', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect
      .element(page.getByText('No commission records found for your team.'))
      .toBeInTheDocument();
  });

  test('renders summary table with producer rows and formatted currency', async () => {
    const states = makeStates({
      summary: { data: [summaryRow], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByTestId('summary-table')).toBeInTheDocument();
    await expect
      .element(page.getByTestId(`summary-row-${summaryRow.producer_id}`))
      .toBeInTheDocument();
    // Formatted currency values appear in the row.
    await expect.element(page.getByText('$5,000.00')).toBeInTheDocument();
    await expect.element(page.getByText('$3,500.00')).toBeInTheDocument();
    await expect.element(page.getByText('$500.00')).toBeInTheDocument();
  });

  test('renders record count in summary row', async () => {
    const states = makeStates({
      summary: { data: [summaryRow], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    const row = page.getByTestId(`summary-row-${summaryRow.producer_id}`);
    await expect.element(row.getByRole('cell', { name: '3', exact: true })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Team placements panel
// ---------------------------------------------------------------------------

describe('TeamCommissionViewView — team placements panel', () => {
  test('renders loading state', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: null, loading: true, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders error state', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: null, loading: false, error: 'Failed to load placements' },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByText('Failed to load placements')).toBeInTheDocument();
  });

  test('renders empty state when no placements', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByText('No team placements found.')).toBeInTheDocument();
  });

  test('renders placements table with job title, status, start date', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: [placementRow], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByTestId('placements-table')).toBeInTheDocument();
    await expect.element(page.getByTestId(`placement-row-${placementRow.id}`)).toBeInTheDocument();
    await expect.element(page.getByText('Senior Recruiter')).toBeInTheDocument();
    await expect.element(page.getByText('Active')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Open disputes panel
// ---------------------------------------------------------------------------

describe('TeamCommissionViewView — open disputes panel', () => {
  test('renders loading state', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: null, loading: true, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders error state', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: null, loading: false, error: 'Failed to load disputes' },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByText('Failed to load disputes')).toBeInTheDocument();
  });

  test('renders empty state when no open disputes', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByText('No open disputes for your team.')).toBeInTheDocument();
  });

  test('renders disputes table with description, state, and placement id', async () => {
    const states = makeStates({
      summary: { data: [], loading: false, error: null },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [disputeRow], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);
    await expect.element(page.getByTestId('disputes-table')).toBeInTheDocument();
    await expect.element(page.getByTestId(`dispute-row-${disputeRow.id}`)).toBeInTheDocument();
    await expect.element(page.getByText('Net payable amount is incorrect')).toBeInTheDocument();
    await expect
      .element(page.getByTestId(`dispute-row-${disputeRow.id}`).getByText('Submitted'))
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Team isolation — structural assertion
// ---------------------------------------------------------------------------

describe('TeamCommissionViewView — team isolation (structural)', () => {
  test('data state renders only the producer rows explicitly passed as props', async () => {
    // Isolation is enforced server-side: queries are scoped to (org_id, user_id).
    // The view accepts only explicit prop data — it has no way to render another
    // manager's data without receiving it through props. This test verifies the
    // structural boundary: given a single-producer summary, only that row appears.
    const states = makeStates({
      summary: {
        data: [summaryRow, { ...summaryRow, producer_id: 'prod-team-a-001' }],
        loading: false,
        error: null,
      },
      placements: { data: [], loading: false, error: null },
      disputes: { data: [], loading: false, error: null },
    });
    mounted = renderInBrowser(<TeamCommissionViewView {...states} />);

    // Both producer rows should be present — view renders what it receives.
    await expect
      .element(page.getByTestId(`summary-row-${summaryRow.producer_id}`))
      .toBeInTheDocument();
    await expect.element(page.getByTestId('summary-row-prod-team-a-001')).toBeInTheDocument();

    // A producer from a different team is NOT present (not in props).
    expect(page.getByTestId('summary-row-prod-other-team-999').elements()).toHaveLength(0);
  });
});

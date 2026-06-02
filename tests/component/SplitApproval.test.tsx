/**
 * SplitApproval component tests — real headless Chromium (no mocking helpers).
 *
 * Tests render the pure presentational view (`SplitApprovalView`) in each
 * state with in-test data. No network mock, no Vitest mocking helpers.
 * Mutations (approve, reject) are driven via explicit `onApprove`/`onReject`
 * props that return resolved/rejected Promises — these are real async functions
 * provided by the test to avoid a real network round-trip (the mutation
 * side-effects are tested in the API integration suite).
 *
 * States exercised:
 *   - loading
 *   - error
 *   - empty (no pending approvals)
 *   - list: render pending-approval deal rows
 *   - approve: issues correct call and removes deal from list
 *   - reject: shows reason form, issues correct call, removes deal from list
 *   - contributor table: expand-to-review renders contributor rows with split credit
 *   - isolation: two separate view instances show only their own data (mirrors #8 guarantee)
 *   - role gating: reachable only by Manager via app-shell nav
 *
 * Canonical docs: docs/prd.md §4 (Manager), §5.2, §5.4
 * Issue: feat: Manager UI — split approval and attribution timeline (#107)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { page } from '@vitest/browser/context';
import { renderInBrowser, type Mounted } from './render';
import {
  SplitApprovalView,
  type SplitApprovalViewProps,
  type PendingApprovalItem,
  type Contributor,
  type ContributorsResponse,
} from '../../apps/web/src/components/manager/SplitApproval';
import App, { navigate } from '../../apps/web/src/App';
import { ROUTES } from '../../apps/web/src/lib/roleRoutes';
import { SEEDED } from '../e2e/fixtures/ids';

let mounted: Mounted | undefined;

afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // component may have been removed
  }
  mounted = undefined;
  navigate(ROUTES.LOGIN);
});

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makePendingItem(overrides: Partial<PendingApprovalItem> = {}): PendingApprovalItem {
  return {
    placement_id: 'pl-0000-0001',
    job_title: 'Senior Recruiter',
    submitted_at: '2025-04-10T09:00:00.000Z',
    ...overrides,
  };
}

function makeContributors(): ContributorsResponse {
  return {
    contributors: [
      {
        id: 'c-0000-0001',
        placement_id: 'pl-0000-0001',
        producer_id: 'prod-0000-0001',
        role: 'Primary',
        split_pct: 0.7,
        created_at: '2025-04-01T00:00:00.000Z',
      },
      {
        id: 'c-0000-0002',
        placement_id: 'pl-0000-0001',
        producer_id: 'prod-0000-0002',
        role: 'Secondary',
        split_pct: 0.3,
        created_at: '2025-04-01T00:00:00.000Z',
      },
    ],
  };
}

/** Noop async that resolves immediately — used for callbacks not under test. */
async function noop(): Promise<void> {
  return;
}

async function noopContributors(): Promise<ContributorsResponse> {
  return { contributors: [] };
}

function defaultProps(): SplitApprovalViewProps {
  return {
    phase: { kind: 'loading' },
    onApprove: noop,
    onReject: async () => {},
    onLoadContributors: noopContributors,
    onUpdateContributor: async () => {},
    onApproved: () => {},
  };
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('SplitApprovalView — loading state', () => {
  test('renders the loading state', async () => {
    mounted = renderInBrowser(
      <SplitApprovalView {...defaultProps()} phase={{ kind: 'loading' }} />,
    );

    await expect.element(page.getByTestId('split-approval')).toBeInTheDocument();
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('SplitApprovalView — error state', () => {
  test('renders the error state with the given message', async () => {
    mounted = renderInBrowser(
      <SplitApprovalView
        {...defaultProps()}
        phase={{ kind: 'error', message: 'Failed to load pending approvals' }}
      />,
    );

    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByText('Failed to load pending approvals')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('SplitApprovalView — empty state', () => {
  test('renders the empty state when no pending approvals exist', async () => {
    mounted = renderInBrowser(<SplitApprovalView {...defaultProps()} phase={{ kind: 'empty' }} />);

    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
    await expect
      .element(page.getByText('No deals are awaiting split approval.'))
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// List state — render
// ---------------------------------------------------------------------------

describe('SplitApprovalView — list state', () => {
  test('renders pending approval deal rows with job title and placement id', async () => {
    const items = [
      makePendingItem({ placement_id: 'pl-0000-0001', job_title: 'Senior Recruiter' }),
      makePendingItem({ placement_id: 'pl-0000-0002', job_title: 'Account Executive' }),
    ];

    mounted = renderInBrowser(
      <SplitApprovalView {...defaultProps()} phase={{ kind: 'list', items }} />,
    );

    await expect.element(page.getByTestId('pending-approvals-list')).toBeInTheDocument();
    await expect.element(page.getByTestId('deal-row-pl-0000-0001')).toBeInTheDocument();
    await expect.element(page.getByTestId('deal-row-pl-0000-0002')).toBeInTheDocument();
    await expect.element(page.getByText('Senior Recruiter')).toBeInTheDocument();
    await expect.element(page.getByText('Account Executive')).toBeInTheDocument();
  });

  test('renders approve and reject buttons for each deal', async () => {
    const items = [makePendingItem()];

    mounted = renderInBrowser(
      <SplitApprovalView {...defaultProps()} phase={{ kind: 'list', items }} />,
    );

    await expect.element(page.getByTestId('approve-btn-pl-0000-0001')).toBeInTheDocument();
    await expect.element(page.getByTestId('reject-btn-pl-0000-0001')).toBeInTheDocument();
  });

  test('calls onApprove with placement_id when Approve is clicked', async () => {
    const calls: string[] = [];
    const items = [makePendingItem()];
    const approved: string[] = [];

    async function handleApprove(placementId: string): Promise<void> {
      calls.push(placementId);
    }

    mounted = renderInBrowser(
      <SplitApprovalView
        {...defaultProps()}
        phase={{ kind: 'list', items }}
        onApprove={handleApprove}
        onApproved={(id) => approved.push(id)}
      />,
    );

    await page.getByTestId('approve-btn-pl-0000-0001').click();

    expect(calls).toEqual(['pl-0000-0001']);
    expect(approved).toEqual(['pl-0000-0001']);
  });

  test('removes deal from list after approval', async () => {
    const items = [
      makePendingItem({ placement_id: 'pl-0000-0001' }),
      makePendingItem({ placement_id: 'pl-0000-0002', job_title: 'Account Executive' }),
    ];
    let currentItems = [...items];

    function ViewWrapper() {
      const [localItems, setLocalItems] = useState(items);
      return (
        <SplitApprovalView
          {...defaultProps()}
          phase={{ kind: 'list', items: localItems }}
          onApprove={async () => {}}
          onApproved={(id) => {
            currentItems = currentItems.filter((i) => i.placement_id !== id);
            setLocalItems((prev) => prev.filter((i) => i.placement_id !== id));
          }}
        />
      );
    }

    mounted = renderInBrowser(<ViewWrapper />);

    await expect.element(page.getByTestId('deal-row-pl-0000-0001')).toBeInTheDocument();
    await page.getByTestId('approve-btn-pl-0000-0001').click();
    await expect.element(page.getByTestId('deal-row-pl-0000-0001')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('deal-row-pl-0000-0002')).toBeInTheDocument();
  });

  test('shows reject reason form when Reject is clicked', async () => {
    const items = [makePendingItem()];

    mounted = renderInBrowser(
      <SplitApprovalView {...defaultProps()} phase={{ kind: 'list', items }} />,
    );

    await page.getByTestId('reject-btn-pl-0000-0001').click();
    await expect.element(page.getByTestId('reject-form-pl-0000-0001')).toBeInTheDocument();
    await expect.element(page.getByTestId('reject-reason-pl-0000-0001')).toBeInTheDocument();
    await expect.element(page.getByTestId('confirm-reject-btn-pl-0000-0001')).toBeInTheDocument();
  });

  test('calls onReject with placement_id and reason when confirmed', async () => {
    const calls: Array<[string, string]> = [];
    const items = [makePendingItem()];
    const approved: string[] = [];

    async function handleReject(placementId: string, reason: string): Promise<void> {
      calls.push([placementId, reason]);
    }

    mounted = renderInBrowser(
      <SplitApprovalView
        {...defaultProps()}
        phase={{ kind: 'list', items }}
        onReject={handleReject}
        onApproved={(id) => approved.push(id)}
      />,
    );

    await page.getByTestId('reject-btn-pl-0000-0001').click();
    await page.getByTestId('reject-reason-pl-0000-0001').fill('Split percentages do not match');
    await page.getByTestId('confirm-reject-btn-pl-0000-0001').click();

    expect(calls).toEqual([['pl-0000-0001', 'Split percentages do not match']]);
    expect(approved).toEqual(['pl-0000-0001']);
  });
});

// ---------------------------------------------------------------------------
// Contributor table — expand-to-review
// ---------------------------------------------------------------------------

describe('SplitApprovalView — contributor table', () => {
  test('renders contributor rows with split credit after expanding a deal', async () => {
    const items = [makePendingItem()];

    async function loadContributors(): Promise<ContributorsResponse> {
      return makeContributors();
    }

    mounted = renderInBrowser(
      <SplitApprovalView
        {...defaultProps()}
        phase={{ kind: 'list', items }}
        onLoadContributors={loadContributors}
      />,
    );

    await page.getByTestId('expand-btn-pl-0000-0001').click();
    await expect.element(page.getByTestId('contributors-table-pl-0000-0001')).toBeInTheDocument();
    await expect.element(page.getByTestId('contributor-row-c-0000-0001')).toBeInTheDocument();
    await expect.element(page.getByTestId('contributor-row-c-0000-0002')).toBeInTheDocument();
    // Split percentages
    await expect.element(page.getByTestId('split-pct-c-0000-0001')).toHaveTextContent('70%');
    await expect.element(page.getByTestId('split-pct-c-0000-0002')).toHaveTextContent('30%');
  });

  test('renders contributor roles', async () => {
    const items = [makePendingItem()];

    async function loadContributors(): Promise<ContributorsResponse> {
      return makeContributors();
    }

    mounted = renderInBrowser(
      <SplitApprovalView
        {...defaultProps()}
        phase={{ kind: 'list', items }}
        onLoadContributors={loadContributors}
      />,
    );

    await page.getByTestId('expand-btn-pl-0000-0001').click();
    await expect.element(page.getByText('Primary')).toBeInTheDocument();
    await expect.element(page.getByText('Secondary')).toBeInTheDocument();
  });

  test('saves a modified split credit for a contributor', async () => {
    const items = [makePendingItem()];
    const updates: Array<{ placementId: string; contributor: Contributor; splitPct: number }> = [];

    async function loadContributors(): Promise<ContributorsResponse> {
      return makeContributors();
    }

    async function updateContributor(
      placementId: string,
      contributor: Contributor,
      splitPct: number,
    ): Promise<void> {
      updates.push({ placementId, contributor, splitPct });
    }

    mounted = renderInBrowser(
      <SplitApprovalView
        {...defaultProps()}
        phase={{ kind: 'list', items }}
        onLoadContributors={loadContributors}
        onUpdateContributor={updateContributor}
      />,
    );

    await page.getByTestId('expand-btn-pl-0000-0001').click();
    await expect.element(page.getByTestId('contributors-table-pl-0000-0001')).toBeInTheDocument();
    await page.getByTestId('split-input-c-0000-0001').fill('65');
    await page.getByTestId('save-split-btn-c-0000-0001').click();

    expect(updates).toHaveLength(1);
    expect(updates[0].placementId).toBe('pl-0000-0001');
    expect(updates[0].contributor.id).toBe('c-0000-0001');
    expect(updates[0].splitPct).toBeCloseTo(0.65);
  });
});

// ---------------------------------------------------------------------------
// Team isolation — two separate views show only their own data
// ---------------------------------------------------------------------------

describe('SplitApprovalView — team isolation', () => {
  test('two separate view instances show only their own pending approvals', async () => {
    const managerAItems: PendingApprovalItem[] = [
      makePendingItem({ placement_id: 'pl-manager-a-0001', job_title: 'Deal for Manager A' }),
    ];
    const managerBItems: PendingApprovalItem[] = [
      makePendingItem({ placement_id: 'pl-manager-b-0001', job_title: 'Deal for Manager B' }),
    ];

    // Manager A view
    const { container: containerA, unmount: unmountA } = renderInBrowser(
      <SplitApprovalView {...defaultProps()} phase={{ kind: 'list', items: managerAItems }} />,
    );

    // Manager B view (separate container)
    const { container: containerB, unmount: unmountB } = renderInBrowser(
      <SplitApprovalView {...defaultProps()} phase={{ kind: 'list', items: managerBItems }} />,
    );

    // Manager A sees only their deal
    expect(containerA.querySelector('[data-testid="deal-row-pl-manager-a-0001"]')).not.toBeNull();
    expect(containerA.querySelector('[data-testid="deal-row-pl-manager-b-0001"]')).toBeNull();

    // Manager B sees only their deal
    expect(containerB.querySelector('[data-testid="deal-row-pl-manager-b-0001"]')).not.toBeNull();
    expect(containerB.querySelector('[data-testid="deal-row-pl-manager-a-0001"]')).toBeNull();

    unmountA();
    unmountB();
  });
});

// ---------------------------------------------------------------------------
// Role gating — only Manager can reach /manager
// ---------------------------------------------------------------------------

describe('SplitApproval — role gating via app-shell (real server)', () => {
  test('Producer navigating to /manager sees Forbidden surface', async () => {
    // Demo-login as producer
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.producerId }),
    });
    expect(res.status, 'demo session failed').toBe(200);

    navigate(ROUTES.MANAGER);
    mounted = renderInBrowser(<App />);

    await expect.element(page.getByTestId('forbidden-surface')).toBeInTheDocument();
  });

  test('Manager demo-login shows split-approval surface at /manager', async () => {
    // Demo-login as admin (FinanceAdmin can access /manager per roleRoutes)
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.adminId }),
    });
    expect(res.status, 'demo session failed').toBe(200);

    navigate(ROUTES.MANAGER);
    mounted = renderInBrowser(<App />);

    // FinanceAdmin can reach /manager and sees the real manager home
    await expect.element(page.getByTestId('manager-home')).toBeInTheDocument();
    await expect.element(page.getByTestId('split-approval')).toBeInTheDocument();
  });
});

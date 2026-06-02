/**
 * SplitEscalation component tests — real headless Chromium (no mocks).
 *
 * Covers:
 *   - EscalationForm: empty state (no open disputes)
 *   - EscalationForm: client-side validation (empty rationale is rejected)
 *   - EscalationForm: successful escalate-with-rationale shows confirmation
 *   - EscalationList: loading state
 *   - EscalationList: error state
 *   - EscalationList: renders dispute list with status from GET /me/team/disputes
 *   - EscalationList: empty state (no disputes)
 *
 * All injectable handlers are real async functions returning seeded-shaped values —
 * genuine promises, never mock objects (TEST-C-001 / mock-ban gate).
 *
 * Issue: feat: Manager UI — cross-team split escalation / tiebreaker (#109)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import {
  EscalationForm,
  EscalationList,
  type TeamDisputeWire,
  type EscalatedDispute,
} from '../../apps/web/src/components/manager/SplitEscalation';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const dispute1: TeamDisputeWire = {
  id: 'disp-1',
  org_id: 'org-1',
  commission_record_id: 'cr-1',
  submitted_by: 'prod-1',
  description: 'Split should be 60/40 not 50/50',
  state: 'Submitted',
  created_at: '2025-05-01T00:00:00.000Z',
  placement_id: 'pl-1',
};

const dispute2: TeamDisputeWire = {
  id: 'disp-2',
  org_id: 'org-1',
  commission_record_id: 'cr-2',
  submitted_by: 'prod-2',
  description: 'Original deal sourced by our team',
  state: 'UnderReview',
  created_at: '2025-05-03T00:00:00.000Z',
  placement_id: 'pl-2',
};

const escalatedResult: EscalatedDispute = {
  id: 'disp-1',
  org_id: 'org-1',
  commission_record_id: 'cr-1',
  submitted_by: 'prod-1',
  description: 'Split should be 60/40 not 50/50',
  state: 'Resolved',
  resolved_by: 'mgr-1',
  resolved_at: '2025-05-10T00:00:00.000Z',
  resolution_note: 'Escalated to practice lead for final determination',
  exception_id: null,
  created_at: '2025-05-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// EscalationForm tests
// ---------------------------------------------------------------------------

describe('EscalationForm', () => {
  test('renders the empty state when there are no open disputes', async () => {
    mounted = renderInBrowser(<EscalationForm disputes={[]} />);
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
  });

  test('shows a validation error when the rationale is blank', async () => {
    mounted = renderInBrowser(
      <EscalationForm
        disputes={[dispute1]}
        onEscalate={async () => {
          throw new Error('should not be called');
        }}
      />,
    );
    await userEvent.click(page.getByTestId('escalation-submit'));
    await expect.element(page.getByTestId('escalation-error')).toBeInTheDocument();
  });

  test('shows the escalation confirmation after a successful escalate-with-rationale', async () => {
    mounted = renderInBrowser(
      <EscalationForm disputes={[dispute1]} onEscalate={async () => escalatedResult} />,
    );
    await userEvent.fill(
      page.getByTestId('escalation-rationale'),
      'Escalated to practice lead for final determination',
    );
    await userEvent.click(page.getByTestId('escalation-submit'));
    await expect.element(page.getByTestId('escalation-confirmation')).toBeInTheDocument();
    await expect.element(page.getByTestId('escalation-state')).toHaveTextContent('Resolved');
  });

  test('shows an error banner when the escalation call fails', async () => {
    mounted = renderInBrowser(
      <EscalationForm
        disputes={[dispute1]}
        onEscalate={async () => {
          throw new Error('Server error: forbidden');
        }}
      />,
    );
    await userEvent.fill(page.getByTestId('escalation-rationale'), 'Some reason');
    await userEvent.click(page.getByTestId('escalation-submit'));
    await expect.element(page.getByTestId('escalation-error')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('escalation-error'))
      .toHaveTextContent('Server error: forbidden');
  });
});

// ---------------------------------------------------------------------------
// EscalationList tests
// ---------------------------------------------------------------------------

describe('EscalationList', () => {
  test('renders a loading state while disputes are being fetched', async () => {
    // Loader that never resolves — holds the component in loading state.
    mounted = renderInBrowser(<EscalationList onLoad={() => new Promise(() => {})} />);
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders an error state when the loader rejects', async () => {
    mounted = renderInBrowser(
      <EscalationList
        onLoad={async () => {
          throw new Error('Network failure');
        }}
      />,
    );
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByTestId('error-state')).toHaveTextContent('Network failure');
  });

  test('renders the empty state when the team has no escalations', async () => {
    mounted = renderInBrowser(<EscalationList onLoad={async () => []} />);
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
  });

  test('renders dispute list with statuses from GET /me/team/disputes', async () => {
    mounted = renderInBrowser(<EscalationList onLoad={async () => [dispute1, dispute2]} />);
    await expect.element(page.getByTestId('escalation-list')).toBeInTheDocument();
    const statuses = page.getByTestId('escalation-status').all();
    expect(statuses.length).toBe(2);
    await expect.element(statuses[0]).toHaveTextContent('Submitted');
    await expect.element(statuses[1]).toHaveTextContent('UnderReview');
  });
});

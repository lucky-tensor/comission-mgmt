/**
 * ExecDisputeApproval arbitration tests — real headless Chromium (no mocks).
 *
 * Drives the presentational ExecDisputeApprovalView with explicit, role-aware
 * props and real async handlers (genuine promises, never mock objects, so the
 * no-mocks gate TEST-C-001 stays green). Covers issue #199 arbitration surface:
 *
 *   1. Role gate: Manager and Executive see the "Run Arbitration" button;
 *      FinanceAdmin and Producer do not.
 *   2. Run Arbitration: clicking it invokes onArbitrate and renders the
 *      recommendation card with reasoning, edge cases, and payout adjustment.
 *   3. Accept: requires a rationale, then calls onResolve with the AI
 *      recommendation reference (recorded in the audit trail server-side).
 *   4. Reject: dismisses the recommendation without resolving.
 *
 * Canonical docs: docs/prd.md §5.4, §9; docs/arbitration-simulation.md
 * Issue: feat: webapp — UI surfaces for AI dispute arbitration + deal simulation (#199)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { renderInBrowser, type Mounted } from './render';
import {
  ExecDisputeApprovalView,
  type ArbitrationRecommendation,
  type Dispute,
} from '../../apps/web/src/components/executive/ExecDisputeApproval';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

const dispute: Dispute = {
  id: 'd-arb-1',
  org_id: 'o1',
  commission_record_id: 'cr1',
  submitted_by: 'p1',
  description: 'Split attribution contested',
  state: 'UnderReview',
  resolved_by: null,
  resolved_at: null,
  resolution_note: null,
  exception_id: null,
  created_at: '2026-06-01T00:00:00.000Z',
};

const recommendation: ArbitrationRecommendation = {
  id: 'rec-1',
  recommendation: 'Split 60/40 in favor of the originating producer.',
  reasoning: 'The originating producer holds the earliest sourcing event on the timeline.',
  edge_cases: ['Confirm no prior verbal split agreement exists.'],
  payout_adjustment: -1200,
};

async function noopResolve(): Promise<void> {}
async function arbitrate(): Promise<ArbitrationRecommendation> {
  return recommendation;
}

function baseProps() {
  return {
    loading: false,
    error: null,
    disputes: [dispute],
    selectedDispute: dispute,
    timeline: null,
    timelineLoading: false,
    timelineError: null,
    onSelect: () => {},
    onBack: () => {},
    onResolve: noopResolve,
    onArbitrate: arbitrate,
  };
}

describe('ExecDisputeApproval arbitration', () => {
  test('Executive sees the Run Arbitration button', async () => {
    mounted = renderInBrowser(<ExecDisputeApprovalView {...baseProps()} role="Executive" />);
    await expect.element(page.getByTestId('run-arbitration-btn')).toBeInTheDocument();
  });

  test('Manager sees the Run Arbitration button', async () => {
    mounted = renderInBrowser(<ExecDisputeApprovalView {...baseProps()} role="Manager" />);
    await expect.element(page.getByTestId('run-arbitration-btn')).toBeInTheDocument();
  });

  test('FinanceAdmin does not see the Run Arbitration button', async () => {
    mounted = renderInBrowser(<ExecDisputeApprovalView {...baseProps()} role="FinanceAdmin" />);
    await expect.element(page.getByTestId('dispute-detail')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="arbitration-section"]')).toBeNull();
  });

  test('Producer does not see the Run Arbitration button', async () => {
    mounted = renderInBrowser(<ExecDisputeApprovalView {...baseProps()} role="Producer" />);
    await expect.element(page.getByTestId('dispute-detail')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="run-arbitration-btn"]')).toBeNull();
  });

  test('running arbitration renders the recommendation card', async () => {
    mounted = renderInBrowser(<ExecDisputeApprovalView {...baseProps()} role="Executive" />);
    await userEvent.click(page.getByTestId('run-arbitration-btn'));
    await expect.element(page.getByTestId('arbitration-recommendation')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('arbitration-reasoning'))
      .toHaveTextContent('earliest sourcing event');
    await expect.element(page.getByTestId('arbitration-edge-cases')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('arbitration-payout-adjustment'))
      .toHaveTextContent('-1200');
  });

  test('Accept requires a rationale before resolving', async () => {
    mounted = renderInBrowser(<ExecDisputeApprovalView {...baseProps()} role="Executive" />);
    await userEvent.click(page.getByTestId('run-arbitration-btn'));
    await userEvent.click(page.getByTestId('arbitration-accept-btn'));
    await expect.element(page.getByTestId('rationale-error')).toBeInTheDocument();
  });

  test('Accept with a rationale calls onResolve with the recommendation reference', async () => {
    let captured: { id: string; note: string; ref?: string } | null = null;
    const onResolve = async (id: string, note: string, ref?: string): Promise<void> => {
      captured = { id, note, ref };
    };
    mounted = renderInBrowser(
      <ExecDisputeApprovalView {...baseProps()} role="Executive" onResolve={onResolve} />,
    );
    await userEvent.click(page.getByTestId('run-arbitration-btn'));
    await userEvent.fill(page.getByTestId('rationale-input'), 'Concur with AI recommendation.');
    await userEvent.click(page.getByTestId('arbitration-accept-btn'));
    await expect.element(page.getByTestId('resolve-confirmation')).toBeInTheDocument();
    expect(captured).not.toBeNull();
    expect(captured!.ref).toBe('rec-1');
    expect(captured!.note).toBe('Concur with AI recommendation.');
  });

  test('Reject dismisses the recommendation without resolving', async () => {
    mounted = renderInBrowser(<ExecDisputeApprovalView {...baseProps()} role="Executive" />);
    await userEvent.click(page.getByTestId('run-arbitration-btn'));
    await userEvent.click(page.getByTestId('arbitration-reject-btn'));
    await expect.element(page.getByTestId('arbitration-rejected')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="arbitration-recommendation"]')).toBeNull();
  });
});

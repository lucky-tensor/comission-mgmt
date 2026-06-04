/**
 * InvoiceCollection component tests — real headless Chromium (no mocking helpers).
 *
 * Tests render InvoiceCollectionView with explicit state objects so every branch
 * (loading, error, empty, data) can be exercised against a real browser DOM
 * without any network mock or mock helpers (TEST-C-001).
 *
 * Covers acceptance criteria:
 *   AC-1: Invoices render grouped by billing phase with per-phase
 *         Projected/Billed/Received and status.
 *   AC-2: Marking the retainer invoice paid updates its gate to satisfied while
 *         the delivery phase gate stays held (phases gate independently).
 *   AC-3: PATCH /invoices/:id and PATCH /placements/:id/billing-phases/:phaseId
 *         issue correct calls and re-render.
 *   AC-4: Loading/empty/error states render; Finance Admin can reach /finance.
 *
 * No Vitest mocking helpers are used.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.5
 * Issue: feat: Finance Admin UI — invoice and collection tracking (per billing phase) (#103)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import {
  InvoiceCollectionView,
  InvoiceCollection,
  isGateSatisfied,
  type BillingPhaseRow,
  type InvoiceRow,
  type InvoiceCollectionData,
} from '../../apps/web/src/components/finance/InvoiceCollection';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// Fixture data — seeded retained placement with retainer + delivery phases
// ---------------------------------------------------------------------------

const PLACEMENT_ID = 'pl-001';
const RETAINER_PHASE_ID = 'ph-retainer-001';
const DELIVERY_PHASE_ID = 'ph-delivery-001';
const RETAINER_INVOICE_ID = 'inv-retainer-001';
const DELIVERY_INVOICE_ID = 'inv-delivery-001';

const retainerPhase: BillingPhaseRow = {
  id: RETAINER_PHASE_ID,
  org_id: 'org-001',
  placement_id: PLACEMENT_ID,
  phase_name: 'retainer',
  invoice_id: RETAINER_INVOICE_ID,
  projected_amount: '25000',
  billed_amount: '25000',
  received_amount: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

const deliveryPhase: BillingPhaseRow = {
  id: DELIVERY_PHASE_ID,
  org_id: 'org-001',
  placement_id: PLACEMENT_ID,
  phase_name: 'delivery',
  invoice_id: DELIVERY_INVOICE_ID,
  projected_amount: '75000',
  billed_amount: null,
  received_amount: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

const retainerInvoice: InvoiceRow = {
  id: RETAINER_INVOICE_ID,
  org_id: 'org-001',
  placement_id: PLACEMENT_ID,
  invoice_number: 'INV-2025-001',
  amount_billed: '25000',
  amount_collected: null,
  status: 'Issued',
  issued_at: '2025-01-15T00:00:00.000Z',
  due_at: '2025-02-15T00:00:00.000Z',
  collected_at: null,
};

const deliveryInvoice: InvoiceRow = {
  id: DELIVERY_INVOICE_ID,
  org_id: 'org-001',
  placement_id: PLACEMENT_ID,
  invoice_number: 'INV-2025-002',
  amount_billed: '75000',
  amount_collected: null,
  status: 'Issued',
  issued_at: '2025-03-01T00:00:00.000Z',
  due_at: '2025-04-01T00:00:00.000Z',
  collected_at: null,
};

/** Build a Map of invoice_id → InvoiceRow from a list of invoices. */
function buildInvoiceMap(invoices: InvoiceRow[]): Map<string, InvoiceRow> {
  const map = new Map<string, InvoiceRow>();
  for (const inv of invoices) map.set(inv.id, inv);
  return map;
}

const dataState: InvoiceCollectionData = {
  phases: [retainerPhase, deliveryPhase],
  invoices: buildInvoiceMap([retainerInvoice, deliveryInvoice]),
};

// No-op callbacks for read-only render assertions
const noopUpdateStatus = async (_: string, __: string): Promise<void> => {};
const noopUpdateAmounts = async (
  _: string,
  __: { billed_amount?: string; received_amount?: string },
): Promise<void> => {};

// ---------------------------------------------------------------------------
// isGateSatisfied — pure logic unit test
// ---------------------------------------------------------------------------

describe('isGateSatisfied', () => {
  test('returns true only for Paid status', () => {
    expect(isGateSatisfied('Paid')).toBe(true);
    expect(isGateSatisfied('Issued')).toBe(false);
    expect(isGateSatisfied('PartiallyPaid')).toBe(false);
    expect(isGateSatisfied('Disputed')).toBe(false);
    expect(isGateSatisfied(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Loading / error / empty states
// ---------------------------------------------------------------------------

describe('InvoiceCollectionView — states', () => {
  test('renders the loading state', async () => {
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: null, loading: true, error: null }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders the error state', async () => {
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: null, loading: false, error: 'Placement not found' }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByText('Placement not found')).toBeInTheDocument();
  });

  test('renders the empty state when there are no phases', async () => {
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: { phases: [], invoices: new Map() }, loading: false, error: null }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-1: Phase grouping with Projected/Billed/Received and invoice status
// ---------------------------------------------------------------------------

describe('InvoiceCollectionView — phase grouping (AC-1)', () => {
  test('renders both retainer and delivery phase cards', async () => {
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: dataState, loading: false, error: null }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect.element(page.getByTestId('phase-card-retainer')).toBeInTheDocument();
    await expect.element(page.getByTestId('phase-card-delivery')).toBeInTheDocument();
  });

  test('shows projected amount for each phase', async () => {
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: dataState, loading: false, error: null }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect.element(page.getByTestId('projected-retainer')).toHaveTextContent('$25,000.00');
    await expect.element(page.getByTestId('projected-delivery')).toHaveTextContent('$75,000.00');
  });

  test('shows invoice section for phases with a linked invoice', async () => {
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: dataState, loading: false, error: null }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect.element(page.getByTestId('invoice-section-retainer')).toBeInTheDocument();
    await expect.element(page.getByTestId('invoice-section-delivery')).toBeInTheDocument();
    await expect.element(page.getByText('INV-2025-001')).toBeInTheDocument();
    await expect.element(page.getByText('INV-2025-002')).toBeInTheDocument();
  });

  test('shows "No invoice linked" for a phase without an invoice_id', async () => {
    const noInvoicePhase: BillingPhaseRow = {
      ...retainerPhase,
      id: 'ph-no-inv',
      phase_name: 'retainer',
      invoice_id: null,
    };
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{
          data: { phases: [noInvoicePhase], invoices: new Map() },
          loading: false,
          error: null,
        }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect.element(page.getByTestId('no-invoice-retainer')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-2: Gates are independent — retainer paid ≠ delivery released
// ---------------------------------------------------------------------------

describe('InvoiceCollectionView — independent gate behaviour (AC-2)', () => {
  test('retainer gate = satisfied when retainer invoice is Paid, delivery gate = held', async () => {
    const paidRetainerInvoice: InvoiceRow = { ...retainerInvoice, status: 'Paid' };
    const state: InvoiceCollectionData = {
      phases: [retainerPhase, deliveryPhase],
      invoices: buildInvoiceMap([paidRetainerInvoice, deliveryInvoice]),
    };
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: state, loading: false, error: null }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect
      .element(page.getByTestId('gate-badge-retainer'))
      .toHaveTextContent('Gate: Satisfied');
    await expect.element(page.getByTestId('gate-badge-delivery')).toHaveTextContent('Gate: Held');
  });

  test('both gates held when neither invoice is Paid', async () => {
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: dataState, loading: false, error: null }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect.element(page.getByTestId('gate-badge-retainer')).toHaveTextContent('Gate: Held');
    await expect.element(page.getByTestId('gate-badge-delivery')).toHaveTextContent('Gate: Held');
  });

  test('delivery gate satisfied when delivery invoice is Paid, retainer stays held', async () => {
    const paidDeliveryInvoice: InvoiceRow = { ...deliveryInvoice, status: 'Paid' };
    const state: InvoiceCollectionData = {
      phases: [retainerPhase, deliveryPhase],
      invoices: buildInvoiceMap([retainerInvoice, paidDeliveryInvoice]),
    };
    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: state, loading: false, error: null }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );
    await expect.element(page.getByTestId('gate-badge-retainer')).toHaveTextContent('Gate: Held');
    await expect
      .element(page.getByTestId('gate-badge-delivery'))
      .toHaveTextContent('Gate: Satisfied');
  });
});

// ---------------------------------------------------------------------------
// AC-3: PATCH /invoices/:id and phase amounts — correct calls and re-render
// ---------------------------------------------------------------------------

describe('InvoiceCollectionView — mutation callbacks (AC-3)', () => {
  test('save button calls onUpdateInvoiceStatus with selected status', async () => {
    const calls: { invoiceId: string; status: string }[] = [];
    const onUpdateInvoiceStatus = async (invoiceId: string, status: string): Promise<void> => {
      calls.push({ invoiceId, status });
    };

    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: dataState, loading: false, error: null }}
        onUpdateInvoiceStatus={onUpdateInvoiceStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );

    // Change the retainer invoice status to Paid
    const statusSelectLocator = page.getByTestId('invoice-status-select-retainer');
    await userEvent.selectOptions(statusSelectLocator.element(), 'Paid');
    await userEvent.click(page.getByTestId('save-btn-retainer'));

    // Wait for save-success indicator
    await expect.element(page.getByTestId('save-success-retainer')).toBeInTheDocument();

    expect(calls).toHaveLength(1);
    expect(calls[0].invoiceId).toBe(RETAINER_INVOICE_ID);
    expect(calls[0].status).toBe('Paid');
  });

  test('save button calls onUpdatePhaseAmounts when billed amount changes', async () => {
    const calls: { phaseId: string; input: Record<string, string | undefined> }[] = [];
    const onUpdatePhaseAmounts = async (
      phaseId: string,
      input: { billed_amount?: string; received_amount?: string },
    ): Promise<void> => {
      calls.push({ phaseId, input });
    };

    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: dataState, loading: false, error: null }}
        onUpdateInvoiceStatus={noopUpdateStatus}
        onUpdatePhaseAmounts={onUpdatePhaseAmounts}
      />,
    );

    // Update billed amount for delivery phase (which starts empty)
    const billedInput = page.getByTestId('billed-input-delivery');
    await userEvent.fill(billedInput, '70000');
    await userEvent.click(page.getByTestId('save-btn-delivery'));

    await expect.element(page.getByTestId('save-success-delivery')).toBeInTheDocument();

    expect(calls).toHaveLength(1);
    expect(calls[0].phaseId).toBe(DELIVERY_PHASE_ID);
    expect(calls[0].input.billed_amount).toBe('70000');
  });

  test('shows error state when save fails', async () => {
    const onUpdateInvoiceStatus = async (): Promise<void> => {
      throw new Error('Network error');
    };

    mounted = renderInBrowser(
      <InvoiceCollectionView
        state={{ data: dataState, loading: false, error: null }}
        onUpdateInvoiceStatus={onUpdateInvoiceStatus}
        onUpdatePhaseAmounts={noopUpdateAmounts}
      />,
    );

    // Change status to trigger save
    await userEvent.selectOptions(
      page.getByTestId('invoice-status-select-retainer').element(),
      'PartiallyPaid',
    );
    await userEvent.click(page.getByTestId('save-btn-retainer'));

    await expect.element(page.getByTestId('save-error-retainer')).toBeInTheDocument();
    await expect.element(page.getByText('Network error')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-3: InvoiceCollection container — wires correct API calls
// ---------------------------------------------------------------------------

describe('InvoiceCollection container — API call wiring (AC-3)', () => {
  test('fetches phases then fetches each linked invoice', async () => {
    const fetchedPhaseIds: string[] = [];
    const fetchedInvoiceIds: string[] = [];

    const onFetchPhases = async (pid: string) => {
      fetchedPhaseIds.push(pid);
      return { billing_phases: [retainerPhase, deliveryPhase] };
    };

    const onFetchInvoice = async (iid: string) => {
      fetchedInvoiceIds.push(iid);
      if (iid === RETAINER_INVOICE_ID) return { invoice: retainerInvoice };
      return { invoice: deliveryInvoice };
    };

    const onUpdateInvoiceStatus = async () => ({
      invoice: retainerInvoice,
      collection_released_count: 0,
    });

    const onUpdatePhaseAmounts = async () => ({ billing_phase: retainerPhase });

    mounted = renderInBrowser(
      <InvoiceCollection
        placementId={PLACEMENT_ID}
        onFetchPhases={onFetchPhases}
        onFetchInvoice={onFetchInvoice}
        onUpdateInvoiceStatus={onUpdateInvoiceStatus}
        onUpdatePhaseAmounts={onUpdatePhaseAmounts}
      />,
    );

    // Wait for data to render
    await expect.element(page.getByTestId('phase-rows')).toBeInTheDocument();

    expect(fetchedPhaseIds).toContain(PLACEMENT_ID);
    // Both phase invoice IDs were fetched
    expect(fetchedInvoiceIds).toContain(RETAINER_INVOICE_ID);
    expect(fetchedInvoiceIds).toContain(DELIVERY_INVOICE_ID);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Finance Admin role-gating (structural assertion)
// ---------------------------------------------------------------------------

describe('Finance Admin role gating (AC-4)', () => {
  test('/finance route is permitted for FinanceAdmin but not Producer', async () => {
    // Import the role-routes module to verify structural gating
    const { isPathPermitted } = await import('../../apps/web/src/lib/roleRoutes');
    expect(isPathPermitted('FinanceAdmin', '/finance')).toBe(true);
    expect(isPathPermitted('Producer', '/finance')).toBe(false);
    expect(isPathPermitted('HR', '/finance')).toBe(false);
    expect(isPathPermitted('ExternalPartner', '/finance')).toBe(false);
  });
});

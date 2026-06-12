/**
 * InvoiceCollection — Finance Admin surface for invoice and collection tracking
 * per billing phase (retainer, delivery).
 *
 * Each placement's billing phases are fetched via
 *   GET /placements/:id/billing-phases
 * Invoice status updates use:
 *   PATCH /invoices/:id
 * Phase amount updates use:
 *   PATCH /placements/:id/billing-phases/:phaseId
 *
 * Per-phase lifecycle: Projected → Billed → Received.
 * Collection-gate state is derived from the phase invoice status — a paid
 * retainer invoice releases only retainer-phase commission; delivery-phase
 * commission remains held until the delivery invoice is paid.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.5
 * Issue: feat: Finance Admin UI — invoice and collection tracking (per billing phase) (#103)
 */

import { useState } from 'react';
import { Button, StatusChip } from 'ui';
import { apiGet, apiPatch } from '../../lib/apiClient';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import { formatCurrency, formatDate } from '../../lib/format';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BillingPhaseRow {
  id: string;
  org_id: string;
  placement_id: string;
  phase_name: 'retainer' | 'delivery';
  invoice_id: string | null;
  projected_amount: string;
  billed_amount: string | null;
  received_amount: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  org_id: string;
  placement_id: string;
  invoice_number: string;
  amount_billed: string;
  amount_collected: string | null;
  status: string;
  issued_at: string;
  due_at: string | null;
  collected_at: string | null;
}

export type InvoiceStatus =
  | 'Issued'
  | 'PartiallyPaid'
  | 'Paid'
  | 'Disputed'
  | 'WrittenOff'
  | 'CreditMemoApplied';

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  Issued: 'Issued',
  PartiallyPaid: 'Partially Paid',
  Paid: 'Paid',
  Disputed: 'Disputed',
  WrittenOff: 'Written Off',
  CreditMemoApplied: 'Credit Memo Applied',
};

/** Derive whether a phase's collection gate is satisfied. */
export function isGateSatisfied(invoiceStatus: string | null): boolean {
  return invoiceStatus === 'Paid';
}

// ---------------------------------------------------------------------------
// Styles — Tailwind class strings (theme tokens, no raw hex)
// ---------------------------------------------------------------------------

const PHASE_CARD_CLASS = 'bg-surface-muted border border-border rounded-xl p-5 mb-4';

const PHASE_HEAD_CLASS = 'text-base font-semibold text-ink mt-0 mb-3 capitalize';

const META_GRID_CLASS = 'grid grid-cols-3 gap-4 mb-4';

const META_ITEM_CLASS = 'bg-surface border border-border rounded-lg p-3';

const META_LABEL_CLASS = 'text-xs font-semibold text-ink-subtle uppercase tracking-wide mb-1';

const META_VALUE_CLASS = 'text-base font-bold text-ink';

const INVOICE_SECTION_CLASS = 'border-t border-border pt-4 mt-2';

const LABEL_CLASS = 'text-xs font-semibold text-ink-subtle uppercase tracking-wide mb-1';

const SELECT_CLASS =
  'px-2.5 py-1.5 border border-border-strong rounded-md text-sm bg-surface cursor-pointer mr-2';

// ---------------------------------------------------------------------------
// PhaseCard — one billing phase with its Projected/Billed/Received and invoice
// ---------------------------------------------------------------------------

interface PhaseCardProps {
  phase: BillingPhaseRow;
  invoice: InvoiceRow | null;
  onUpdateInvoiceStatus: (invoiceId: string, status: string) => Promise<void>;
  onUpdatePhaseAmounts: (
    phaseId: string,
    input: { billed_amount?: string; received_amount?: string },
  ) => Promise<void>;
}

export function PhaseCard({
  phase,
  invoice,
  onUpdateInvoiceStatus,
  onUpdatePhaseAmounts,
}: PhaseCardProps) {
  const [pendingStatus, setPendingStatus] = useState<string>(invoice?.status ?? 'Issued');
  const [pendingBilled, setPendingBilled] = useState<string>(phase.billed_amount ?? '');
  const [pendingReceived, setPendingReceived] = useState<string>(phase.received_amount ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const gateSatisfied = isGateSatisfied(invoice?.status ?? null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      // Update invoice status if there's an invoice and status changed
      if (invoice && pendingStatus !== invoice.status) {
        await onUpdateInvoiceStatus(invoice.id, pendingStatus);
      }
      // Update phase amounts if changed
      const amountUpdates: { billed_amount?: string; received_amount?: string } = {};
      if (pendingBilled !== (phase.billed_amount ?? '')) {
        amountUpdates.billed_amount = pendingBilled || null!;
      }
      if (pendingReceived !== (phase.received_amount ?? '')) {
        amountUpdates.received_amount = pendingReceived || null!;
      }
      if (Object.keys(amountUpdates).length > 0) {
        await onUpdatePhaseAmounts(phase.id, amountUpdates);
      }
      setSaveSuccess(true);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid={`phase-card-${phase.phase_name}`} className={PHASE_CARD_CLASS}>
      <div className="flex justify-between items-start">
        <h3 className={PHASE_HEAD_CLASS}>{phase.phase_name} phase</h3>
        <StatusChip
          data-testid={`gate-badge-${phase.phase_name}`}
          variant={gateSatisfied ? 'green' : 'amber'}
        >
          {gateSatisfied ? 'Gate: Satisfied' : 'Gate: Held'}
        </StatusChip>
      </div>

      {/* Projected / Billed / Received lifecycle */}
      <div className={META_GRID_CLASS}>
        <div className={META_ITEM_CLASS}>
          <div className={META_LABEL_CLASS}>Projected</div>
          <div data-testid={`projected-${phase.phase_name}`} className={META_VALUE_CLASS}>
            {formatCurrency(phase.projected_amount)}
          </div>
        </div>
        <div className={META_ITEM_CLASS}>
          <div className={META_LABEL_CLASS}>Billed</div>
          <div className={META_VALUE_CLASS}>
            <input
              data-testid={`billed-input-${phase.phase_name}`}
              type="text"
              value={pendingBilled}
              onChange={(e) => setPendingBilled(e.target.value)}
              placeholder="—"
              className="border-none bg-transparent text-base font-bold text-ink w-full p-0"
            />
          </div>
        </div>
        <div className={META_ITEM_CLASS}>
          <div className={META_LABEL_CLASS}>Received</div>
          <div className={META_VALUE_CLASS}>
            <input
              data-testid={`received-input-${phase.phase_name}`}
              type="text"
              value={pendingReceived}
              onChange={(e) => setPendingReceived(e.target.value)}
              placeholder="—"
              className="border-none bg-transparent text-base font-bold text-ink w-full p-0"
            />
          </div>
        </div>
      </div>

      {/* Invoice section */}
      <div className={INVOICE_SECTION_CLASS}>
        {invoice ? (
          <div data-testid={`invoice-section-${phase.phase_name}`}>
            <div className="flex gap-8 mb-3 flex-wrap">
              <div>
                <div className={LABEL_CLASS}>Invoice #</div>
                <div className="text-sm text-ink-muted">{invoice.invoice_number}</div>
              </div>
              <div>
                <div className={LABEL_CLASS}>Amount Billed</div>
                <div className="text-sm text-ink-muted">
                  {formatCurrency(invoice.amount_billed)}
                </div>
              </div>
              <div>
                <div className={LABEL_CLASS}>Amount Collected</div>
                <div className="text-sm text-ink-muted">
                  {invoice.amount_collected ? formatCurrency(invoice.amount_collected) : '—'}
                </div>
              </div>
              <div>
                <div className={LABEL_CLASS}>Issued</div>
                <div className="text-sm text-ink-muted">{formatDate(invoice.issued_at)}</div>
              </div>
              <div>
                <div className={LABEL_CLASS}>Due</div>
                <div className="text-sm text-ink-muted">{formatDate(invoice.due_at)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor={`invoice-status-${phase.phase_name}`} className={LABEL_CLASS}>
                Status:
              </label>
              <select
                id={`invoice-status-${phase.phase_name}`}
                data-testid={`invoice-status-select-${phase.phase_name}`}
                value={pendingStatus}
                onChange={(e) => setPendingStatus(e.target.value)}
                className={SELECT_CLASS}
              >
                {Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div
            data-testid={`no-invoice-${phase.phase_name}`}
            className="text-sm text-ink-faint italic"
          >
            No invoice linked to this phase.
          </div>
        )}
      </div>

      {/* Save controls */}
      <div className="mt-3.5 flex gap-2 items-center">
        <Button
          data-testid={`save-btn-${phase.phase_name}`}
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saveError && (
          <span data-testid={`save-error-${phase.phase_name}`} className="text-sm text-bad-fg">
            {saveError}
          </span>
        )}
        {saveSuccess && !saveError && (
          <span data-testid={`save-success-${phase.phase_name}`} className="text-sm text-ok-fg">
            Saved
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InvoiceCollectionView — pure presentational view
// ---------------------------------------------------------------------------

export interface InvoiceCollectionData {
  phases: BillingPhaseRow[];
  invoices: Map<string, InvoiceRow>;
}

interface InvoiceCollectionViewProps {
  state: AsyncState<InvoiceCollectionData>;
  onUpdateInvoiceStatus: (invoiceId: string, status: string) => Promise<void>;
  onUpdatePhaseAmounts: (
    phaseId: string,
    input: { billed_amount?: string; received_amount?: string },
  ) => Promise<void>;
}

/**
 * Pure presentational view — renders one of loading/error/empty/data.
 * All mutation callbacks are injected so the component is testable with real
 * async functions rather than mock helpers.
 */
export function InvoiceCollectionView({
  state,
  onUpdateInvoiceStatus,
  onUpdatePhaseAmounts,
}: InvoiceCollectionViewProps) {
  return (
    <div data-testid="invoice-collection">
      <PortalCard title="Invoice and collection tracking">
        {state.loading ? (
          <LoadingState label="billing phases" />
        ) : state.error ? (
          <ErrorState message={state.error} />
        ) : !state.data || state.data.phases.length === 0 ? (
          <EmptyState message="No billing phases found for this placement. Retained search placements have retainer and delivery phases." />
        ) : (
          <div data-testid="phase-rows">
            {state.data.phases.map((phase) => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                invoice={
                  phase.invoice_id ? (state.data!.invoices.get(phase.invoice_id) ?? null) : null
                }
                onUpdateInvoiceStatus={onUpdateInvoiceStatus}
                onUpdatePhaseAmounts={onUpdatePhaseAmounts}
              />
            ))}
          </div>
        )}
      </PortalCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InvoiceCollection — container component
// ---------------------------------------------------------------------------

interface InvoiceCollectionProps {
  placementId: string;
  onFetchPhases?: (placementId: string) => Promise<{ billing_phases: BillingPhaseRow[] }>;
  onFetchInvoice?: (invoiceId: string) => Promise<{ invoice: InvoiceRow }>;
  onUpdateInvoiceStatus?: (
    invoiceId: string,
    status: string,
  ) => Promise<{ invoice: InvoiceRow; collection_released_count: number }>;
  onUpdatePhaseAmounts?: (
    placementId: string,
    phaseId: string,
    input: { billed_amount?: string; received_amount?: string },
  ) => Promise<{ billing_phase: BillingPhaseRow }>;
}

/**
 * Container — wires real API calls to the view.
 *
 * Fetches billing phases, then fetches each phase's linked invoice (if any)
 * so the view shows the full Projected → Billed → Received lifecycle with the
 * per-phase collection-gate state.
 */
export function InvoiceCollection({
  placementId,
  onFetchPhases = (pid) =>
    apiGet<{ billing_phases: BillingPhaseRow[] }>(`/placements/${pid}/billing-phases`),
  onFetchInvoice = (iid) => apiGet<{ invoice: InvoiceRow }>(`/invoices/${iid}`),
  onUpdateInvoiceStatus = (iid, status) =>
    apiPatch<{ invoice: InvoiceRow; collection_released_count: number }>(`/invoices/${iid}`, {
      status,
    }),
  onUpdatePhaseAmounts = (pid, phaseId, input) =>
    apiPatch<{ billing_phase: BillingPhaseRow }>(
      `/placements/${pid}/billing-phases/${phaseId}`,
      input,
    ),
}: InvoiceCollectionProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const state = useAsync<InvoiceCollectionData>(async () => {
    const { billing_phases } = await onFetchPhases(placementId);

    // Fetch invoices for any phases that have an invoice_id
    const invoiceMap = new Map<string, InvoiceRow>();
    await Promise.all(
      billing_phases
        .filter((p) => p.invoice_id != null)
        .map(async (p) => {
          try {
            const { invoice } = await onFetchInvoice(p.invoice_id!);
            invoiceMap.set(p.invoice_id!, invoice);
          } catch {
            // Invoice not found — leave out of map; phase will show "No invoice linked"
          }
        }),
    );

    return { phases: billing_phases, invoices: invoiceMap };
  }, [placementId, refreshKey]);

  async function handleUpdateInvoiceStatus(invoiceId: string, status: string): Promise<void> {
    await onUpdateInvoiceStatus(invoiceId, status);
    setRefreshKey((k) => k + 1);
  }

  async function handleUpdatePhaseAmounts(
    phaseId: string,
    input: { billed_amount?: string; received_amount?: string },
  ): Promise<void> {
    await onUpdatePhaseAmounts(placementId, phaseId, input);
    setRefreshKey((k) => k + 1);
  }

  return (
    <InvoiceCollectionView
      state={state}
      onUpdateInvoiceStatus={handleUpdateInvoiceStatus}
      onUpdatePhaseAmounts={handleUpdatePhaseAmounts}
    />
  );
}

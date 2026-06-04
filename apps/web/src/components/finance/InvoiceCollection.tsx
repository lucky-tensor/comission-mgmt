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
// Styles
// ---------------------------------------------------------------------------

const phaseCardStyle: React.CSSProperties = {
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: '0.75rem',
  padding: '1.25rem',
  marginBottom: '1rem',
};

const phaseHeadStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 600,
  color: '#111827',
  marginTop: 0,
  marginBottom: '0.75rem',
  textTransform: 'capitalize',
};

const metaGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '1rem',
  marginBottom: '1rem',
};

const metaItemStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '0.5rem',
  padding: '0.75rem',
};

const metaLabelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  marginBottom: '0.25rem',
};

const metaValueStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  color: '#111827',
};

const gateBadgeStyle = (satisfied: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.375rem',
  padding: '0.25rem 0.625rem',
  borderRadius: '9999px',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: satisfied ? '#dcfce7' : '#fef9c3',
  color: satisfied ? '#166534' : '#854d0e',
  border: `1px solid ${satisfied ? '#bbf7d0' : '#fde68a'}`,
});

const invoiceSectionStyle: React.CSSProperties = {
  borderTop: '1px solid #e5e7eb',
  paddingTop: '1rem',
  marginTop: '0.5rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  marginBottom: '0.25rem',
};

const selectStyle: React.CSSProperties = {
  padding: '0.375rem 0.625rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  background: '#ffffff',
  cursor: 'pointer',
  marginRight: '0.5rem',
};

const btnStyle: React.CSSProperties = {
  padding: '0.375rem 0.875rem',
  background: '#1d4ed8',
  color: '#ffffff',
  border: 'none',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  fontWeight: 600,
  cursor: 'pointer',
};

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
    <div data-testid={`phase-card-${phase.phase_name}`} style={phaseCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={phaseHeadStyle}>{phase.phase_name} phase</h3>
        <span data-testid={`gate-badge-${phase.phase_name}`} style={gateBadgeStyle(gateSatisfied)}>
          {gateSatisfied ? 'Gate: Satisfied' : 'Gate: Held'}
        </span>
      </div>

      {/* Projected / Billed / Received lifecycle */}
      <div style={metaGridStyle}>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>Projected</div>
          <div data-testid={`projected-${phase.phase_name}`} style={metaValueStyle}>
            {formatCurrency(phase.projected_amount)}
          </div>
        </div>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>Billed</div>
          <div style={metaValueStyle}>
            <input
              data-testid={`billed-input-${phase.phase_name}`}
              type="text"
              value={pendingBilled}
              onChange={(e) => setPendingBilled(e.target.value)}
              placeholder="—"
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: '1rem',
                fontWeight: 700,
                color: '#111827',
                width: '100%',
                padding: 0,
              }}
            />
          </div>
        </div>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>Received</div>
          <div style={metaValueStyle}>
            <input
              data-testid={`received-input-${phase.phase_name}`}
              type="text"
              value={pendingReceived}
              onChange={(e) => setPendingReceived(e.target.value)}
              placeholder="—"
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: '1rem',
                fontWeight: 700,
                color: '#111827',
                width: '100%',
                padding: 0,
              }}
            />
          </div>
        </div>
      </div>

      {/* Invoice section */}
      <div style={invoiceSectionStyle}>
        {invoice ? (
          <div data-testid={`invoice-section-${phase.phase_name}`}>
            <div
              style={{ display: 'flex', gap: '2rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}
            >
              <div>
                <div style={labelStyle}>Invoice #</div>
                <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                  {invoice.invoice_number}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Amount Billed</div>
                <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                  {formatCurrency(invoice.amount_billed)}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Amount Collected</div>
                <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                  {invoice.amount_collected ? formatCurrency(invoice.amount_collected) : '—'}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Issued</div>
                <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                  {formatDate(invoice.issued_at)}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Due</div>
                <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                  {formatDate(invoice.due_at)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label htmlFor={`invoice-status-${phase.phase_name}`} style={labelStyle}>
                Status:
              </label>
              <select
                id={`invoice-status-${phase.phase_name}`}
                data-testid={`invoice-status-select-${phase.phase_name}`}
                value={pendingStatus}
                onChange={(e) => setPendingStatus(e.target.value)}
                style={selectStyle}
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
            style={{ fontSize: '0.875rem', color: '#9ca3af', fontStyle: 'italic' }}
          >
            No invoice linked to this phase.
          </div>
        )}
      </div>

      {/* Save controls */}
      <div style={{ marginTop: '0.875rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button
          data-testid={`save-btn-${phase.phase_name}`}
          onClick={() => void handleSave()}
          disabled={saving}
          style={saving ? { ...btnStyle, opacity: 0.6 } : btnStyle}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveError && (
          <span
            data-testid={`save-error-${phase.phase_name}`}
            style={{ fontSize: '0.8125rem', color: '#b91c1c' }}
          >
            {saveError}
          </span>
        )}
        {saveSuccess && !saveError && (
          <span
            data-testid={`save-success-${phase.phase_name}`}
            style={{ fontSize: '0.8125rem', color: '#166534' }}
          >
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

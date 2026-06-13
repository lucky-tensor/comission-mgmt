/**
 * Invoice payment trigger interface — no-op stubs for the Finance Close phase.
 *
 * ## Purpose (dev-scout)
 * This file establishes the canonical interface for the invoice-payment → commission-release
 * trigger so that the worker task type, the commission run re-evaluation path, and the invoice
 * tracking feature all share a single typed contract. No real trigger logic is implemented
 * here; behaviour will be filled in by the feature issues that own each piece.
 *
 * ## Canonical docs
 * - docs/prd.md §5.5  — Invoice and Collection Tracking
 * - docs/prd.md §6    — Invoice lifecycle: Issued → Partially Paid → Paid
 *                       Alternate: Issued → Disputed | Written Off / Credit Memo Applied
 * - docs/prd.md §7    — Accounts Receivable and Invoice Data integration
 * - docs/architecture/phase-finance-close.md — scout decision record
 * - docs/architecture/phase-commission-engine.md §Seam 3 — gateOnCollection worker trigger
 *
 * ## Invoice lifecycle (PRD §6, verbatim)
 * Issued → Partially Paid → Paid
 * Alternate paths: Issued → Disputed; Issued → Written Off / Credit Memo Applied
 *
 * ## Invoice → CommissionRun coupling (integration seam)
 * When an invoice transitions to 'Paid', the worker must:
 *   1. Identify all commission_records linked to the associated placement.
 *   2. Re-invoke the calculation pipeline (gateOnCollection) for each record.
 *   3. Post updated netPayable amounts to the CommissionRun review queue.
 * This is modelled as an `InvoicePaymentEvent` consumed by a worker task of type
 * `invoice_paid_recalc` (seam identified in phase-commission-engine.md §Seam 3).
 *
 * ## Integration seams discovered during scout
 * 1. `InvoiceStatus` must stay in sync with the database `invoices.status` CHECK constraint.
 *    The invoice-tracking feature issue must import `INVOICE_STATES` from this file rather
 *    than duplicating the list.
 * 2. `InvoicePaymentTrigger.onInvoicePaid` is not called directly by the API — it is
 *    dispatched by the worker after dequeuing an `invoice_paid_recalc` task. The API only
 *    updates `invoices.status`; the worker handles downstream commission re-evaluation.
 * 3. Credit memo and write-off events must also trigger re-evaluation (reducing payable
 *    amounts). The `onInvoiceCreditMemo` and `onInvoiceWriteOff` stubs are included here
 *    so the worker task-types issue can reference them when defining task payloads.
 * 4. Disputed invoices do NOT release commission — the dispute must be resolved first.
 *    `onInvoiceDisputed` notifies the CommissionRun that the associated placement is blocked.
 */

// ---------------------------------------------------------------------------
// InvoiceStatus — PRD §6 invoice lifecycle states
// ---------------------------------------------------------------------------

/**
 * All valid invoice lifecycle states as defined in PRD §6.
 *
 * Must be kept in sync with the `invoices.status` CHECK constraint in the database
 * migration. The invoice-tracking feature issue must import this array to generate
 * the CHECK constraint rather than duplicating the list.
 */
export const INVOICE_STATES = [
  'Issued',
  'PartiallyPaid',
  'Paid',
  'Disputed',
  'WrittenOff',
  'CreditMemoApplied',
] as const;

/** Union type of all valid invoice lifecycle states. */
export type InvoiceStatus = (typeof INVOICE_STATES)[number];

// ---------------------------------------------------------------------------
// InvoicePaymentEvent — the trigger payload
// ---------------------------------------------------------------------------

/**
 * Event payload emitted when an invoice status changes.
 *
 * The worker dequeues events of this shape and routes them to the appropriate
 * handler on `InvoicePaymentTrigger`.
 *
 * @stub — field set will be validated and possibly extended when the invoice-tracking
 *         feature issue is implemented.
 */
export interface InvoicePaymentEvent {
  /** Unique identifier for the invoice that changed status. */
  invoiceId: string;
  /** The placement this invoice is linked to. */
  placementId: string;
  /** Tenant / organisation scoping for multi-tenant isolation. */
  orgId: string;
  /** The new invoice status that triggered this event. */
  newStatus: InvoiceStatus;
  /** The previous invoice status before the transition. */
  previousStatus: InvoiceStatus;
  /** ISO 8601 timestamp of the status change. */
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// InvoicePaymentTrigger interface — no-op stubs
// ---------------------------------------------------------------------------

/**
 * The invoice-payment → commission-release trigger interface.
 *
 * All methods are no-op stubs. The worker task implementation will call the
 * appropriate handler based on the `InvoicePaymentEvent.newStatus` value.
 *
 * The invoice-tracking feature issue must provide the concrete implementation.
 * The worker task-types issue must define the task payload shapes that carry
 * `InvoicePaymentEvent` objects to this interface.
 *
 * @see docs/architecture/phase-finance-close.md §Seam 2
 * @see docs/architecture/phase-commission-engine.md §Seam 3
 */
export interface InvoicePaymentTrigger {
  /**
   * Called when an invoice transitions to 'Paid'.
   *
   * Real logic:
   *   1. Load all commission_records for event.placementId within the open CommissionRun.
   *   2. Re-invoke CalculationEngine.gateOnCollection with invoiceCollected=true.
   *   3. Persist updated netPayable amounts and mark records as no longer held-for-collection.
   *   4. Post an update to the CommissionRun review queue so Finance Admin sees the change.
   *
   * @stub — returns void without any side-effects.
   */
  onInvoicePaid(event: InvoicePaymentEvent): Promise<void>;

  /**
   * Called when an invoice enters 'Disputed' status.
   *
   * Real logic:
   *   1. Flag all commission_records for event.placementId as blocked by invoice dispute.
   *   2. Surface the placement in the CommissionRun exception queue.
   *   3. Notify the Finance Admin that the placement is blocked pending dispute resolution.
   *
   * @stub — returns void without any side-effects.
   */
  onInvoiceDisputed(event: InvoicePaymentEvent): Promise<void>;

  /**
   * Called when a credit memo is applied to an invoice.
   *
   * Real logic:
   *   1. Reduce the commissionable base for the associated placement by the memo amount.
   *   2. Re-invoke the calculation pipeline for affected commission_records.
   *   3. Post an audit ledger entry recording the adjustment and reason.
   *
   * @stub — returns void without any side-effects.
   */
  onInvoiceCreditMemo(event: InvoicePaymentEvent): Promise<void>;

  /**
   * Called when an invoice is written off.
   *
   * Real logic:
   *   1. Zero out the payable amount for all commission_records on the placement.
   *   2. Post a ledger adjustment with reason = 'invoice_written_off'.
   *   3. Notify affected producers that their payout on this placement is no longer payable.
   *
   * @stub — returns void without any side-effects.
   */
  onInvoiceWriteOff(event: InvoicePaymentEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// NoOpInvoicePaymentTrigger — stub implementation
// ---------------------------------------------------------------------------

/**
 * No-op implementation of InvoicePaymentTrigger.
 *
 * Every method returns void without performing any side-effects.
 * This implementation is the only one that should exist until the invoice-tracking
 * feature issue replaces the stub bodies.
 *
 * @stub — do not add real logic here; create a new implementing class in the feature issue.
 */
export class NoOpInvoicePaymentTrigger implements InvoicePaymentTrigger {
  async onInvoicePaid(_event: InvoicePaymentEvent): Promise<void> {
    // stub — no-op
  }

  async onInvoiceDisputed(_event: InvoicePaymentEvent): Promise<void> {
    // stub — no-op
  }

  async onInvoiceCreditMemo(_event: InvoicePaymentEvent): Promise<void> {
    // stub — no-op
  }

  async onInvoiceWriteOff(_event: InvoicePaymentEvent): Promise<void> {
    // stub — no-op
  }
}

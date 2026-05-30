# Phase: Finance Close Workflow — Scout Decision Record

> **Dev-scout record for Plan issue #25.**
> Records architectural decisions, integration seams, shared-file coupling, and risks discovered
> while stubbing the Finance Close phase entrypoints. Canonical docs: `docs/prd.md`,
> `docs/architecture.md`.

---

## Scope

This phase covers four features that share the CommissionRun state machine:

| Feature | Description |
|---|---|
| Invoice and collection tracking | Link placements to invoices; track lifecycle states; gate commission release on collection |
| Finance Admin commission run and review queue | Surface commission-ready placements, blocked placements, and flagged exceptions |
| Exception request and approval workflow | Custom splits, fee discounts, clawback waivers; each with reason code and audit trail |
| Payroll-ready export | Approved payout file per producer; no amount reaches export without Finance Admin approval |

The scout creates no-op stubs for all shared entrypoints and records coupling risks before
feature implementation begins.

---

## Stubs created

| File | Purpose |
|---|---|
| `packages/core/commission-run.ts` | CommissionRun state enum (Open, Approved, Exported), transition table, `canTransitionRun` stub |
| `packages/core/invoice-trigger.ts` | InvoiceStatus enum (6 states), `InvoicePaymentTrigger` interface, `NoOpInvoicePaymentTrigger` stub |

---

## Transition Table

### CommissionRun

```
Open      → Approved   (Finance Admin approves all placements in the run)
Approved  → Exported   (Finance Admin generates payroll export)
Exported  → (terminal) (no further transitions)
```

**PRD constraint (§5.7):** "No commission amount reaches payroll without prior approval."
The `Open → Approved` transition must validate that:
- All placements in the run have been reviewed.
- The exception queue for the run is empty (all exceptions resolved or rejected).
- No placement in the run has a blocked invoice (Disputed status).

### Invoice

```
Issued → PartiallyPaid → Paid
Issued → Disputed
Issued → WrittenOff
Issued → CreditMemoApplied
```

---

## Decisions

### Decision 1 — CommissionRun is a first-class entity, not a view

**Question:** Should a CommissionRun be a materialised entity row (`commission_runs` table) or
derived on-demand from the set of approved `commission_records` rows?

**Decision:** Materialised entity row. The CommissionRun needs its own state machine
(Open → Approved → Exported), its own audit trail, and a stable ID that the payroll export
file references. Deriving it on-demand would make approval gating ambiguous and make the
export non-idempotent.

**Implementation note:** The `commission_runs` table must include: `id`, `org_id`, `status`
(TEXT with CHECK on COMMISSION_RUN_STATES), `created_at`, `updated_at`, `exported_at` (nullable),
and `export_file_url` (nullable). The `commission_run_placements` join table links placements
to runs.

---

### Decision 2 — Invoice status is owned by this phase, not Phase 3

**Question:** Should invoice status and the collection gate be implemented in Phase 3 (Commission
Engine) or Phase 4 (Finance Close)?

**Decision:** Phase 4 (Finance Close). The invoice-tracking feature owns `invoices.status` and
the `InvoicePaymentTrigger` interface. Phase 3 only declares the `gateOnCollection` pipeline
stage and its `invoiceCollected: boolean` input. The concrete invoice-status lookup and the
worker task dispatch are both Phase 4 concerns.

**Rationale:** Phase 3 must not depend on the invoice schema. Keeping the dependency in Phase 4
means Phase 3 stubs compile and tests pass with the `NoOpCalculationEngine` without requiring a
real invoice row.

---

### Decision 3 — Exception workflow shares the CommissionRun, not a separate entity

**Question:** Should exceptions be a standalone entity or scoped to a CommissionRun?

**Decision:** Scoped to a CommissionRun. Each exception row carries a `commission_run_id` FK.
The CommissionRun cannot advance to Approved while any exception in its scope is in the
`Requested` or `Under Review` state (PRD §5.4: "exceptions ... are requested, documented with
a reason, and approved or rejected with a full audit trail").

**Implementation note:** The exception feature issue must add an `exceptions` table with
`commission_run_id`, `placement_id`, `exception_type`, `reason`, `status`, `requested_by`,
`decided_by`, and `decided_at` columns. The `Open → Approved` guard on `commission_runs` must
query `COUNT(*) FROM exceptions WHERE commission_run_id = $1 AND status IN ('Requested', 'UnderReview')`.

---

## Integration Seams

### Seam 1 — CommissionRun.status drives four features simultaneously

All four Finance Close features read and write the same `commission_runs.status` column:
- Invoice tracking reads it to determine whether a paid-invoice recalculation should queue.
- The review queue reads it to filter the list of runs needing Finance Admin attention.
- The exception workflow reads it to block `Open → Approved` when exceptions are unresolved.
- The payroll export writes it when advancing from `Approved → Exported`.

**Risk:** A race condition between a concurrent exception approval and an export initiation
could advance a run to Exported while an exception is still Under Review.

**Mitigation:** The `Approved → Exported` transition must acquire a `SELECT … FOR UPDATE` lock
on the `commission_runs` row and re-verify exception queue emptiness inside the same transaction.

---

### Seam 2 — Invoice paid event → commission recalculation → CommissionRun update

The sequence triggered by an invoice payment spans three subsystems:

1. **Invoice tracking** updates `invoices.status` to `Paid` and enqueues an
   `invoice_paid_recalc` worker task (task payload: `InvoicePaymentEvent`).
2. **Worker** dequeues the task and calls `InvoicePaymentTrigger.onInvoicePaid`.
3. **Commission Engine** re-invokes `CalculationEngine.gateOnCollection` with
   `invoiceCollected=true` for all affected commission_records.
4. **Commission Run** review queue refreshes to reflect the updated netPayable amounts.

**Downstream issue to update:** the worker task-types issue must add an `invoice_paid_recalc`
task type with `InvoicePaymentEvent` as the payload shape (import from `packages/core/invoice-trigger.ts`).

---

### Seam 3 — Exception approval posts ledger adjustments

When an exception of type `custom_split`, `fee_discount`, or `clawback_waiver` is approved,
it must post a ledger adjustment entry to `commission_records` — not silently update the
calculated amount. The ledger entry carries: `adjustment_type`, `amount_delta`, `reason_code`,
`approved_by`, and `approved_at`.

**Risk:** If the exception workflow writes directly to `commission_records.net_payable` without
posting a ledger entry, the adjustment is invisible to producers and violates the PRD §9
audit trail requirement ("All changes ... must be permanently recorded — never silently
overwritten — with timestamp, actor, and reason").

**Mitigation:** The exception feature issue must write to an `adjustments` table (or
`commission_record_adjustments`) before updating the aggregate `net_payable`. The Finance Admin
approval action must be a single transaction spanning both writes.

---

### Seam 4 — Payroll export is idempotent and gated on CommissionRun.status = 'Approved'

The payroll export must be re-runnable without producing duplicate payroll amounts. The export
feature must:
1. Check that `commission_runs.status = 'Approved'` before starting.
2. Advance the status to `Exported` in the same transaction that writes `export_file_url`.
3. Return the existing export URL if `status` is already `Exported` (idempotent retry).

**Risk:** If the export advances status and writes the file in separate operations, a failure
between the two leaves the run in an inconsistent state (status = Exported, file missing, or
file present but status = Approved allowing a second export).

---

### Seam 5 — `INVOICE_STATES` must be the sole source for `invoices.status` CHECK constraint

`packages/core/invoice-trigger.ts` exports `INVOICE_STATES` as the canonical list of invoice
lifecycle states. The invoice-tracking feature migration must import this array to generate
the CHECK constraint:

```sql
-- migration pattern
-- status TEXT NOT NULL CHECK (status IN (<values from INVOICE_STATES>))
```

The same import must be used in the DB package's `invoices` table helper to avoid duplicating
the list and risking drift.

---

## Shared-file coupling analysis

| Shared file | Used by | Coupling risk |
|---|---|---|
| `packages/core/commission-run.ts` | Commission Run/Review, Exception Workflow, Payroll Export | High — all three features transition the same state machine; transition guards must be coordinated |
| `packages/core/invoice-trigger.ts` | Invoice Tracking, Worker (task dispatch), Commission Engine (gateOnCollection) | High — `InvoicePaymentEvent` payload shape is the contract between invoice tracking and the worker |
| `commission_runs` table | All four Finance Close features | High — shared entity; concurrent writes must use row-level locks |
| `commission_records` table | Commission Engine (writes), Exception Workflow (adjustments), Payroll Export (reads) | High — multiple writers; adjustment pattern must be additive, not destructive |
| `packages/core/calculation-engine.ts` (gateOnCollection) | Commission Engine (Phase 3), Invoice Trigger (Phase 4) | Medium — interface is stable; Phase 4 must not change method signatures |

---

## Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Race condition: exception approval vs. export initiation (Seam 1) | High | Approved → Exported must use SELECT FOR UPDATE + re-verify exception queue |
| R2 | Invoice paid event never triggers recalculation without worker task type (Seam 2) | High | Worker task-types issue must add invoice_paid_recalc task |
| R3 | Exception approval silently mutates net_payable without ledger entry (Seam 3) | High | Exception feature must write to adjustments table in same transaction |
| R4 | Duplicate payroll export if status transition and file write are not atomic (Seam 4) | High | Export must advance status and write file URL in same transaction |
| R5 | INVOICE_STATES drifts from invoices.status DB CHECK constraint (Seam 5) | Medium | Migration must import INVOICE_STATES from packages/core/invoice-trigger.ts |
| R6 | CommissionRun advances to Approved with unresolved exceptions | High | Open → Approved guard must query exceptions table before allowing transition |
| R7 | commission_records encrypted columns not re-encrypted after adjustment | Medium | Exception adjustment writes must use FieldEncryptor (see phase-commission-engine.md §Seam 6) |

---

## Next issues to update

The following open issues in this phase must be updated with the seam discoveries above before
implementation begins. See integration handoff comment on each issue.

- **Invoice and collection tracking feature issue:** Must import `INVOICE_STATES` from
  `packages/core/invoice-trigger.ts` for the DB migration CHECK constraint (Seam 5). Must
  enqueue `invoice_paid_recalc` worker tasks on `invoices.status → 'Paid'` (Seam 2).
- **Finance Admin commission run and review queue feature issue:** Must implement
  `Open → Approved` guard that checks exception queue emptiness and invoice dispute state
  (Seam 1, Decision 3). Must import `canTransitionRun` from `packages/core/commission-run.ts`.
- **Exception request and approval workflow feature issue:** Must write adjustments to
  `commission_record_adjustments` table before updating net_payable (Seam 3). Must scope
  exceptions to `commission_run_id` (Decision 3).
- **Payroll-ready export feature issue:** Must implement idempotent `Approved → Exported`
  transition with `SELECT FOR UPDATE` and atomic file URL write (Seam 4).
- **Worker task-types issue:** Must add `invoice_paid_recalc` task type with
  `InvoicePaymentEvent` payload shape (Seam 2).

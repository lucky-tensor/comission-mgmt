# Phase: Post-Placement Risk — Scout Decision Record

> **Dev-scout record for Plan issue #27.**
> Records architectural decisions, integration seams, and risks discovered while stubbing the
> Post-Placement Risk phase entrypoints. Canonical docs: `docs/prd.md`, `docs/architecture.md`.

---

## Scope

This phase covers guarantee period tracking (issue #19) and clawback/holdback event handling
(issue #20). The scout decides the trigger mechanism for guarantee expiry, defines the
`GuaranteeState` enum, stubs the clawback ledger adjustment interface, and records all coupling
risks before feature implementation begins.

---

## Stubs created

| File | Purpose |
|---|---|
| `packages/core/guarantee-state.ts` | Guarantee state enum (Active, ExpiredClean, Triggered), transition table, `canTransitionGuarantee` stub |
| `packages/core/clawback-ledger.ts` | `ClawbackLedgerAdjuster` interface + `NoOpClawbackLedgerAdjuster` stub, `ClawbackTriggerEvent` and `ClawbackLedgerAdjustment` shapes |

---

## Transition Table

### GuaranteeState

```
Active → ExpiredClean   (guarantee window passes with no departure event)
Active → Triggered      (candidate departure or refund event within window)
ExpiredClean → (terminal)
Triggered    → (terminal)
```

---

## Decisions

### Decision 1 — Cron-based vs event-driven guarantee expiry trigger

**Question:** Should the guarantee expiry check be driven by a scheduled cron job (polling
`guarantee_expiry_date < NOW()`) or by an event emitted when the expiry date is reached (e.g.
a delayed-queue message)?

**Decision:** **Cron-based**. A daily scheduled worker job scans
`guarantee_periods WHERE state = 'Active' AND guarantee_expiry_date < NOW()` and enqueues a
`guarantee_expired_recalc` task for each matching row.

**Rationale:**

1. **Architecture alignment.** The existing worker architecture (docs/architecture.md) uses a
   network-isolated worker that processes tasks from a task queue. A cron trigger fits naturally:
   the scheduler enqueues tasks, the worker processes them, and the API writes results. An
   event-driven approach (e.g. Postgres `pg_notify` or a delayed-queue message per placement)
   would require a new integration surface not yet present in the codebase.

2. **Operational simplicity.** Cron jobs are easy to monitor, replay (re-run the scan for a
   past window), and reason about. Delayed-queue entries can be lost if the queue is reset or
   a placement's expiry date is updated after scheduling. A cron scan is idempotent — if the
   worker is down for a day, the next run catches up.

3. **PRD constraint.** PRD §5.6 does not require real-time guarantee expiry notification.
   "Automatically transitions" is satisfied by a daily (or configurable sub-day) cron window.
   If sub-minute precision becomes a requirement, the scan frequency can be increased without
   changing the architecture.

**Implementation note:** The guarantee tracking feature issue (#19) must:
- Add a `guarantee_expired_recalc` task type to the worker task registry.
- Implement the cron scan that queries `guarantee_periods WHERE state = 'Active' AND
  guarantee_expiry_date < NOW()` and enqueues one task per expiring guarantee.
- Implement the task handler that transitions `Guarantee.state` to `ExpiredClean` and
  releases held `commission_records` in a single transaction.
- The cron frequency should be configurable via environment variable (default: daily at 02:00 UTC).

---

### Decision 2 — Clawback adjustments reuse the exception ledger path

**Question:** Should clawback adjustments introduce a new code path (a dedicated
`clawback_adjustments` table) or reuse the existing exception adjustment pattern
established in `phase-finance-close.md §Seam 3`?

**Decision:** **Reuse the exception ledger path**. Clawback adjustments are posted as
negative entries to the same `commission_record_adjustments` table used by the exception
workflow, with `adjustment_type = 'clawback'` (or `'holdback'`) as the discriminator.

**Rationale:**

1. **Consistency.** PRD §9 requires a single audit trail for all changes to commission amounts.
   Two separate adjustment tables would split the ledger and complicate the Finance Admin review
   view, which aggregates all adjustments for a given CommissionRecord.

2. **No new write path.** The `commission_record_adjustments` table already carries
   `adjustment_type`, `amount_delta`, `reason_code`, `adjusted_by`, and `adjusted_at` columns
   (per the exception workflow design in `phase-finance-close.md §Decision 3`). Clawback entries
   fit these columns without schema changes.

3. **PRD constraint.** PRD §5.6 states that "clawback rules are configurable per-deal and per-plan."
   Using the same ledger table allows the Finance Admin to see clawback adjustments alongside
   exception adjustments in a unified history view without additional JOIN complexity.

**Implementation note:** The clawback feature issue (#20) must:
- Reuse `commission_record_adjustments` with `adjustment_type IN ('clawback', 'holdback',
  'refund_credit')` rather than creating a new table.
- Add `clawback_recovery_schedules` as a separate table (not an adjustment entry) since it
  carries installment-schedule fields (`installment_count`, `installment_amount`, `recovered`)
  that do not belong in the flat adjustment ledger.
- Validate that `Guarantee.state = 'Active'` before posting any adjustments (return 422 if
  outside the guarantee window, per acceptance criterion in issue #20).

---

## Integration Seams

### Seam 1 — GuaranteeState and PlacementState must advance atomically

`Guarantee.state` transitions must be coupled to the corresponding `PlacementState` transition:

- `Guarantee: Active → ExpiredClean` must advance `Placement: GuaranteeActive → GuaranteeExpired`
  in the same Postgres transaction.
- `Guarantee: Active → Triggered` must advance `Placement: GuaranteeActive → ClawbackTriggered`
  in the same Postgres transaction.

**Risk:** If the guarantee row and placement row are updated in separate transactions, a crash
between the two writes leaves the system in an inconsistent state where the guarantee is expired
but the placement is still `GuaranteeActive`.

**Downstream issue to update:** guarantee tracking feature issue (#19) and clawback feature
issue (#20) must both wrap their state transitions in a single Postgres transaction spanning
both rows.

---

### Seam 2 — guarantee_expiry_date on the Placement row

The guarantee expiry cron (Decision 1) queries `guarantee_expiry_date` from the placement (or
a linked `guarantee_periods` table). The guarantee tracking feature issue (#19) must:
- Add `guarantee_period_days` and `guarantee_expiry_date` columns to the `placements` table
  (or a linked `guarantee_periods` entity).
- Compute `guarantee_expiry_date = start_date + guarantee_period_days` at placement creation
  time (not at query time) to allow efficient index scans on the cron query.

**Risk:** Computing expiry at query time (e.g. `start_date + guarantee_period_days * interval '1 day'`)
prevents an index on `guarantee_expiry_date` and makes the cron scan a sequential scan at scale.

---

### Seam 3 — CommissionRecords released on clean expiry

When `Guarantee.state → ExpiredClean`, all `commission_records` for the placement that are
held for the guarantee window must be transitioned to `Payable`. This is the same pattern as
the collection-gate release (phase-commission-engine.md §Seam 4), but driven by the guarantee
expiry cron rather than an invoice-paid event.

**Downstream issue to update:** guarantee tracking feature issue (#19) must implement the
CommissionRecord hold-release step alongside the Guarantee state transition (see Seam 1 for
atomicity requirement).

---

### Seam 4 — Clawback write path shares commission_record_adjustments table

Per Decision 2, clawback adjustments share the `commission_record_adjustments` table with
exception-workflow adjustments. Both features must agree on the `adjustment_type` discriminator
values to avoid collisions:

| Source | adjustment_type values |
|---|---|
| Exception workflow | `custom_split`, `fee_discount`, `clawback_waiver` |
| Clawback workflow | `clawback`, `holdback`, `refund_credit` |

**Risk:** If the exception feature issue and clawback feature issue define `adjustment_type`
values independently (without coordination), the Finance Admin ledger view may show ambiguous
or overlapping entries.

**Mitigation:** The `adjustment_type` values should be defined as a shared enum in
`packages/core` and imported by both feature issues. This scout does not define that enum
(it is a feature-level concern), but the clawback feature issue (#20) should propose it.

---

### Seam 5 — Producer clawback exposure visibility (Producer Portal)

PRD §5.6 and the clawback issue (#20) require `GET /me/clawback-exposure` for the Producer
role. This endpoint depends on:
1. `commission_record_adjustments` rows with `adjustment_type IN ('clawback', 'holdback')`.
2. A `recovered` flag (or equivalent) to distinguish outstanding from settled clawbacks.
3. RBAC enforcement ensuring producers only see their own exposure.

The Producer Portal scout (phase-producer-portal.md) has already stubbed the producer-facing
API surface. The clawback feature issue (#20) must integrate with that surface rather than
introducing a new producer endpoint pattern.

---

## Shared-file coupling analysis

| Shared file | Used by | Coupling risk |
|---|---|---|
| `packages/core/guarantee-state.ts` | Guarantee Tracking (#19), Clawback (#20), Commission Engine (hold/release) | High — state enum is the contract between the guarantee tracker, the clawback workflow, and the commission hold-release path |
| `packages/core/clawback-ledger.ts` | Clawback (#20), Worker (task dispatch), Producer Portal (exposure endpoint) | High — `ClawbackTriggerEvent` payload shape is the contract between the API and the worker task |
| `commission_record_adjustments` table | Exception workflow, Clawback workflow | Medium — shared table; discriminator enum must be coordinated across both feature issues |
| `packages/core/placement-state.ts` (GuaranteeActive, ClawbackTriggered) | Guarantee Tracking, Clawback | High — placement state transitions must be atomic with guarantee state transitions (Seam 1) |

---

## Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Guarantee and Placement state advance in separate transactions → inconsistent state (Seam 1) | High | Both feature issues must use a single Postgres transaction spanning both rows |
| R2 | guarantee_expiry_date computed at query time → cron scan is a full table scan at scale (Seam 2) | Medium | Persist guarantee_expiry_date as a column and index it |
| R3 | CommissionRecord hold not released on clean expiry → commissions stuck in hold (Seam 3) | High | Guarantee tracking feature must release holds atomically with state transition |
| R4 | adjustment_type collision between exception and clawback workflows (Seam 4) | Medium | Clawback feature issue must propose a shared enum in packages/core |
| R5 | POST /guarantee/trigger on expired guarantee silently succeeds instead of returning 422 | High | Clawback feature must validate Guarantee.state = 'Active' before posting adjustments |
| R6 | Payroll recovery schedule not persisted → clawback amount untracked | High | Clawback feature must create clawback_recovery_schedules table in the same transaction |
| R7 | Producer clawback exposure endpoint duplicates Producer Portal pattern (Seam 5) | Low | Clawback feature (#20) must reuse the portal endpoint pattern from phase-producer-portal.md |

---

## Next issues to update

The following open issues in this phase must be updated with the seam discoveries above before
implementation begins.

- **Issue #19 (guarantee period tracking and monitoring):** Must use cron-based expiry trigger
  (Decision 1). Must advance `Guarantee.state → ExpiredClean` and `Placement.state →
  GuaranteeExpired` atomically (Seam 1). Must persist `guarantee_expiry_date` as an indexed
  column (Seam 2). Must release held CommissionRecords in the same transaction (Seam 3).
  Must add `guarantee_expired_recalc` worker task type.

- **Issue #20 (clawback and holdback event handling):** Must reuse `commission_record_adjustments`
  table (Decision 2). Must validate `Guarantee.state = 'Active'` before posting adjustments (R5).
  Must advance `Guarantee.state → Triggered` and `Placement.state → ClawbackTriggered` atomically
  (Seam 1). Must create `clawback_recovery_schedules` table in same transaction (R6). Must
  coordinate `adjustment_type` discriminator values with exception workflow (Seam 4).

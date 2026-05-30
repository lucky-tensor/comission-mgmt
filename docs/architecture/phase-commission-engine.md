# Phase: Commission Engine — Scout Decision Record

> **Dev-scout record for Plan issue #24.**
> Records architectural decisions, integration seams, and risks discovered while stubbing the
> Commission Engine phase entrypoints. Canonical docs: `docs/prd.md`, `docs/architecture.md`.

---

## Scope

This phase covers the five-stage commission calculation pipeline (calculateBase, applyTiers,
recoverDraw, gateOnCollection, applyGuaranteeHold), plan config versioning, tier resolution,
draw recovery, collection gating, guarantee-hold management, and the explainability layer
(PRD §5.3, §5.5, §5.6, §5.8). The scout creates no-op stubs for all shared interfaces and
records coupling risks before feature implementation begins.

---

## Stubs created

| File | Purpose |
|---|---|
| `packages/core/calculation-engine.ts` | `CalculationEngine` interface + `NoOpCalculationEngine` stub (five pipeline methods) |

---

## Calculation pipeline

```
Input: CalculationInput (placement, contributor, plan rules, flags)

Stage 1  calculateBase      → BaseResult           (commissionableBase × splitPct)
Stage 2  applyTiers         → TieredResult          (creditedBase × tier rate)
Stage 3  recoverDraw        → DrawRecoveryResult    (tieredGross − drawBalance offset)
Stage 4  gateOnCollection   → PayableResult         (hold if invoice not collected)
Stage 5  applyGuaranteeHold → PayableResult (final) (hold if inside guarantee window)
```

Each stage is a separate async method so it can be unit-tested and audited independently.
Every stage must write a `payout_explanation_lines` row linking the output delta to
`plan_version_id`, `placement_id`, and the triggering event (PRD §9 explainability requirement).

---

## Decisions

### Decision 1 — YTD gross sourcing for retroactive tier resolution

**Question:** Should `applyTiers` receive the contributor's year-to-date gross as an input
parameter, or should it query `commission_records` directly?

**Decision:** Pass YTD gross as a field in `CalculationInput` (`ytdGross: number`). The caller
(commission run orchestrator) is responsible for aggregating YTD gross before invoking the engine.

**Rationale:** Keeping the engine DB-free makes it easier to test (no real Postgres required) and
to replay in the explainability/audit flow. The orchestrator already holds a batch context; it can
group records by contributor and compute running YTD totals before calling the engine per record.

**Implementation note:** The calculation feature issue must document the exact SQL that computes
YTD gross: `SUM(gross_amount) FROM commission_records WHERE contributor_id = $1 AND status != 'Voided'
AND commission_period = $2 AND id != $3 (current record)`.

---

### Decision 2 — plan_versions.rules_snapshot schema

**Question:** What is the structure of `plan_versions.rules_snapshot` (JSONB)?

**Decision:** Defer the schema to the plan-config feature issue. The `CalculationInput.planRules`
field is typed as `unknown` in the stub. The plan-config feature issue must define and export a
`PlanRulesSnapshot` type from `packages/core` and replace the `unknown` with it. The engine must
validate the shape at load time using `isContributorRole` (from `packages/core/contributor-role.ts`)
when referencing roles in tier or split rules.

**Rationale:** Prematurely defining the schema would couple the scout to unresolved configurability
open questions in PRD §10 (how much plan configurability is required for initial customers?).

---

### Decision 3 — Plan config and calculation engine co-location vs. separate modules

**Question (PRD §scope):** Should plan config and the calculation engine be separate modules or
co-located?

**Decision:** Co-located in `packages/core`. Both `calculation-engine.ts` and the forthcoming
`plan-config.ts` live in the same package. They are separate files but share the same `packages/core`
module boundary, which allows the engine to import the `PlanRulesSnapshot` type without crossing
package boundaries.

**Rationale:** The calculation engine is tightly coupled to the plan config schema — separating them
into different packages would add a circular-dependency risk or require a third package for shared
types. Co-location avoids both problems while maintaining file-level separation.

---

## Integration Seams

### Seam 1 — plan_versions.rules_snapshot drives applyTiers logic

`plan_versions.rules_snapshot` (JSONB, currently `{"tiers":[]}` in seed data) is the sole source
of tier rates, thresholds, and fee-basis settings for the engine. The plan-config feature issue must:
- Define `PlanRulesSnapshot` type in `packages/core`.
- Update `CalculationInput.planRules` from `unknown` to `PlanRulesSnapshot`.
- Validate the snapshot at plan-version load time, not at calculation time.

**Downstream issue to update:** plan-config feature issue (creates plan_versions rows).

### Seam 2 — draw_balances SELECT FOR UPDATE requirement

`recoverDraw` reads and mutates `draw_balances.balance`. Two concurrent payout runs for the same
producer would each read the current balance and independently deduct, causing double-recovery.

**Mitigation:** The calculation feature issue must wrap the read-modify-write in a Postgres
`SELECT … FOR UPDATE` on the `draw_balances` row, scoped inside the same transaction that writes
the `commission_records` row.

**Risk:** If this lock is omitted, draw recovery will be incorrect under concurrent payout runs.

### Seam 3 — gateOnCollection is worker-driven, not user-driven

The collection gate (`invoiceCollected` flag) is not set by a direct user action. It is released
when `invoices.status` transitions to `'Paid'`. This transition is imported from an external AR
system (PRD §7.2). The worker (`apps/worker`) must:
1. Consume an invoice-paid event from the task queue.
2. Re-invoke the calculation pipeline for all commission_records linked to that placement.
3. Post the updated netPayable amounts for Finance Admin review.

**Downstream issue to update:** worker task types issue must add an `invoice_paid_recalc` task type.

### Seam 4 — applyGuaranteeHold is worker-driven (scheduled)

The guarantee-hold release is a scheduled event. The worker must run a daily (or configurable)
scan over `guarantee_periods WHERE status = 'Active' AND guarantee_ends < NOW()` and enqueue
a `guarantee_expired_recalc` task for each. The calculation feature issue must NOT implement the
release inline — it must rely on the worker job.

**Downstream issue to update:** worker task types issue must add a `guarantee_expired_recalc` task type.

### Seam 5 — Explainability requires payout_explanation_lines rows

PRD §9 requires that "every calculated payout [produces] a plain-language explanation traceable to
the placement record, fee terms, split assignment, plan version, and any triggering events." This
means each pipeline stage must write a `payout_explanation_lines` row (table not yet migrated) as a
side-effect, not as an afterthought.

The calculation feature issue must create the migration for `payout_explanation_lines` and write one
row per stage per calculation. The schema is not defined by this scout; it is deferred to the
explainability feature issue. However, the `CalculationEngine` interface must be designed to receive
(or emit) an audit-write callback, not fire-and-forget.

### Seam 6 — commission_records.gross_amount / net_payable are encrypted BYTEA columns

Based on `packages/db/seed.ts` and the `FieldEncryptor` pattern in `packages/db/src/placements.ts`,
`commission_records.gross_amount` and `commission_records.net_payable` are stored as BYTEA with
AES-256-GCM field encryption. The calculation feature issue must use `FieldEncryptor.encrypt` when
writing these columns, matching the pattern in `createPlacement`.

### Seam 7 — ContributorRole referenced by plan rules

Commission plan rules will reference `ContributorRole` values (e.g. "the ClientOriginator role
earns 10% on gross fee"). The plan-config feature issue must import `isContributorRole` from
`packages/core/contributor-role.ts` to validate role codes at plan-version load time (per the
integration seam noted in `contributor-role.ts`).

---

## Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Concurrent payout runs cause double draw-recovery (Seam 2) | High | Feature issue must use SELECT FOR UPDATE |
| R2 | gateOnCollection never releases without worker task type (Seam 3) | High | Worker issue must add invoice_paid_recalc task |
| R3 | applyGuaranteeHold never releases without scheduled worker (Seam 4) | High | Worker issue must add guarantee_expired_recalc task |
| R4 | payout_explanation_lines table not migrated before calculation (Seam 5) | High | Explainability feature issue must run migration first |
| R5 | rules_snapshot schema undefined — engine cannot parse plan rules (Seam 1) | High | Plan-config issue must define PlanRulesSnapshot before engine merges |
| R6 | commission_records encrypted columns not handled → corrupt writes | Medium | Calculation feature must use FieldEncryptor (Seam 6) |
| R7 | PRD configurability threshold open question (§10.3) defers tier/draw features | Low | Stub approach isolates risk — engine can return zero until features land |

---

## Shared-file coupling analysis

| Shared file | Used by | Coupling risk |
|---|---|---|
| `packages/core/calculation-engine.ts` | Commission Engine, Explainability, Commission Run Approval | High — interface signature is the contract; cannot change without updating all callers |
| `packages/core/contributor-role.ts` | Commission Engine (plan rule validation), Plan Config, RBAC | Medium — role codes are stable; adding a new role is additive |
| `packages/db/src/placements.ts` (COMMISSION_REQUIRED_FIELDS) | Commission Engine (pre-flight gate), Commission Run | Medium — field list changes if schema changes |
| `plan_versions.rules_snapshot` (JSONB) | Commission Engine, Plan Config | High — schema not yet defined; all callers blocked until Decision 2 resolved |

---

## Next issues to update

The following open issues must be updated with the seam discoveries above before implementation
begins. See integration handoff comment on each issue.

- **Plan-config feature issue:** Must define `PlanRulesSnapshot` type and replace
  `CalculationInput.planRules: unknown` with `PlanRulesSnapshot` before the engine is implemented
  (Seam 1, Decision 2).
- **Calculation feature issue:** Must implement all five `CalculationEngine` methods, use
  `SELECT FOR UPDATE` for draw recovery (Seam 2), and write `payout_explanation_lines` rows (Seam 5).
- **Worker task-types issue:** Must add `invoice_paid_recalc` and `guarantee_expired_recalc` task
  types (Seams 3 and 4).
- **Explainability feature issue:** Must create the `payout_explanation_lines` migration before the
  calculation engine writes to it (Seam 5).

# Phase: Leadership Visibility — Scout Decision Record

> **Dev-scout record for Plan issue #28.**
> Records architectural decisions, integration seams, and risks discovered while stubbing the
> Leadership Visibility phase entrypoints. Canonical docs: `docs/prd.md`, `docs/architecture.md`.

---

## Scope

This phase covers the executive dashboard endpoint (issue #21) and the manager team commission
view (issue #22). The scout validates the aggregation strategy for cross-team analytics queries
at expected row counts, stubs the analytics query layer, and records all coupling risks before
feature implementation begins.

---

## Stubs created

| File | Purpose |
|---|---|
| `apps/server/src/api/analytics.ts` | `handleGetExecutiveAnalytics` and `handleGetTeamAnalytics` stub handlers returning 501 |

---

## Aggregation Strategy

### Decision — On-the-fly aggregation vs materialized views

**Question:** Should the executive and team analytics endpoints aggregate
`CommissionRecord`, `placement`, `invoice`, `commission_record_adjustments`, `clawback_events`,
and `exception_requests` rows on every request (on-the-fly), or should the system maintain
pre-computed materialized views that are refreshed on a schedule or event?

**Decision:** **On-the-fly aggregation with query-level optimization.**

At the expected row counts for a commission management system (tens of thousands of placements,
hundreds of thousands of commission records per tenant), well-indexed SQL aggregation queries
execute in < 200 ms without materialization. Materialized views add write-side complexity
(refresh triggers or cron jobs), stale-data risk, and additional operational overhead that is
not justified until benchmarks confirm a performance bottleneck.

**Rationale:**

1. **Row count estimate.** A staffing agency processing 10,000 placements per year, with an
   average of 3 commission records per placement, produces ~30,000 commission records per year.
   Aggregating a full year's data with proper indexes on `org_id`, `status`, `created_at`, and
   `commission_run_id` is well within PostgreSQL's on-the-fly aggregate capability.

2. **Index coverage.** The existing schema indexes `commission_records(org_id, status)` and
   `placements(org_id)`. Adding a partial index on
   `commission_records(org_id, created_at) WHERE status != 'Draft'` will support
   both executive (time-windowed gross fee totals) and team (per-manager aggregation) queries
   efficiently.

3. **Operational simplicity.** On-the-fly queries are always consistent with the source tables.
   Materialized views require coordinated refresh on invoice-paid, clawback-trigger, and
   commission-run-finalize events. The exception and clawback workflows already have
   transactional complexity; adding a refresh step increases the surface area for bugs.

4. **Escape hatch.** If benchmarks after the feature is implemented reveal that aggregation
   queries exceed the 500 ms SLO at production row counts, the implementation can switch to a
   `MATERIALIZED VIEW` with a `CONCURRENT REFRESH` on the relevant write events without changing
   the API contract.

**Implementation note:** Feature issues #21 and #22 must:
- Add the partial index on `commission_records(org_id, created_at) WHERE status != 'Draft'` in
  the migration step.
- Use a single SQL query with window functions or CTEs rather than multiple round-trips to
  aggregate margin, fees, clawback exposure, and exception rate.
- Accept optional `?period=` (ISO 8601 date range) and `?manager_id=` query parameters for
  time-scoped and team-scoped filtering (see PRD §8.10).

---

## Integration Seams

### Seam 1 — Executive margin depends on commission_record_adjustments

The `gross_fees` field is the sum of `net_payable` across `CommissionRecord` rows in a given
period. The `net_margin` field must incorporate negative adjustments from clawback and exception
workflows. Both feature issues (#21 and #22) must join `commission_record_adjustments` to compute
the adjusted totals.

**Risk:** If the executive dashboard reads only `net_payable` without incorporating
`commission_record_adjustments`, the displayed margin will be overstated when clawbacks or
exception adjustments are pending.

**Mitigation:** The executive dashboard query must SUM `commission_record_adjustments.amount_delta`
grouped by `commission_record_id` and apply it to `net_payable` in the same aggregation CTE.

---

### Seam 2 — Clawback exposure requires clawback_events and recovery schedules

The `clawback_exposure` field in the executive dashboard (PRD §8.10) is the total outstanding
unrecovered clawback amount across the org. This requires:
1. `clawback_events` rows with `status != 'Recovered'`.
2. `clawback_recovery_schedules` rows to compute amount remaining vs. total.

**Downstream issue to update:** Feature issue #21 must join `clawback_events` and
`clawback_recovery_schedules` (introduced by issue #20) rather than computing exposure from
`commission_record_adjustments` alone.

---

### Seam 3 — Exception rate depends on exceptions table

The `exception_rate` KPI in the executive dashboard is the ratio of placements with at least
one Approved exception to total placements in the period. This requires a subquery or CTE on
the `exceptions` table (introduced by issue #14).

**Risk:** If the exceptions table is not yet populated for historical placements (e.g., because
the exception workflow was introduced mid-deployment), the denominator may be inflated and the
rate understated.

---

### Seam 4 — Team view requires a manager_id column on placements or contributors

The manager team view (issue #22) groups commission records by the manager responsible for
each placement. The current schema does not have a dedicated `manager_id` column on
`placements` or `contributors`.

**Decision needed by issue #22:** Either:
- Add a `manager_id` column to `placements` (set at placement creation by the recruiting manager).
- Use an existing contributor role to designate the managing contributor.

The choice must be documented in the issue #22 implementation spec before the schema migration
is written.

---

### Seam 5 — RBAC enforcement for analytics endpoints

PRD §8.10 implies executive analytics are restricted to Finance Admin and executive-level users.
The current RBAC model (PRD §7) defines `FinanceAdmin` and `Producer` roles. A new `Manager`
role or a role-extension pattern may be needed for the team view.

**Risk:** Implementing analytics endpoints without RBAC enforcement exposes sensitive aggregate
commission data to all authenticated users.

**Mitigation:** Both #21 and #22 must enforce `role IN ('FinanceAdmin')` at minimum until a
Manager role is formally defined. The stub handlers in `analytics.ts` accept `SessionClaims`
so RBAC can be wired in without signature changes.

---

## Shared-file coupling analysis

| Shared file | Used by | Coupling risk |
|---|---|---|
| `apps/server/src/api/analytics.ts` | Executive dashboard (#21), Manager team view (#22) | Low — stubs compile independently; each feature adds its own query function |
| `commission_records` table | Commission engine, Finance Close, Executive dashboard (#21), Team view (#22) | High — aggregation queries must account for all status values and adjustment rows |
| `commission_record_adjustments` table | Exception workflow (#14), Clawback workflow (#20), Executive dashboard (#21) | Medium — adjustment rows from multiple workflows must all be included in margin calc |
| `clawback_events` / `clawback_recovery_schedules` | Clawback (#20), Executive dashboard (#21) | Medium — exposure calculation depends on schema introduced by #20 |
| `exceptions` table | Exception workflow (#14), Executive dashboard (#21) | Low — read-only join from analytics; no write coupling |

---

## Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Executive margin overstated if adjustments not included in aggregation (Seam 1) | High | #21 must JOIN commission_record_adjustments in the aggregation CTE |
| R2 | Clawback exposure wrong if recovery schedules not consulted (Seam 2) | High | #21 must join clawback_recovery_schedules introduced by #20 |
| R3 | Exception rate understated due to historical data gaps (Seam 3) | Low | Document the data availability constraint in the API response |
| R4 | Team view blocked if manager_id column not defined (Seam 4) | High | #22 must resolve manager attribution schema before migration |
| R5 | Analytics endpoints expose sensitive data without RBAC (Seam 5) | High | Both #21 and #22 must enforce FinanceAdmin role before any aggregation runs |
| R6 | On-the-fly aggregation hits timeout at unexpectedly high row counts | Medium | Add partial index; set a 5-second query timeout; revisit if P99 > 500 ms |

---

## Next issues to update

The following open issues in this phase must be updated with the seam discoveries above before
implementation begins.

- **Issue #21 (executive dashboard):** Must use on-the-fly aggregation (Aggregation Strategy
  Decision). Must JOIN `commission_record_adjustments` for accurate margin (Seam 1). Must JOIN
  `clawback_events` and `clawback_recovery_schedules` for clawback exposure (Seam 2). Must
  compute `exception_rate` from the `exceptions` table (Seam 3). Must enforce FinanceAdmin
  RBAC (Seam 5). Must add partial index on `commission_records(org_id, created_at)`.

- **Issue #22 (manager team view):** Must resolve manager attribution schema — either
  `manager_id` column on `placements` or a contributor role (Seam 4). Must enforce FinanceAdmin
  RBAC at minimum until Manager role is defined (Seam 5). Must use on-the-fly aggregation
  (Aggregation Strategy Decision).

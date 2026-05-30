# Phase: Producer Portal — Scout Decision Record

> **Dev-scout record for Plan issue #26.**
> Records architectural decisions, integration seams, and risks discovered while stubbing the
> Producer Portal phase entrypoints. Canonical docs: `docs/prd.md`, `docs/architecture.md`.

---

## Scope

This phase adds producer-scoped `/me` endpoints that surface payout records, tier progress, and
dispute submission to the Producer role. The scout validates that these endpoints require no new
tables beyond the existing `commission_records`, `plans`, `plan_versions`, and `placements` schema,
and that tier progress can be computed on-the-fly without a materialized view or aggregation table.

---

## Stubs Created

| File | Purpose |
|---|---|
| `apps/server/src/api/me.ts` | `/me` route namespace — `handleGetMe`, `handleGetMyCommissionRecords`, `handleGetMyTierProgress`, `handleCreateMyDispute` stubs (all return 501) |

---

## Tier Progress Approach

**Question:** Should period-to-date tier progress be computed on-the-fly from `commission_records`
totals, or should a separate aggregation table (e.g. `producer_period_totals`) be materialized and
kept current?

**Decision: On-the-fly aggregation for MVP.**

Tier progress is computed at request time by summing `gross_amount` over `commission_records` rows
where `contributor_id = claims.user_id` and `status NOT IN ('ClawbackInitiated', 'Recovered')`
for the current plan period. No new table is required.

**Rationale:**

1. **No new tables.** `commission_records` already carries the per-contributor per-placement
   amounts that drive tier calculation. A `SUM(gross_amount)` query scoped by `org_id`,
   `contributor_id`, and `created_at` range executes in milliseconds at MVP scale
   (< 10,000 records per org).

2. **Consistency.** A materialized view would introduce a replication lag between a
   commission approval and the producer's tier display. On-the-fly reads from
   `commission_records` are always consistent with the current ledger state, which
   matches PRD §5.4 ("producers see their current tier progress … reflecting the latest
   placement, invoice, and approval data").

3. **Deferrable.** If query latency becomes a concern at scale (> 100,000 records per org),
   a `producer_period_totals` materialized view can be added as a performance optimisation
   without changing the `/me/tier-progress` API contract. This is a forward-compatible
   optimisation, not a blocking decision.

**Trigger to revisit:** p99 latency on `/me/tier-progress` exceeds 500 ms in a production
load test, or a customer org exceeds 50,000 `commission_records` rows.

---

## Data Model Validation

The scout confirms that the Producer Portal requires **no new database tables** beyond what is
already committed:

| Data need | Existing table | Notes |
|---|---|---|
| Producer's commission records | `commission_records` | Filter by `contributor_id = user_id` and `org_id` |
| Plan assignment and tier thresholds | `plan_versions`, `plan_assignments` | Active version resolved by `org_id` + `user_id` |
| Placement context (job title, fee) | `placements` | JOIN on `placement_id` |
| Disputes / questions | `exceptions` | Reuse existing workflow; `source = 'producer_dispute'` |
| Audit trail for `/me` reads | `commission_audit` | Audit-log-first write before every sensitive read (DATA-D-010) |

---

## Integration Seams

### 1. Producer scoping

All `/me` handlers receive `SessionClaims` with `user_id` (the producer's identity) and
`org_id` (the tenant). Scoping is `WHERE contributor_id = claims.user_id AND org_id = claims.org_id`.
This is the same tenant isolation pattern used in every existing API route.

**Risk:** A producer_id / contributor_id mismatch (e.g. the session `user_id` does not appear in
`commission_records.contributor_id`) will return an empty result set rather than a 403. Feature
implementation must document this behaviour and confirm it matches the PRD intent.

### 2. Audit-log-first for `/me` reads

`/me` routes return compensation PII (payout amounts). Per `DATA-D-010`, a `commission_audit`
entry must be written before the response is returned, and a failed audit write must deny the
read. Feature implementation must wire `auditSql` into every `/me` handler.

### 3. RBAC — Producer role only

`/me` routes are restricted to `role === 'Producer'`. Finance Admins and Managers who need to
view a specific producer's data use the existing `/commission-records` and `/placements` routes.
The `requireAuth` middleware will enforce this; feature implementation must add a
`requireScope('Producer')` guard inside each handler.

### 4. Disputes reuse exceptions workflow

`POST /me/disputes` will create an `exceptions` row with `source = 'producer_dispute'`. No new
table, migration, or workflow state machine is required. The existing `handleCreateException`
code path can be called directly (with the commission record ownership validation added).

### 5. Encrypted amounts

`commission_records.gross_amount` and `net_payable` are `BYTEA` columns encrypted via
`FieldEncryptor`. The `/me/commission-records` and `/me/tier-progress` handlers must decrypt
these fields before aggregating or returning them. Feature implementation must use the same
`FieldEncryptor` pattern as `packages/db/src/commission-records.ts`.

---

## Risks and Open Questions

| # | Risk / Question | Severity | Owner |
|---|---|---|---|
| 1 | Tier progress query performance at > 10k rows per org | Low (deferred) | Feature implementor |
| 2 | Audit-log write latency adding to `/me` p99 | Low | Feature implementor |
| 3 | `user_id` ↔ `contributor_id` field aliasing — confirm these are the same identifier | Medium | Feature implementor |
| 4 | Pagination strategy for `/me/commission-records` (cursor vs offset) | Low | Feature implementor |
| 5 | Period boundary definition: calendar month, plan-assignment date, or custom? | Medium | Finance Admin / product |

---

## Downstream Issues

The following Producer Portal feature issues should read this decision record before implementing:

- The `/me` route handlers in `apps/server/src/api/me.ts` are the integration seams to fill in.
- Tier progress must use the on-the-fly aggregation approach decided above.
- Disputes must reuse the `exceptions` table with `source = 'producer_dispute'`.
- All handlers require audit-log-first writes to `commission_audit` before returning data.

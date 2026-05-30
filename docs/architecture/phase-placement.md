# Phase: Placement and Attribution — Scout Decision Record

> **Dev-scout record for Plan issue #23.**
> Records architectural decisions, integration seams, and risks discovered while stubbing the
> Placement and Attribution phase entrypoints. Canonical docs: `docs/prd.md`, `docs/architecture.md`.

---

## Scope

This phase covers the placement state machine, contributor role definitions, CSV/ATS import
column-mapping validation, and the manager approval workflow. The scout creates no-op stubs for
all shared entrypoints and records coupling risks before feature implementation begins.

---

## Stubs created

| File | Purpose |
|---|---|
| `packages/core/placement-state.ts` | Placement state enum (12 states), transition table, `canTransition` stub |
| `packages/core/contributor-role.ts` | Contributor role enum (8 values), label map, `isContributorRole` guard |

---

## Transition Table

```
Created              → ContributorsAssigned
ContributorsAssigned → PendingApproval
PendingApproval      → Active | ContributorsAssigned  (rejection returns to editing)
Active               → Invoiced | Refunded | Disputed
Invoiced             → Collected
Collected            → GuaranteeActive | Closed       (no guarantee: skip to Closed)
GuaranteeActive      → GuaranteeExpired | ClawbackTriggered
GuaranteeExpired     → Closed
Refunded             → Closed
Disputed             → Active | Closed
ClawbackTriggered    → Closed
```

---

## Decisions

### Decision 1 — CSV column mapping validation approach

**Question:** Should CSV column mapping be validated eagerly (at upload time) or lazily (at import
time when the row is processed)?

**Decision:** Eager validation at upload time. The importer will parse the header row, resolve
column aliases from a configurable `ColumnAliasMap` record, and reject the entire upload with a
structured error payload before writing any rows to the database. This follows the data-completeness
gating principle in PRD §5.9 ("records with missing or ambiguous required fields are routed to a
reconciliation queue rather than silently dropped").

**Rationale:** Silent row drops break the trust guarantee that is central to the product value
proposition (PRD §1). Eager failure surfaces problems when the operator is still at the keyboard,
reducing the cycle time to resolution.

**Implementation note:** A stub `validateCsvColumnMap` function will be added in the CSV import
feature issue. Required columns derived from PRD §5.1: client, job order, candidate, start date,
fee agreement, compensation base.

---

### Decision 2 — contributors.role_code DB constraint

**Question:** Should `contributors.role_code` be a Postgres `ENUM` type or a `TEXT` column with
a `CHECK` constraint?

**Decision:** `TEXT` column with a `CHECK` constraint listing the eight values from
`packages/core/contributor-role.ts`. A `TEXT + CHECK` constraint is simpler to migrate (adding a
new role is a non-blocking `ALTER TABLE` rather than a DDL-locked `ALTER TYPE`) and is consistent
with the existing `placements.status` column pattern in `decisions.md`.

**Migration note:** The migration that adds the contributors table must import the
`CONTRIBUTOR_ROLES` array from `packages/core/contributor-role.ts` to keep the constraint in sync
with the TypeScript enum rather than duplicating the list.

---

## Integration Seams

### Seam 1 — `PlacementStatus` in packages/db/src/placements.ts

`packages/db/src/placements.ts` declares its own `PlacementStatus` type. After this scout merges,
the DB package type should be updated to re-export `PlacementState` from `packages/core/placement-state.ts`
rather than maintaining a duplicate union. This prevents drift between the canonical enum and the
DB layer.

**Downstream issue to update:** the placement CRUD feature issue must replace the local
`PlacementStatus` type with an import from `@commission-mgmt/core`.

### Seam 2 — Contributor completeness gate before state advance

Advancing `Created → ContributorsAssigned` requires that at least one contributor row exists for
the placement. The state transition guard (`canTransition`) is currently a no-op; the feature issue
that implements the transition must add a DB read against the `contributors` table as a precondition.

**Risk:** If the completeness check is omitted, placements can advance to `PendingApproval` without
any contributors assigned, which breaks the commission calculation invariant.

### Seam 3 — Approval workflow atomicity

Advancing `ContributorsAssigned → PendingApproval → Active` couples placement state to the manager
approval queue. Both the placement row update and the approval queue entry must be written in a
single transaction. The feature issue that implements this workflow must use a Postgres transaction
spanning both tables.

**Risk:** A partial write (state updated but no approval queue entry) would leave the placement
invisible to manager review.

### Seam 4 — Commission rule engine references roles by code

The commission rule engine (separate phase issue) will reference `ContributorRole` values when
applying plan rules to contributors. The rule engine must import `isContributorRole` from
`packages/core/contributor-role.ts` to validate plan config at load time rather than accepting
arbitrary strings.

---

## Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Placement can advance without contributors (Seam 2 above) | High | Feature issue must add guard |
| R2 | Approval state write is not atomic (Seam 3 above) | High | Feature issue must use transaction |
| R3 | `PlacementStatus` in db package drifts from canonical enum | Medium | Re-export from core (Seam 1) |
| R4 | CSV column alias map is customer-configurable — schema not yet defined | Low | Defer to CSV import feature issue |

---

## Next issues to update

The following open issues in this phase must be updated with the seam discoveries above before
implementation begins. See integration handoff comment on each issue.

- Issue #3 (Core schema — placement, contributor, commission tables): Update to re-export
  `PlacementState` from `@commission-mgmt/core` and add `CHECK` constraint for `role_code`.
- Downstream placement CRUD feature issue: Must import `canTransition` guard and add DB
  completeness check for the `Created → ContributorsAssigned` transition.

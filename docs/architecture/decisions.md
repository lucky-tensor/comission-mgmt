# Architecture Decisions — Commission Data Model, Tech Stack, and Tenancy

> **Dev-scout record for Plan issue #2.**
> Records all commission-domain architectural decisions not answered by the smart-crm reference
> implementation. Canonical docs: `docs/prd.md`, `docs/architecture.md`.
> References to smart-crm: `/home/lucas/superfield/demos/smart-crm`.

---

## ER Diagram

The placement-lifecycle data model uses a **hybrid schema**: the `entity_types` registry (property-graph
layer) carries configurable, per-customer plan structures, contributor roles, split types, and any
field that evolves as product configuration rather than DDL. A set of **dedicated relational tables**
carries integrity-critical placement and commission lifecycle entities whose shape is fixed and whose
transitions are audit-critical. This mirrors the smart-crm property-graph-plus-relational-journal
baseline (DATA-D-002/D-004, IMPL-DATA-002).

### Core Relational Tables

```
placements
  id                UUID        PK
  org_id            UUID        NOT NULL   -- tenancy column (see §Tenancy)
  ats_placement_id  TEXT                   -- external ATS reference
  candidate_id      UUID        NOT NULL   -- references entity (property-graph node)
  client_entity_id  UUID        NOT NULL   -- references entity (property-graph node)
  job_title         TEXT        NOT NULL
  start_date        DATE
  status            TEXT        NOT NULL   -- active | invoiced | paid | guaranteed | clawback | closed
  fee_amount        BYTEA       NOT NULL   -- KMS-encrypted AES-256-GCM (key: placement-financial)
  compensation_base BYTEA       NOT NULL   -- KMS-encrypted (key: placement-financial)
  guarantee_days    INT
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()

contributors
  id               UUID        PK
  org_id           UUID        NOT NULL
  placement_id     UUID        NOT NULL   FK → placements.id
  producer_id      UUID        NOT NULL   -- references entity (property-graph node for producer)
  role_code        TEXT        NOT NULL   -- bd | owner | sourcer | researcher | manager | external
  split_pct        NUMERIC(5,4) NOT NULL  -- e.g. 0.3000 = 30%
  split_override   BOOLEAN     NOT NULL DEFAULT false
  approved_by      UUID                   -- manager/finance who approved this split
  approved_at      TIMESTAMPTZ

commission_plans
  id               UUID        PK
  org_id           UUID        NOT NULL
  name             TEXT        NOT NULL
  effective_from   DATE        NOT NULL
  effective_to     DATE
  config_entity_id UUID        NOT NULL   -- property-graph entity holding JSON Schema plan rules
  created_by       UUID        NOT NULL
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()

plan_versions
  id               UUID        PK
  org_id           UUID        NOT NULL
  plan_id          UUID        NOT NULL   FK → commission_plans.id
  version_num      INT         NOT NULL
  rules_snapshot   JSONB       NOT NULL   -- immutable snapshot of plan rules at this version
  acknowledged_by  UUID[]                 -- producer IDs who have ACKed this version (PRD §6)
  effective_at     TIMESTAMPTZ NOT NULL
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()

commission_records
  id               UUID        PK
  org_id           UUID        NOT NULL
  placement_id     UUID        NOT NULL   FK → placements.id
  contributor_id   UUID        NOT NULL   FK → contributors.id
  plan_version_id  UUID        NOT NULL   FK → plan_versions.id
  gross_amount     BYTEA       NOT NULL   -- KMS-encrypted (key: commission-financial)
  net_payable      BYTEA       NOT NULL   -- KMS-encrypted (key: commission-financial)
  tier_rate        NUMERIC(5,4)
  status           TEXT        NOT NULL   -- pending | approved | paid | held | clawback | reversed
  approval_actor   UUID
  approval_at      TIMESTAMPTZ
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()

invoices
  id               UUID        PK
  org_id           UUID        NOT NULL
  placement_id     UUID        NOT NULL   FK → placements.id
  invoice_number   TEXT        NOT NULL
  amount_billed    BYTEA       NOT NULL   -- KMS-encrypted (key: invoice-financial)
  amount_collected BYTEA                  -- KMS-encrypted; NULL until payment received
  issued_at        TIMESTAMPTZ NOT NULL
  due_at           TIMESTAMPTZ
  collected_at     TIMESTAMPTZ
  status           TEXT        NOT NULL   -- issued | partial | paid | void

guarantee_periods
  id               UUID        PK
  org_id           UUID        NOT NULL
  placement_id     UUID        NOT NULL   FK → placements.id
  guarantee_ends   DATE        NOT NULL
  risk_amount      BYTEA       NOT NULL   -- KMS-encrypted; amount at risk during window
  triggered_at     TIMESTAMPTZ
  resolved_at      TIMESTAMPTZ
  resolution       TEXT                   -- expired | clawback | partial_clawback

draw_balances
  id               UUID        PK
  org_id           UUID        NOT NULL
  producer_id      UUID        NOT NULL   -- property-graph node
  balance          BYTEA       NOT NULL   -- KMS-encrypted (key: draw-financial)
  draw_limit       BYTEA       NOT NULL   -- KMS-encrypted
  recovery_start   DATE
  recovery_end     DATE
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()

exceptions
  id               UUID        PK
  org_id           UUID        NOT NULL
  placement_id     UUID        NOT NULL   FK → placements.id
  requested_by     UUID        NOT NULL
  exception_type   TEXT        NOT NULL   -- split_override | rate_override | clawback_waiver | other
  justification    TEXT        NOT NULL
  status           TEXT        NOT NULL   -- pending | approved | rejected
  reviewed_by      UUID
  reviewed_at      TIMESTAMPTZ
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()

audit_log_entries
  id               UUID        PK
  org_id           UUID        NOT NULL
  entity_type      TEXT        NOT NULL   -- placement | commission_record | invoice | exception | ...
  entity_id        UUID        NOT NULL
  action           TEXT        NOT NULL   -- create | update | delete | read_sensitive | approve | export
  actor_id         UUID        NOT NULL
  actor_type       TEXT        NOT NULL   -- user | worker | agent
  diff             JSONB                  -- field-level before/after (ciphertext for sensitive fields)
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

### Property-Graph Layer (extends smart-crm baseline)

The `entities` / `relations` / `entity_types` tables (smart-crm canonical) live in `commission_app`
and carry: producer profiles, client organizations, contacts, commission plan configuration objects,
and any domain extension that would otherwise require DDL. The `kms_key_id` and `sensitive_fields`
metadata columns on `entity_types` drive the FieldEncryptor interceptor for property-graph nodes
(same as smart-crm, see IMPL-DATA-002).

---

## Field Encryption Registry

All sensitive financial and PII columns use **AES-256-GCM via Web Crypto** (FieldEncryptor interceptor,
smart-crm canonical). Ciphertext envelope: `base64url(keyVersion‖IV‖ciphertext+tag)`. DEK cached
≤5 min in-process; KEKs never leave GCP Cloud KMS. Key IDs are environment-level KMS resource names
(`projects/{proj}/locations/{loc}/keyRings/{ring}/cryptoKeys/{key}`).

| Table | Column | KMS Key ID (alias) | Reason |
|-------|--------|--------------------|--------|
| `placements` | `fee_amount` | `placement-financial` | Gross placement fee — financial PII; recruiter and client confidentiality |
| `placements` | `compensation_base` | `placement-financial` | Base salary or fee base — compensation PII under PRD §9 confidentiality |
| `commission_records` | `gross_amount` | `commission-financial` | Commission amount — producer compensation PII |
| `commission_records` | `net_payable` | `commission-financial` | Net payout after draw recovery, splits, overrides |
| `invoices` | `amount_billed` | `invoice-financial` | Client-billed amount — financial confidentiality |
| `invoices` | `amount_collected` | `invoice-financial` | Collected amount — linked to revenue accounting |
| `guarantee_periods` | `risk_amount` | `placement-financial` | Clawback exposure amount — liability PII |
| `draw_balances` | `balance` | `draw-financial` | Current draw balance — producer compensation PII |
| `draw_balances` | `draw_limit` | `draw-financial` | Producer draw cap — compensation agreement term |

**Key registry summary (4 KMS keys, one per sensitivity domain):**

| Key Alias | Protects | Rotation period |
|-----------|----------|-----------------|
| `placement-financial` | Placement fees, compensation base, guarantee risk | 90 days |
| `commission-financial` | Commission gross and net payable amounts | 90 days |
| `invoice-financial` | Invoice billed and collected amounts | 90 days |
| `draw-financial` | Draw balances and limits | 90 days |

**Local dev:** A `KMSClient` interface (`packages/data/src/kms/kms-client.ts`) with an in-process stub
(`LocalKMSClient`) replaces GCP Cloud KMS in development and test environments — same as smart-crm.
The stub generates deterministic test keys per key alias and never makes network calls. GCP KMS is
only wired in `production` and `staging` environments via the `GcpKMSClient` implementation.

**Bank / payment details:** bank account numbers, routing numbers, and payment tokens are stored only
in property-graph `entities` nodes whose `entity_type` has `sensitive_fields: ["bank_account","routing"]`
and `kms_key_id: "producer-banking"`. A fifth KMS key (`producer-banking`) is reserved for this
category; no relational column stores raw banking data.

---

## Event vs State

**Decision: point-in-time state columns with an append-only relational business journal.**

Rationale:

1. **No continuous projection requirement.** Commission recalculation on invoice payment, guarantee
   expiry, or clawback triggering produces a discrete new state. There is no streaming/real-time
   projection consumer that would need an event-log as its source of truth.

2. **Append-only journal gives event-sourcing auditability without projection overhead.** Every
   consequential mutation to `commission_records`, `placements`, `exceptions`, and `invoices` is
   appended to `audit_log_entries` (in `commission_audit`) with actor, timestamp, and field diff
   (see `docs/architecture.md §4` — "Audit-log-first"). The journal functions as an event log for
   audit and replay without requiring a full event-sourcing projection stack.

3. **PRD §9 "never silently overwritten" is satisfied by the append-only audit DB, not by
   in-transaction event tables.** The three-database split (transactional / analytics / audit) is
   the structural enforcement.

4. **Recalculation triggers are worker-driven state transitions, not projections.** The
   guarantee-expiry and invoice-payment workers (Phase 3+) read the current state of
   `commission_records` and `placements`, compute the new state, call the API, and the API appends
   the diff to the audit log. No event stream subscription, no aggregate reconstruction.

5. **Risk of full event sourcing:** Re-projection at scale requires deterministic event ordering and
   idempotent reducers across multi-tenant data. For a commission ledger where amounts are
   KMS-encrypted per tenant, the operational complexity is disproportionate to the benefit.

**Adopted pattern:**

```
mutation path:
  server receives write request
  → validate business rules (rules engine in packages/core)
  → BEGIN TRANSACTION (commission_app)
  → UPDATE/INSERT state columns in relational tables
  → INSERT task_queue row if async worker needed (opaque payload: entity IDs only)
  → COMMIT
  → INSERT audit_log_entry to commission_audit (separate connection, insert-only role)
  → emit analytics event row to commission_analytics (separate connection, insert-only role)
```

The `audit_log_entries` table in `commission_audit` serves as the append-only event record for
compliance, replay, and dispute resolution.

---

## Analytics Taxonomy

Domain events emitted to `commission_analytics` (insert-only, pseudonymized, no FK to `commission_app`).
Each row carries: `event_type`, `occurred_at`, `org_id`, pseudonymized `actor_hash`, aggregated/binned
amounts (never raw financial figures in the analytics tier), and dimension metadata.

- `placement.created` — a new placement record is created; dimensions: org, client_region, practice, role_type
- `commission.approved` — a commission payout batch is approved by Finance Admin; dimensions: org, cycle_id, producer_count, total_records (no amounts)
- `clawback.triggered` — a guarantee period expires and a clawback is initiated; dimensions: org, guarantee_days_elapsed, triggered_by (worker vs manual)
- `invoice.collected` — an invoice transitions to `paid` status; dimensions: org, days_to_collect (binned), billing_cycle
- `exception.requested` — a contributor requests a split or rate exception; dimensions: org, exception_type
- `exception.resolved` — an exception is approved or rejected; dimensions: org, exception_type, resolution, days_to_resolve (binned)
- `dispute.opened` — a producer submits an in-platform dispute (PRD §5.8); dimensions: org, dispute_category
- `dispute.resolved` — a dispute is closed with a resolution; dimensions: org, resolution_type, days_to_close (binned)
- `plan.acknowledged` — a producer acknowledges a commission plan version (PRD §6); dimensions: org, plan_version, days_since_effective (binned)
- `payroll_export.generated` — Finance Admin exports a payroll-ready file; dimensions: org, cycle_id, record_count

**Pseudonymization:** `producer_id`, `actor_id`, and `candidate_id` are replaced with stable per-org
HMACs (HMAC-SHA256, key stored in `commission_app` per tenant, never in analytics DB). Amounts are
bucketed into ranges (e.g. `<5k`, `5k–15k`, `15k–50k`, `>50k`) before insertion. Raw financial values
are never written to `commission_analytics`.

**Differential privacy (Phase 7+):** Aggregate exports from `commission_analytics` (profitability-by-
recruiter, per-org exception rates) carry Laplace noise with per-query-class epsilon budgets tracked
in `commission_app`. See `docs/architecture.md §4` (Differential privacy constraint) and
`docs/architecture.md §5.5`.

---

## Audit Write Policy

All mutations to integrity-critical entities write an `audit_log_entry` to `commission_audit` using
the `audit_w` insert-only role (no UPDATE/DELETE/TRUNCATE on this connection). The write is performed
**after** the transactional commit but **before** the API response is returned; if the audit write
fails, the API returns an error and the client must retry (audit-write failure is treated as a hard
error, not a warning). This enforces the "audit-log-first" ordering for sensitive reads (DATA-D-010).

**Entities that trigger audit writes:**

| Entity | Triggering actions | audit_log_entry fields written |
|--------|--------------------|-------------------------------|
| `placements` | create, update (any field), status change | entity_type, entity_id, action, actor_id, actor_type, diff (before/after — sensitive fields stored as ciphertext references, not plaintext), occurred_at |
| `commission_records` | create, approve, hold, reverse, clawback, export | same as above + approval_actor, approval_at |
| `exceptions` | create, approve, reject | same as above + reviewed_by, reviewed_at |
| `invoices` | create, status change (partial→paid, void) | same as above |
| `draw_balances` | update | same as above |
| `plan_versions` | create, acknowledged_by update | same as above |
| any sensitive read | read_sensitive (Finance Admin reading encrypted field, export, payroll run) | action=read_sensitive, entity_type, entity_id, actor_id, actor_type, occurred_at |

**Worker-initiated mutations:** when the guarantee-expiry or recalculation worker writes via the API,
`actor_type = 'worker'` and `actor_id` is the worker's task-scoped delegated token principal. The
authorizing human's actor_id (the Finance Admin who approved the worker run) is captured in a separate
`authorizing_actor_id` field — dual attribution per AUTH-A-003 and WORKER-D-002.

**Diff format:** the `diff` JSONB column stores `{ "before": {...}, "after": {...} }` at the field
level. For KMS-encrypted fields, the diff stores the ciphertext envelope (`base64url(keyVersion‖IV‖ct)`)
rather than plaintext. The before state is captured inside the mutation transaction before the UPDATE
is applied; the after state is the committed row values.

**Retention and cold storage:** `commission_audit` rows are never deleted. At 90-day intervals, rows
older than 1 year are exported to a GCS object-lock bucket (immutable, append-only cold storage) and
remain in the hot DB. See `docs/architecture.md §3` (Google Cloud Storage vendor entry).

---

## Tenancy Strategy

**Decision: `org_id` column on every multi-tenant table, enforced at the application layer.**

Postgres Row-Level Security (RLS) was evaluated and rejected for this project. Rationale:

1. **Application-layer enforcement is the smart-crm baseline and aligns with the blueprint.** The
   smart-crm reference implementation uses an `org_id` column strategy with scoped application roles
   (not RLS policies). Replicating this pattern avoids divergence from the reference implementation
   and keeps the implementation team in a single mental model.

2. **RLS adds migration and testing complexity without a proportionate security benefit in this
   architecture.** Because `commission_app` is accessed only through the server API (never via direct
   client connections), and because the API enforces `org_id` scoping on every query via the `AuthContext`
   passed through the service layer, a second RLS enforcement layer would be redundant in normal
   operation. The threat model for direct-DB access is addressed by `audit_w` / `app_rw` role
   separation and network policy (no public DB port), not by RLS.

3. **RLS interacts poorly with the property-graph `entities`/`relations` tables.** Entity-graph
   traversal queries (recursive CTEs) that cross multiple entity types would require RLS policies
   attached to all three graph tables simultaneously, making query planning and testing significantly
   harder to reason about.

**Adopted pattern:**

- Every tenant-scoped table has `org_id UUID NOT NULL` as its second column (after `id`).
- The application service layer (`packages/services`) always reads `org_id` from the `AuthContext`
  and injects it into every WHERE clause and INSERT. No query against a multi-tenant table is allowed
  to omit `org_id`.
- A custom ESLint rule (Phase 1 or Phase 2) flags query-building functions that reference multi-tenant
  tables without an `org_id` predicate.
- Integration tests run each scenario under two distinct `org_id` values and assert that org A's data
  is never visible to org B (cross-tenant isolation test).

---

## Open Risks

1. **Property-graph ↔ relational boundary creep.** As plan structures grow more complex, there is
   risk that relational tables absorb configurable fields that should live in the entity registry, or
   vice versa. Mitigation: the schema review checklist (Plan issue #3) must include a "relational vs
   graph" classification question for every new column proposed.

2. **KMS latency under load.** With 9 encrypted columns across 5 relational tables, a single API
   request that touches multiple placement/commission/invoice rows may issue multiple KMS decrypt
   calls. Mitigation: the ≤5-min DEK cache (per-entity-type, per-process) should reduce KMS calls
   to 1 per key per cache window. Load-test the cache hit rate before Phase 3 go-live.

3. **Audit write failure atomicity.** The current design writes the transactional state first, then
   writes the audit entry. If the audit write fails after a successful transactional commit, the
   change is committed but unaudited. Mitigation: wrap the audit write in a retry with exponential
   backoff (max 3 retries, 2s/4s/8s); on exhaustion, log to the structured stderr channel AND enqueue
   a `audit_repair` task. Treat this as a P0 incident trigger. A stricter alternative (two-phase:
   reserve audit ID before commit, fill it after) can be adopted in Phase 3 if the retry path
   proves insufficient.

4. **org_id injection bugs.** Application-layer tenancy enforcement is only as strong as the
   discipline of the team writing queries. A missing `WHERE org_id = $1` predicate is a data-isolation
   bug. Mitigation: the ESLint rule (Risk §6 above), integration cross-tenant tests (Acceptance
   Criteria item), and code review checklist.

5. **Analytics pseudonymization key management.** The per-org HMAC key for pseudonymizing producer
   IDs in `commission_analytics` must be stored in `commission_app` (per tenant) and must not be
   derivable from the analytics DB alone. If the HMAC key is lost, historical analytics events cannot
   be re-linked to producers for dispute resolution. Mitigation: HMAC keys are backed up as part of
   the `commission_app` backup; analytics event rows should also carry `placement_id` (pseudonymized
   separately) to enable lookup-without-HMAC in the transactional DB.

6. **Draw balance encryption on high-frequency updates.** Draw balances are updated on every
   commission payout, which could be a frequent operation for large firms. Each update requires a KMS
   decrypt + re-encrypt cycle. Mitigation: batch draw balance updates at the end of a commission cycle
   run, not per-commission-record. The worker processes draw recovery as a post-approval batch step.

7. **Schema migration safety for encrypted columns.** Adding a new encrypted column to an existing
   table requires a multi-step migration (add nullable column, backfill with encrypted values, add
   NOT NULL constraint) to avoid downtime. Mitigation: document this as a mandatory migration
   pattern in `docs/architecture.md` before Phase 3 schema work begins.

---

*This document was produced by the dev-scout for Plan issue #2. It feeds directly into Plan issue #3
(schema migrations and initial data layer) and Plan issue #4 (monorepo scaffold). Any discovery during
implementation of issues #3+ that contradicts or extends these decisions should be recorded here as
an amendment, not silently overriding the original decision.*

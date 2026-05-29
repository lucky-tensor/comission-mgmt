# Architecture

This document holds the **architectural recommendations and decisions** for the
platform. The PRD (`docs/prd.md`) is product-only — it states *what* the product
must do and for whom. This document states *how* the system is built and *why*,
grounded in the superfield blueprint rules under `./blueprint` (symlink to
`.agents/blueprint`).

> This is the architecture home. For the full rule-by-rule synthesis — one
> section per blueprint rule file with traceability to rule numbers — run the
> `/architecture` skill, which reads `docs/prd.md`, `docs/plan.md`, and every
> file under `blueprint/rules/`. The dev-scout (Plan issue #2) records the
> commission-domain data model, field-encryption registry, and event taxonomy
> under `docs/architecture/decisions.md`.

## Stack (decided — replicate smart-crm)

The technology stack is fixed and mirrors the reference implementation at
`/home/lucas/superfield/demos/smart-crm`.

| Concern | Decision | Blueprint domain |
|---|---|---|
| Language / runtime | TypeScript on Bun | ARCH |
| Monorepo | Bun workspaces: `apps/server`, `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/ui` | ARCH |
| Database | PostgreSQL 16, raw client (no ORM) | DATA |
| Data segregation | Three databases — `commission_app` (transactional), `commission_analytics` (insert-only events), `commission_audit` (immutable log) — with three roles `app_rw`, `analytics_w`, `audit_w` | DATA |
| Authentication | WebAuthn passkeys only (FIDO2); no passwords | AUTH |
| Sessions | HTTP-only, Secure, SameSite=Strict cookies; JTI revocation; signing algorithm pinned at deploy | AUTH |
| Encryption | Application-layer field encryption (FieldEncryptor) with per-entity-type KMS keys; DEK cache ≤5 min; GCP Cloud KMS in production, dev stub locally | DATA |
| Background work | PostgreSQL single-table task queue (atomic claim, lease recovery); network-isolated workers that write only via the API with delegated, scoped, short-lived credentials | TASK-QUEUE, WORKER |
| Containers | Multi-stage distroless images (dev, production, release, worker targets); no shell in production | DEPLOY |
| Environments | Prototype == production container topology from day one; k3s; demo / stage / production | ENV, DEPLOY |
| Testing | Vitest (unit, integration, migration) + Playwright (component, E2E); no mocks except the external KMS boundary; ephemeral Postgres per suite; golden fixtures | TEST |
| Observability | Trace ID (UUID) propagated through all layers; structured JSON logging; `/healthz` + `/readyz` | DEPLOY |
| Interface quality | Beauty is a gate condition; every user type (human, admin, agent) gets a medium-appropriate interface; the agent is a declared, scoped first-class account participant | UX |

## Integration sequencing (relocated from PRD §7)

The PRD states the product **need** to integrate with applicant tracking / CRM,
accounts-receivable / accounting, and payroll systems. The **how and when** is an
architectural decision recorded here:

- **ATS / CRM ingest** — begin with file-based (CSV) import of placement, job
  order, candidate, submission, and contributor data. Live API connections to
  specific ATS/CRM vendors are sequenced later, prioritized by design-partner
  concentration. The import surface and the domain model stay unchanged when the
  transport swaps from file to live connection.
- **Accounts-receivable / invoice events** — ingest invoice issuance, payment,
  partial payment, credit memo, and write-off via file import initially; gate
  collection-dependent commission release on these events. Live accounting
  integration follows the same swap-the-transport principle.
- **Payroll handoff** — deliver approved payout output as a structured,
  payroll-ready file artifact in the initial release. Native two-way payroll
  integration is a future capability (PRD §8 marks it out of scope). The export
  is an immutable artifact linked to the approved commission run.

Rationale: file-first integration lets early customers run real commission
cycles before any vendor-specific connector exists, matching the TASK-QUEUE
principle that transport is swappable without changing the claim-execute-submit
lifecycle or the domain schema.

## Audit and immutability (relocated from PRD §9)

The PRD requires that every change to placements, commission calculations,
split assignments, and approvals be **permanently recorded, never silently
overwritten** (the product/compliance requirement). The mechanism is
architectural:

- Audit entries are written to the dedicated `commission_audit` database via the
  insert-only `audit_w` role — no UPDATE, DELETE, or TRUNCATE is granted, so the
  log is append-only at the database-permission level, not merely by convention.
- Each entry carries timestamp, actor, action, entity type, entity id, and a
  before/after diff. Audit writes happen on the normal API write path, including
  writes submitted by background workers through their delegated credentials.
- Approved economics are posted as ledger entries; adjustments (refunds, credit
  memos, clawbacks) are recorded as new entries rather than overwrites.

This satisfies DATA's immutable-audit-log rule and the PRD explainability
constraint (every payout is traceable to placement, fee terms, split, plan
version, and triggering events).

## Out-of-scope mechanisms

Per PRD §8, the following are out of scope for the initial release and therefore
carry no architecture here: contract-staffing gross-profit engine, multi-currency,
automated unstructured-contract parsing, plan simulation, client-facing portal,
and native two-way payroll integration.

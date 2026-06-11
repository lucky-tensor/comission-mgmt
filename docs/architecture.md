# Architecture

> Canonical technology and vendor reference for the Recruiting Commission Operations Platform.
> Derived from `docs/prd.md`, `docs/plan.md`, and the per-rule research under `docs/architecture/rule-*.md`
> (one file per blueprint in `blueprint/rules/`). This document covers **how** the system is built —
> the **what** lives in the PRD. The dev-scout (Plan issue #2) records the commission-domain data model,
> field-encryption registry, and event taxonomy under `docs/architecture/decisions.md`.

## 1. Overview

The platform is a multi-tenant, governed economic ledger for recruiting and staffing firms: every
placement carries a complete, auditable record of attribution, commission calculation, approvals,
collections, guarantee/clawback risk, and a payroll-ready export. Its defining non-functional
requirements — *all changes permanently recorded and never silently overwritten*, *every payout
explainable to its triggering event*, *strict per-role and per-tenant confidentiality*, and *no amount
reaches payroll without an explicit human approval* (PRD §9) — set the architectural posture: a
single-runtime TypeScript/Bun monorepo of independently deployable apps over shared typed packages;
three physically separated PostgreSQL 16 databases (transactional / analytics / audit) with distinct
insert-only roles; field-level encryption with per-entity-type KMS keys; passkey-only authentication
with a self-hosted, agent-aware token model; a PostgreSQL-backed task queue feeding a network-isolated,
write-through-API worker; and immutable distroless containers on k3s with health-gated, forward-only
rollouts. Security and auditability are enforced *structurally* (physical boundaries, DB roles, network
policy, deterministic CI gates), never by convention. The stack mirrors the reference implementation at
`/home/lucas/superfield/demos/smart-crm`.

## 2. Technology Stack

> **Conformance markers.** This document is the *target* architecture. Items not
> yet present in shipped code are tagged **_(planned)_**; intentional cross-phase
> seams that compile but are not yet wired are tagged **_(dormant)_**. Everything
> untagged is implemented in the current `main`. The conformance audit
> (`code-review-superfield-adherence-2026-05-30.md`) is the source of truth for
> these tags; see §10 for the running drift ledger.

| Layer | Choice | Rationale | Blueprint rules |
|-------|--------|-----------|-----------------|
| Runtime / language | **TypeScript** (strict, no `any` in contracts) on **Bun** (runtime, bundler, test runner, package manager) | Single type system across web/server/worker/packages protects money-bearing contracts; single binary keeps the distroless build simple. No Node/npm/webpack/jest. | IMPL-ARCH-001/002, IMPL-ENV-004/010, ARCH-C-012 |
| Repository | **Multi-app Bun workspace monorepo** — `apps/{web,server,worker}` + the shipped `packages/{core,db,ui}`; the blueprint's fuller canonical split `packages/{auth,data,services,integrations}` is **_(planned)_** (not yet carved out — `auth`/`data`/`services`/`integrations` do not exist on disk, and `db` was never renamed to `data`; see §5.2); strict physical runtime separation, single versioning | Each app independently deployable over shared typed packages; client builds fail on any server import. `apps/worker` is blueprint-justified by network isolation (ARCH-X-004), not premature decomposition. | ARCH-A-002, ARCH-D-001/D-003, IMPL-ARCH-009/017/018/020, IMPL-DATA-027, IMPL-AUTH-021 |
| Web framework / UI | **React** (latest stable) + **vanilla Tailwind CSS**; React hooks + minimal context for state; native `useState` forms; thin (<50-line) typed `fetch` wrapper | Data-dense role-scoped surfaces (portal, review queue, dashboards); no CSS-in-JS, no Redux/MobX/Zustand, no form/HTTP-client libraries. | IMPL-ARCH-003/004/005, IMPL-UX-008/009/011/013 |
| API style | **REST** with versioned, type-checked contracts defined once in `packages/core` | No sub-second/real-time requirement; "continuously updated" payouts are recalculation-on-event over REST, not WebSockets. No GraphQL/WS/Protobuf. | IMPL-ARCH-008/013/015/016, ARCH-D-004, UX-A-001 |
| Database (primary) | **PostgreSQL 16** `commission_app` — transactional ledger with `org_id` tenancy; **property-graph schema** (`entities`/`relations`/`entity_types` registry) + a **dedicated relational append-only business journal**; `postgres` npm client with tagged-template parameterized queries, **no ORM** | Property graph absorbs variable per-customer plan structures, contributor roles, and split types without DDL; the relational journal carries integrity-critical commission/clawback transitions; recursive CTEs for attribution timelines; parameterization is the multi-tenant injection defense. | DATA-P-003/P-004, DATA-D-002/D-004, IMPL-DATA-001/002/009/033/035 |
| Database (analytics) | **PostgreSQL 16** `commission_analytics` — insert-only, pseudonymized, aggregated events; no FK path to `commission_app` | Powers leadership dashboards without querying raw payouts; structural isolation, not a schema. | DATA-P-001, DATA-D-006, IMPL-DATA-015/044 |
| Database (audit) | **PostgreSQL 16** `commission_audit` — append-only, separate encryption key, independent backup | Implements PRD §9 "never silently overwritten"; audit-log-first ordering on every sensitive read. | DATA-D-004/D-010, IMPL-DATA-021/022/023/026 |
| Encryption / key mgmt | **Field-level AES-256-GCM via Web Crypto** (FieldEncryptor interceptor), **per-entity-type GCP Cloud KMS keys**, ciphertext envelope `IV‖ct+tag` (a **_(planned)_** `keyVersion` prefix and the **_(planned)_** background key-rotation job are not yet shipped — the current envelope has no version tag and rotation is manual), ≤5-min DEK cache | Protects compensation PII against DB-credential and backup theft; per-type keys bound blast radius; the keyVersion prefix will enable zero-downtime rotation once added. | DATA-P-002/P-007/D-005, IMPL-DATA-010/011/012/013/014 |
| Queue / async | **Single-table PostgreSQL `task_queue`** in `commission_app` — atomic claim, idempotency key, bounded retry + dead-letter, stale-claim lease recovery; **no Redis/RabbitMQ/SQS** | Firm-scale volume fits Postgres; one consistency/credential/audit domain; opaque-reference payloads keep financial PII out of the queue. | TQ-A-001, TQ-D-001/D-002/D-003, TQ-P-001/P-002/P-004, WORKER-D-001 |
| Worker execution | **Network-isolated, SELECT-only Bun worker** that **writes only via the API** with single-use, ≤24h, task-scoped delegated tokens; single-agent/single-replica to start | Keeps automated guarantee/clawback/recalculation jobs inside the audit + approval boundary; worker proposes, humans approve. | WORKER-P-001/P-002/P-006, WORKER-A-001, WORKER-D-002/D-003 |
| Auth / identity | **WebAuthn/FIDO2 passkeys (no passwords)** — server-side registration/assertion verification is **DIY via Web Crypto** (COSE/CBOR decoding hand-rolled; `@simplewebauthn/server` is **not** a dependency — only `@simplewebauthn/browser`/`/types` on the client); **DIY ES256 JWT** via Web Crypto (algorithm pinned); HTTP-only/Secure/SameSite=Strict cookies; durable **JTI revocation table** in `commission_app` with ≤60s cache + compromise bypass; single auth middleware with a path-prefix permission matrix (a named **_(planned)_** `requireScope` deny-by-default helper is not yet extracted — RBAC today is the prefix-matrix check in `core/auth`) | Self-hosted; the role/permission matrix plus external-partner scoping enforce PRD §9 confidentiality; no JWT library (algorithm-confusion class), no Auth SaaS. | AUTH-D-001/D-002/D-008/D-009, IMPL-AUTH-002/005/006/007/017/019, AUTH-A-003 |
| Agent / worker credentials | **Agent-aware auth gateway**: dedicated issuance endpoint, scoped tokens with KMS-scoped keys, daily re-auth, distinct from user/frontend tokens | Dual attribution (authorizing principal + executing worker) for every consequential ledger write. | AUTH-A-003, AUTH-D-003/D-004, IMPL-AUTH-013/014/015/016, WORKER-D-002 |
| File / object storage | **GCS** for plan documents, exception attachments, audit evidence (PRD §7) and **immutable object-lock audit cold storage**; SDK wrapper in an integrations package | Document/file storage and append-only long-term audit retention on the chosen GCP platform. | AUTH-C-029, DATA-C-025, IMPL-ARCH-020 |
| Notifications | **In-platform producer notifications** for worker-driven ledger adjustments (PRD §5.6) surfaced via `commission_audit` + UI; no external email/notification vendor committed | Automated adjustments must be visible, not silent; no notification-vendor requirement in PRD/Plan. | UX-P-005/X-004, UX-C-007 |
| Payment processing | **None** — payroll-ready *export* file only; no native payroll integration, no payments | Explicitly out of scope (PRD §8); export-format adapters, not payment rails. | (PRD §8; IMPL-ARCH-020 export adapters) |
| Observability | **Structured JSON logs to stdout**, full-stack **trace-ID** propagation (browser→header→server→PG query tag→response), deduplicated `uniques.log`, browser-error forwarding to `/api/logs`, PII-scrubbing log sink; CLI/log-fetchable (no dashboard-only) | Trace IDs are the substrate for the PRD's explainability/audit guarantee, not just ops hygiene. | DEPLOY-P-003/P-004, DEPLOY-D-002/D-003/D-004, IMPL-DEPLOY-014–017, DATA-D-012 |
| Infrastructure / hosting | **k3s** (k3d locally, GCP VM in production), **distroless multi-stage Bun images**, **AlloyDB** managed Postgres as the production/scale-out DB, **k8s NetworkPolicy** isolating DBs and worker (manifests present; **_(planned)_** verification that selectors/namespaces actually bind — the audit found the worker policy targeted a non-existent namespace/label, so DB isolation is **not yet enforced** in the shipped manifests); three environments (demo/stage/production) | Identical container topology across environments; single-node MVP with a documented multi-node scale-out path. | DEPLOY-A-002, DEPLOY-D-001, ENV-A-001/A-002, IMPL-DEPLOY-001/021, DATA-A-002 |
| CI/CD | **GitHub Actions** per-suite workflows (every root `vitest.*.config.ts` is gated, enforced by a coverage self-check); branch-protection **ruleset** (`bypass_actors: []`, `enforce_admins: true`) with required checks `quality` + `single-issue` — applied by the governance orchestrator; **_(planned)_** **merge queue** (`HEADGREEN`); immutable image digests; **_(planned)_** image signing + k3s admission verify; auto-roll demo/stage, **human-only production**; health-gated forward-only rollout with eager rollback | "No PR reaches main without green gates" mirrors "no amount reaches payroll without approval"; forward-only migrations protect the append-only ledger. | PROCESS-D-011/D-016, DEPLOY-P-008/P-010/P-012/P-018, TEST-A-002, IMPL-TEST-008/011 |
| Testing | **Vitest** single driver; **Playwright** headless Chromium provider (never JSDOM) — component + producer-portal E2E shipped in #78; **real PostgreSQL** via DIY pg-container (no mocks except the KMS boundary); golden-fixture recorder for ATS/AR/payroll; **_(planned)_** dedicated ledger-replay/recovery suite (not yet shipped) | Commission correctness against real Postgres is the product; replay/recovery will prove the immutable ledger once added. | TEST-P-001/P-008, TEST-D-001/D-006, IMPL-TEST-001/002/005/027, TEST-C-018 |

## 3. Vendor Selections

| Vendor | Category | Motivating rule | Notes |
|--------|----------|-----------------|-------|
| **GCP Cloud KMS** | Key management (HSM-backed, prod) | DATA-P-007, IMPL-AUTH-016 | Per-entity-type DEK envelope; dev stub locally behind a `KMSClient` interface. |
| **GCP AlloyDB** | Managed PostgreSQL (prod/scale-out) | DATA-A-002, ENV-A-002 | PITR, managed backups, primary+replica scale-out path. |
| **GCP Compute Engine (VM)** | Single-node k3s host | ENV-A-001, DEPLOY-A-002 | Agent-provisioned via `scripts/gcp/`. |
| **Google Cloud Storage** | Object storage + immutable audit cold storage | DATA-C-025, AUTH-C-029, PRD §7 | Object-lock bucket for append-only audit retention; document/attachment storage. |
| **GitHub + GitHub Actions** | VCS, CI/CD, branch protection, **_(planned)_** merge queue | PROCESS-D-011/D-016, DEPLOY-A-003 | Rulesets API, per-suite workflows, `gh` CLI as the control surface. Merge queue is not yet enabled. |
| **Cloudflare (`cloudflared`)** | Tunnel for local k3d demo preview | ENV-X-011 | Must expose the released frontend **container**, not a raw dev server. |
| **`@simplewebauthn/browser` / `@simplewebauthn/types`** | FIDO2 client-side ceremony + shared types | IMPL-AUTH-025 | Client-only. **Server-side** registration/assertion verification is **DIY via Web Crypto** — `@simplewebauthn/server` is **_(planned)_**/not adopted; the server hand-rolls COSE/CBOR verification today. |
| **`postgres` (npm)** | PostgreSQL client | IMPL-DATA-033 | Tagged-template parameterization by default; one client for three pools. |
| **`@scure/bip39`** _(planned)_ | BIP-39 mnemonic for recovery shard | IMPL-AUTH-027 | **Not yet a dependency.** The passkey account-recovery flow (§5.3) is planned, not shipped; `@scure/bip39` will be added when it lands. |
| **Vitest / Playwright / ESLint / Prettier** | Test + quality tooling | IMPL-TEST-001/002/021/022 | Vitest single driver; Playwright as headless-Chromium provider only. |
| **React / Tailwind CSS** | UI framework + styling | IMPL-ARCH-003/004, IMPL-UX-008/009 | Design tokens are a DIY JSON file; component docs are static build output (no Storybook). |

**DIY (explicitly not bought), per the Buy-vs-DIY framework (ARCH-D-002, IMPL-ARCH-022/025):** the commission
rules engine, split/attribution model, draw recovery, clawback/holdback logic, explainability generation,
the append-only audit ledger, JWT sign/verify (ES256 via Web Crypto), field encryption (AES-256-GCM/HKDF
via Web Crypto), rate limiting (token bucket), UUID v4 generation, CSV import/export and date utilities,
and small UI components. Every dependency is recorded in `docs/dependencies.md` with Buy/DIY justification,
locked versions, and a periodically audited transitive tree (ARCH-C-005/C-013, IMPL-ARCH-023).

*No vendor is currently `[unanchored]`.* Notification delivery (PRD §5.6) is in-platform only; if an external
email/SMS provider is later required it will be `[unanchored]` until a rule motivates it.

## 4. Architectural Constraints

Mandatory patterns and prohibitions, each traceable to a blueprint rule:

- **Physical runtime separation.** `apps/web` (browser bundle) must never resolve an import into
  `apps/server`, `apps/worker`, or `packages/db` (nor the **_(planned)_** `packages/data`/`packages/auth`); separate
  Bun build configs, CI fails on violation. Shared types only flow through `packages/core`; calculation logic stays
  server/worker-side.
  (ARCH-D-001, ARCH-P-001/P-004, IMPL-ARCH-010/011/026, IMPL-AUTH-032, IMPL-DATA-040)
- **Single source of truth for domain types.** Placement, contribution, commission, plan-version, invoice,
  draw, exception, and payroll-export-row types are defined once in `packages/core`; no duplicated shapes.
  (ARCH-T-004, IMPL-ARCH-014/024)
- **Three databases, three insert-only-where-applicable roles, no cross-DB privileges.** `app_rw`,
  `analytics_w` (insert-only), `audit_w` (insert-only, no UPDATE/DELETE/TRUNCATE); three separate
  connection pools. (DATA-A-001, DATA-C-002, IMPL-DATA-003/004/043)
- **Audit-log-first.** Every sensitive read writes a `commission_audit` entry (separate key, separate DB)
  *before* the read; audit-write failure denies the read; no batching. (DATA-D-010/P-008, IMPL-DATA-021)
- **Keys never colocated with data.** GCP Cloud KMS only; no keys in env/config; random IV per call; master/wrapping
  key mounted on DB pods only, never on API/worker pods. A **_(planned)_** `keyVersion` prefix on every ciphertext is
  not yet present (the shipped envelope is `IV‖ct+tag`). (DATA-P-007/X-006, IMPL-DATA-042/045/046)
- **Worker is read-only + write-through-API.** Zero DB write grants; all mutations are authenticated API calls
  with single-use, ≤24h, task-scoped delegated tokens; network policy blocks worker→DB; capability declared in
  the k8s manifest, never selected at runtime. (WORKER-X-001, WORKER-P-001/P-002/P-003, WORKER-C-006)
- **Passkey-only, algorithm-pinned auth.** No passwords, no HS256, no JWT library, no localStorage tokens, no
  Auth SaaS as sole path; durable (not in-memory-only) JTI revocation; RBAC is enforced by a deny-by-default
  path-prefix permission matrix in `core/auth` (a named **_(planned)_** `requireScope` helper has not been
  extracted yet). (AUTH-X-001/002/005, IMPL-AUTH-006/020/033/034)
- **Opaque task payloads.** Queue payloads carry only IDs + routing metadata; a creation-time denylist rejects
  financial/PII keys (amount, fee, salary, draw, email, name…). (TQ-P-002/C-004/X-002)
- **Immutable distroless containers, forward-only migrations, human-gated production.** No shell/package manager
  in images; no automated down-migrations against the append-only ledger; CI cannot deploy production; pre-migration
  labeled DB snapshots. (DEPLOY-D-001/P-010/P-012/P-017, ENV-T-003)
- **Real systems in tests, no mocks.** Real PostgreSQL via DIY pg-container, headless Chromium (never JSDOM —
  component + producer-portal E2E shipped in #78), recorded golden fixtures committed as files. The **_(planned)_**
  ledger replay/recovery suite is not yet shipped. (TEST-X-001/X-009, IMPL-TEST-024/027)
- **GitHub-enforced process.** Branch-protection ruleset with `bypass_actors: []` and `enforce_admins: true`,
  required checks (`quality`, `single-issue`) green, one-feature/one-branch/one-PR. **_(planned)_** `Depends-on`
  ordering, merge queue, and a `.gitattributes merge=binary` policy for docs are not yet in place. Planning state in
  GitHub Issues mirrors `docs/plan.md`. (PROCESS-D-011/D-016/X-009, IMPL-PROCESS-001/003/016)
- **Single design system, distinct per-actor surfaces, single path per action, progressive disclosure.** Target:
  one `packages/ui` design system across all six roles; no shared all-actor screen; no raw-DB admin; one canonical
  route per approval/export/dispute; advanced plan-config behind disclosure. All six role surfaces are shipped in
  `apps/web/src/components`: producer portal (`portal/`, incl. `DealSimulator.tsx`), finance queue (`finance/`,
  e.g. `PayrollExport.tsx`), manager view (`manager/`, e.g. `SplitApproval.tsx`), executive dashboard
  (`executive/`, e.g. `ExecFinancialPosition.tsx`, `ExecDisputeApproval.tsx`), HR (`hr/`, e.g.
  `DrawBalanceView.tsx`), and partner (`partner/PartnerPayoutView.tsx`), plus the login surface.
  (UX-D-002/D-004/D-005, UX-X-006/X-007)
- **Instrument every surface; annotate dormant-by-design code.** Target: every UI surface, page view, API route, and
  role-gated action emits a usage event to `commission_analytics`; cross-phase foundational code (clawback worker,
  external-partner guards, team-pool config) carries a `DORMANT_BY_DESIGN` annotation naming its dependent phase.
  **_(planned/dormant)_** — usage-event instrumentation is not yet present in code; `DORMANT_BY_DESIGN` annotations
  have only begun appearing on the arbitration scaffolds (`apps/server/src/api/dispute-arbitration.ts`,
  `packages/db/src/arbitration-results.ts`) and are not yet applied across the named foundational code.
  (PRUNE-P-006/P-002, PRUNE-C-001/C-003)
- **Property-graph schema + relational journal.** Configurable plan structures, contributor roles, and split types
  live in the `entity_types` registry (JSON Schema + sensitive-field + `kms_key_id` metadata) and evolve as data,
  not DDL; consequential commission/clawback/refund transitions are appended to a dedicated relational journal with
  deterministic replay. (DATA-D-002/D-004, IMPL-DATA-002)
- **Differential privacy on analytics-tier exports.** _(planned)_ Target: aggregate exports from the pseudonymous
  `commission_analytics` tier (esp. low-cardinality profitability-by-recruiter and any external-trust-boundary
  aggregate) carry Laplace noise with per-query-class epsilon budgets, atomic check-and-decrement, and structured
  rejection on exhaustion; exact internal finance figures are served from the audit-controlled transactional path,
  never noised. Not yet implemented. (DATA-D-008, IMPL-DATA-018)
- **M-of-N for catastrophic operations.** _(planned)_ Target: signing-key rotation and bulk compensation export
  require Shamir M-of-N operator approval (3-of-5 target, 2-of-3 minimum) with logged, time-bounded, single-use shard
  assembly — layered on top of, not replacing, the per-run single-actor payroll approval. Not yet implemented.
  (AUTH-D-006/P-007, AUTH-X-006)
- **Passkey recovery without email.** _(planned)_ Target: a BIP-39 recovery shard (AES-256-GCM/HKDF) gated by a
  second factor (Argon2id backup code or hardware key) re-enrolls a new passkey with device notifications; no
  email-based reset path exists. Not yet implemented (see the `@scure/bip39` vendor note). (AUTH-D-007,
  IMPL-AUTH-004/024, AUTH-X-008)

## 5. Resolved Decisions

Each previously-open decision is resolved by **preferring the blueprint recommendation**. Where a resolution
changes a stated choice, §2–§4 and §6 already reflect it.

1. **Schema modeling → property graph + relational journal (blueprint baseline).** Adopt the blueprint's
   property-graph-on-PostgreSQL model — `entities` / `relations` / `entity_types` with JSON Schema validation and
   sensitive-field + `kms_key_id` metadata — as the **primary** schema, so variable per-customer plan structures,
   contributor roles, and split types evolve as registry data rather than DDL (directly serving PRD Open Q4
   configurability). Keep a **dedicated relational append-only business journal** for the integrity-critical
   commission/clawback/refund transitions, plus nonce stores and replay checkpoints — the carve-out the blueprint
   itself prescribes. The Dev-scout (Plan issue #2) implements this split rather than choosing one or the other.
   (DATA-D-002/D-004/P-003, IMPL-DATA-002/006/007)

2. **Package layout → blueprint canonical set _(partially shipped; expansion planned)_.** Adopt
   `apps/{web,server,worker}` plus the blueprint's canonical `packages/{core, ui, auth, data, services, integrations}`.
   The shipped layout today is `packages/{core, db, ui}`; the `auth`/`data`/`services`/`integrations` carve-outs are
   **_(planned)_** and not yet on disk:
   - `packages/core` — shared domain types + the commission rules engine / explainability (server/worker-side; never in the browser runtime). (IMPL-ARCH-014/018)
   - `packages/db` — `db` / `crypto` / `kms` / `analytics` / `audit` and the Claude API client (`packages/db/src/claude-api-client.ts`) live here today. **_(planned)_** rename to `packages/data` per the blueprint is not yet done. (IMPL-DATA-027)
   - `packages/ui` — design system + shared React components. (IMPL-ARCH-019)
   - `packages/auth` **_(planned)_** — passkey, JWT (ES256), agent-auth, auth middleware (currently under `apps/server`, not yet a package). (IMPL-AUTH-021)
   - `packages/services` **_(planned)_** — capability/service layer + ATS/CRM and AR ingestion clients. (IMPL-ARCH-017)
   - `packages/integrations` **_(planned)_** — third-party SDK wrappers + payroll-export adapters + document/object storage. (IMPL-ARCH-020)

   `apps/worker` is retained — the blueprint blesses the worker split for network isolation (ARCH-X-004), not
   premature microservices. Each package has a documented, non-overlapping responsibility (ARCH-C-014/C-017). The
   Plan's `docs/plan.md` package list (`packages/{core,db,ui}`) matches the shipped set; reconciling to the fuller
   six-package layout is a separate, not-yet-scheduled refactor.

3. **Passkey recovery → BIP-39 recovery shard _(planned)_.** Target recovery flow: a BIP-39 mnemonic encrypting a
   server-held recovery shard (AES-256-GCM via HKDF), gated by a second factor (Argon2id backup code or hardware-key
   credential-ID lookup), re-enrolling a new passkey, with device notifications and **no email reset**. **Not yet
   implemented** — `@scure/bip39` is not currently a dependency; it will be added when this flow lands. Closes the
   lost-all-devices lockout gap for Finance/Executive roles. (AUTH-D-007/C-016/C-017, IMPL-AUTH-004/024/027, AUTH-X-008)

4. **Local dev → containerized build, no hot-reload dev server.** The `scripts/local-demo.ts` watch loop rebuilds
   and redeploys the **container image** into k3d on change; no long-lived in-process hot-reload dev server runs in
   any environment, and `cloudflared` exposes the released frontend container — preserving prototype==production
   parity. (DEPLOY-P-002/X-001, IMPL-DEPLOY-024, ENV-P-001/X-005/X-011)

5. **Differential privacy → applied to the analytics tier (production / Phase 7+).** Apply DP (Laplace noise,
   per-query-class epsilon budgets in `commission_app`, atomic check-and-decrement, structured rejection on
   exhaustion) to aggregate exports from the pseudonymous `commission_analytics` tier — in particular
   low-cardinality profitability-by-recruiter slices and any aggregate crossing an external trust boundary
   (External Partner view, PRD §5.10). Exact internal finance figures (payroll amounts, a producer's own payout)
   are served from the audit-controlled transactional path, never the analytics tier, so DP never noises numbers
   that must be exact. Built DIY (~120 lines), as production-maturity work. (DATA-D-006/D-007/D-008, IMPL-DATA-018/036, DATA-A-002)

6. **M-of-N → adopted for catastrophic operations.** Signing-key rotation and bulk compensation export require
   Shamir M-of-N operator approval (3-of-5 target, 2-of-3 minimum) with logged, time-bounded, single-use shard
   assembly and out-of-band notification — distinct from, and layered on top of, the per-run single-actor
   Finance-Admin payroll approval the PRD already mandates. Scheduled as production hardening. (AUTH-P-007/D-006/C-019/C-020, AUTH-X-006)

7. **KMS → GCP Cloud KMS, HSM-backed (dominant blueprint recommendation).** The DATA and AUTH blueprints' KMS rules
   govern: keys live in an HSM-backed KMS, separate from data, with versioned per-entity-type keys and automated
   rotation (DATA-P-007, DATA-C-023/C-024, IMPL-AUTH-016). IMPL-DATA-037's lighter "secrets-as-env-vars, no SDK"
   stance is the exception for projects without an HSM/separation requirement and does not apply to a multi-tenant
   financial platform; it survives only for the local dev stub and master/wrapping-key delivery. The k3s
   `EncryptionConfiguration` KMS (k8s Secrets at rest) is a distinct, complementary layer. This also matches the
   Plan. (DATA-P-007, DATA-C-023/C-024, IMPL-AUTH-016, IMPL-DATA-028/037, DEPLOY-P-013)

## 6. Blueprint Coverage

> **"Rules applied" = mapped into this architecture's design**, not a claim that
> every item is shipped. Items tagged **_(planned)_** below (image signing, merge
> queue, ledger replay/recovery, BIP-39 recovery shard, full analytics
> instrumentation + `DORMANT_BY_DESIGN` annotations, differential privacy, M-of-N)
> are designed but not yet in code — see the §2 markers and the §10 drift ledger.

| Blueprint file | Rules applied | Rules not applicable |
|---------------|---------------|----------------------|
| `blueprints/arch.yaml` | Runtime separation, monorepo boundaries, type-safe contracts, Buy/DIY, dependency hygiene (the prior "37 of 38" self-grade was design coverage, not shipped conformance) | ARCH-A-003 (polyrepo) |
| `blueprints/auth.yaml` | Passkeys, pinned alg, HTTP-only cookies, JTI revocation, agent gateway, dual attribution, immutable auth audit | Sandbox/twin credentials (AUTH-D-005/C-013); federated SSO (AUTH-A-002/C-031) deferred |
| `blueprints/data.yaml` | Three-DB/three-role, property-graph+journal, field encryption, audit-log-first, analytics tier + DP (§5.5), per-tenant keys | Signed-at-edge analytics (DATA-D-009); digital twins partial (operational previews only) |
| `blueprints/deploy.yaml` | Distroless, k3s, KMS secrets, health-gated forward-only rollout, deploy audit, trace IDs; **_(planned)_** image signing + admission verify, pre-migration DB snapshots | — (all applicable) |
| `blueprints/env.yaml` | k3s/k3d, distroless, three-container separation, ephemeral test DBs, agent-provisioned cluster, remote IDE | Multi-node replication (ENV-C-021/022) deferred to scale-out |
| `blueprints/process.yaml` | GitHub ruleset, required checks, three-doc loop, infra-first; **_(planned)_** `Depends-on` ordering, merge queue | Calypso multi-agent orchestration partial (solo-agent loop is the default) |
| `blueprints/prune.yaml` | **_(planned/dormant)_** full analytics instrumentation, `DORMANT_BY_DESIGN` annotations, DB-backed flags (not yet in code) | Four-stage pruning pipeline / deprecation-notice (no pruning feature in scope) |
| `blueprints/task-queue.yaml` | Single-table PG queue, atomic claim, idempotency, bounded retry+dead-letter, stale recovery, opaque payloads | LISTEN/NOTIFY, priority escalation (partial/optional) |
| `blueprints/test.yaml` | Real-systems, k8s integration, headless Playwright, per-suite CI, golden fixtures; **_(planned)_** ledger replay/recovery suite | Digital-twin lifecycle partial (maps to DEMO_MODE isolation) |
| `blueprints/ux.yaml` | Unified service layer, single design system, per-actor surfaces, single-path nav, progressive disclosure, headless verify | Agent-account UX rules partial (worker is the only automated actor) |
| `blueprints/worker.yaml` | Read-only DB, write-through-API, atomic claim, delegated single-use tokens, dual attribution, distroless, network policy | Digital-twin (P-007/D-006), AI-vendor-API/CLI rules (no vendor calls in scope) |
| `implementations/ts/arch-ts.yaml` | TS/Bun/React/Tailwind/REST stack, shared `packages/core` types, Buy/DIY, versioned contracts, canonical package layout (§5.2) | — |
| `implementations/ts/auth-ts.yaml` | Passkeys (DIY server-side verify; `@simplewebauthn/browser` on the client), DIY ES256 JWT, HTTP-only cookies, JTI table, path-prefix RBAC matrix, agent tokens; **_(planned)_** `requireScope` helper + BIP-39 recovery shard (§5.3) | — |
| `implementations/ts/data-ts.yaml` | PG16 from commit zero, property graph (§5.1), three roles/pools, `postgres` client/no-ORM, FieldEncryptor, audit-log-first (shipped #81), DB-level append-only triggers (#81), GCP KMS (§5.7); **_(planned)_** DP on analytics tier (§5.5) | Edge HMAC signing (IMPL-DATA-019) — server-emitted events |
| `implementations/ts/deploy-ts.yaml` | Multi-stage distroless Bun, frozen lockfile, k3s, kubectl-apply, KMS Secrets, stdout JSON logs, trace-ID chain (server leg); **_(planned)_** browser→server trace propagation + browser error capture | Uniques log partial (not yet named in Plan); hot-reload tension (see §5) |
| `implementations/ts/env-ts.yaml` | Bun/git/gh/Playwright/tmux host toolchain, port-31415 preview convention | Agent-CLI/agent-context rules partial (dev-environment governance) |
| `implementations/ts/process-ts.yaml` | GitHub-Issues planning, gh surface, worktrees, scaffold-first, PRD state machines; **_(planned)_** `.gitattributes merge=binary` | Calypso workflow YAML / task-catalog partial; `rust-quality`→TS substitution; IMPL-PROCESS-015 deprecated |
| `implementations/ts/test-ts.yaml` | Vitest single driver, Playwright provider, real-PG integration, per-suite CI, golden fixtures, dynamic ports | `release.yml`/schema-upgrade-compat workflows partial (not yet shipped) |
| `implementations/ts/ux-ts.yaml` | Bun surface layout, `Capability`/`ActorType`, service-flow state machines, React/Tailwind, DIY tokens/forms, headless verify, all six role surfaces shipped (`apps/web/src/components/{portal,finance,manager,executive,hr,partner}`) | Agent-presence/SDK interfaces (IMPL-UX-004/015-SDK) — no account-bound agent in scope |

## 10. Conformance Drift Ledger

This section tracks the gap between this target architecture and shipped code,
seeded from `code-review-superfield-adherence-2026-05-30.md`. An item leaves the
ledger only when code implements it (and the corresponding §2/§5/§6 marker is
removed in the same PR).

**Closed by #81 (this PR):**
- Audit-log-**before**-sensitive-read ordering with deny-on-audit-failure
  (`apps/server/src/audit/sensitive-read.ts`, wired across the sensitive read paths).
- DB-level append-only on the audit and analytics ledgers — BEFORE
  UPDATE/DELETE/TRUNCATE triggers that bind the table owner, not just GRANT/REVOKE
  (proven in `packages/db/tests/migration.test.ts`).
- Every root `vitest.*.config.ts` gated by CI, with a coverage self-check that
  fails on an orphaned config (`.github/workflows/test-suites.yml`,
  `scripts/check-vitest-coverage.ts`).

**Still planned / dormant (tagged _(planned)_ / _(dormant)_ above):**
- `keyVersion` ciphertext-envelope prefix + automated key rotation.
- Named `requireScope` deny-by-default helper (RBAC today is the `core/auth`
  path-prefix matrix).
- `@simplewebauthn/server` adoption (server-side WebAuthn verify is DIY).
- BIP-39 passkey recovery shard (`@scure/bip39` not yet a dependency).
- Image signing + k3s admission verify; pre-migration DB snapshots.
- Ledger replay/recovery test suite.
- Usage-event instrumentation (`DORMANT_BY_DESIGN` annotations have begun on the
  arbitration scaffolds; not yet applied across foundational code).
- Merge queue, `Depends-on` ordering, `.gitattributes merge=binary`.
- Differential privacy on analytics exports; M-of-N for catastrophic operations.
- Worker NetworkPolicy selector/namespace binding (manifests present, not enforced).

**Applied outside this worker:**
- The branch-protection ruleset (`bypass_actors: []`, `enforce_admins: true`,
  required checks `quality` + `single-issue`) is created by the governance
  orchestrator post-merge, not by feature PRs.

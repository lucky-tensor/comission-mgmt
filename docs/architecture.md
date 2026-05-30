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

| Layer | Choice | Rationale | Blueprint rules |
|-------|--------|-----------|-----------------|
| Runtime / language | **TypeScript** (strict, no `any` in contracts) on **Bun** (runtime, bundler, test runner, package manager) | Single type system across web/server/worker/packages protects money-bearing contracts; single binary keeps the distroless build simple. No Node/npm/webpack/jest. | IMPL-ARCH-001/002, IMPL-ENV-004/010, ARCH-C-012 |
| Repository | **Multi-app Bun workspace monorepo** — `apps/{server,web,worker}`, `packages/{core,db,ui}` — strict physical runtime separation, single versioning | Multiple independently deployable apps over shared typed packages; client builds fail on any server import. | ARCH-A-002, ARCH-D-001/D-003, ARCH-P-001 |
| Web framework / UI | **React** (latest stable) + **vanilla Tailwind CSS**; React hooks + minimal context for state; native `useState` forms; thin (<50-line) typed `fetch` wrapper | Data-dense role-scoped surfaces (portal, review queue, dashboards); no CSS-in-JS, no Redux/MobX/Zustand, no form/HTTP-client libraries. | IMPL-ARCH-003/004/005, IMPL-UX-008/009/011/013 |
| API style | **REST** with versioned, type-checked contracts defined once in `packages/core` | No sub-second/real-time requirement; "continuously updated" payouts are recalculation-on-event over REST, not WebSockets. No GraphQL/WS/Protobuf. | IMPL-ARCH-008/013/015/016, ARCH-D-004, UX-A-001 |
| Database (primary) | **PostgreSQL 16** `commission_app` — transactional ledger with `org_id` tenancy; `postgres` npm client with tagged-template parameterized queries, **no ORM** | One engine across all tiers; JSONB + recursive CTEs for variable plan structures and attribution timelines; parameterization is the multi-tenant injection defense. | DATA-P-004, IMPL-DATA-001/009/033/035, DATA-A-001 |
| Database (analytics) | **PostgreSQL 16** `commission_analytics` — insert-only, pseudonymized, aggregated events; no FK path to `commission_app` | Powers leadership dashboards without querying raw payouts; structural isolation, not a schema. | DATA-P-001, DATA-D-006, IMPL-DATA-015/044 |
| Database (audit) | **PostgreSQL 16** `commission_audit` — append-only, separate encryption key, independent backup | Implements PRD §9 "never silently overwritten"; audit-log-first ordering on every sensitive read. | DATA-D-004/D-010, IMPL-DATA-021/022/023/026 |
| Encryption / key mgmt | **Field-level AES-256-GCM via Web Crypto** (FieldEncryptor interceptor), **per-entity-type GCP Cloud KMS keys**, ciphertext envelope `base64url(keyVersion‖IV‖ct+tag)`, ≤5-min DEK cache, background key rotation | Protects compensation PII against DB-credential and backup theft; per-type keys bound blast radius; keyVersion enables zero-downtime rotation. | DATA-P-002/P-007/D-005, IMPL-DATA-010/011/012/013/014 |
| Queue / async | **Single-table PostgreSQL `task_queue`** in `commission_app` — atomic claim, idempotency key, bounded retry + dead-letter, stale-claim lease recovery; **no Redis/RabbitMQ/SQS** | Firm-scale volume fits Postgres; one consistency/credential/audit domain; opaque-reference payloads keep financial PII out of the queue. | TQ-A-001, TQ-D-001/D-002/D-003, TQ-P-001/P-002/P-004, WORKER-D-001 |
| Worker execution | **Network-isolated, SELECT-only Bun worker** that **writes only via the API** with single-use, ≤24h, task-scoped delegated tokens; single-agent/single-replica to start | Keeps automated guarantee/clawback/recalculation jobs inside the audit + approval boundary; worker proposes, humans approve. | WORKER-P-001/P-002/P-006, WORKER-A-001, WORKER-D-002/D-003 |
| Auth / identity | **WebAuthn/FIDO2 passkeys (no passwords)** via `@simplewebauthn/server`; **DIY ES256 JWT** via Web Crypto (algorithm pinned); HTTP-only/Secure/SameSite=Strict cookies; durable **JTI revocation table** in `commission_app` with ≤60s cache + compromise bypass; single auth middleware + `requireScope` deny-by-default | Self-hosted; six middleware-enforced roles plus external-partner scoping enforce PRD §9 confidentiality; no JWT library (algorithm-confusion class), no Auth SaaS. | AUTH-D-001/D-002/D-008/D-009, IMPL-AUTH-002/005/006/007/017/019, AUTH-A-003 |
| Agent / worker credentials | **Agent-aware auth gateway**: dedicated issuance endpoint, scoped tokens with KMS-scoped keys, daily re-auth, distinct from user/frontend tokens | Dual attribution (authorizing principal + executing worker) for every consequential ledger write. | AUTH-A-003, AUTH-D-003/D-004, IMPL-AUTH-013/014/015/016, WORKER-D-002 |
| File / object storage | **GCS** for plan documents, exception attachments, audit evidence (PRD §7) and **immutable object-lock audit cold storage**; SDK wrapper in an integrations package | Document/file storage and append-only long-term audit retention on the chosen GCP platform. | AUTH-C-029, DATA-C-025, IMPL-ARCH-020 |
| Notifications | **In-platform producer notifications** for worker-driven ledger adjustments (PRD §5.6) surfaced via `commission_audit` + UI; no external email/notification vendor committed | Automated adjustments must be visible, not silent; no notification-vendor requirement in PRD/Plan. | UX-P-005/X-004, UX-C-007 |
| Payment processing | **None** — payroll-ready *export* file only; no native payroll integration, no payments | Explicitly out of scope (PRD §8); export-format adapters, not payment rails. | (PRD §8; IMPL-ARCH-020 export adapters) |
| Observability | **Structured JSON logs to stdout**, full-stack **trace-ID** propagation (browser→header→server→PG query tag→response), deduplicated `uniques.log`, browser-error forwarding to `/api/logs`, PII-scrubbing log sink; CLI/log-fetchable (no dashboard-only) | Trace IDs are the substrate for the PRD's explainability/audit guarantee, not just ops hygiene. | DEPLOY-P-003/P-004, DEPLOY-D-002/D-003/D-004, IMPL-DEPLOY-014–017, DATA-D-012 |
| Infrastructure / hosting | **k3s** (k3d locally, GCP VM in production), **distroless multi-stage Bun images**, **AlloyDB** managed Postgres as the production/scale-out DB, **k8s NetworkPolicy** isolating DBs and worker; three environments (demo/stage/production) | Identical container topology across environments; single-node MVP with a documented multi-node scale-out path. | DEPLOY-A-002, DEPLOY-D-001, ENV-A-001/A-002, IMPL-DEPLOY-001/021, DATA-A-002 |
| CI/CD | **GitHub Actions** per-suite workflows; branch-protection **ruleset** (`bypass_actors: []`); **merge queue** (`HEADGREEN`); immutable image digests; image signing + k3s admission verify; auto-roll demo/stage, **human-only production**; health-gated forward-only rollout with eager rollback | "No PR reaches main without green gates" mirrors "no amount reaches payroll without approval"; forward-only migrations protect the append-only ledger. | PROCESS-D-011/D-016, DEPLOY-P-008/P-010/P-012/P-018, TEST-A-002, IMPL-TEST-008/011 |
| Testing | **Vitest** single driver; **Playwright** headless Chromium provider (never JSDOM); **real PostgreSQL** in k3d/kind (no mocks except the KMS boundary); golden-fixture recorder for ATS/AR/payroll; dedicated ledger-replay/recovery suite | Commission correctness against real Postgres is the product; replay/recovery proves the immutable ledger. | TEST-P-001/P-008, TEST-D-001/D-006, IMPL-TEST-001/002/005/027, TEST-C-018 |

## 3. Vendor Selections

| Vendor | Category | Motivating rule | Notes |
|--------|----------|-----------------|-------|
| **GCP Cloud KMS** | Key management (HSM-backed, prod) | DATA-P-007, IMPL-AUTH-016 | Per-entity-type DEK envelope; dev stub locally behind a `KMSClient` interface. |
| **GCP AlloyDB** | Managed PostgreSQL (prod/scale-out) | DATA-A-002, ENV-A-002 | PITR, managed backups, primary+replica scale-out path. |
| **GCP Compute Engine (VM)** | Single-node k3s host | ENV-A-001, DEPLOY-A-002 | Agent-provisioned via `scripts/gcp/`. |
| **Google Cloud Storage** | Object storage + immutable audit cold storage | DATA-C-025, AUTH-C-029, PRD §7 | Object-lock bucket for append-only audit retention; document/attachment storage. |
| **GitHub + GitHub Actions** | VCS, CI/CD, branch protection, merge queue | PROCESS-D-011/D-016, DEPLOY-A-003 | Rulesets API, per-suite workflows, `gh` CLI as the control surface. |
| **Cloudflare (`cloudflared`)** | Tunnel for local k3d demo preview | ENV-X-011 | Must expose the released frontend **container**, not a raw dev server. |
| **`@simplewebauthn/server`** | FIDO2 protocol handling | IMPL-AUTH-025 | Only bought auth dependency; no Bun-incompatible native deps. |
| **`postgres` (npm)** | PostgreSQL client | IMPL-DATA-033 | Tagged-template parameterization by default; one client for three pools. |
| **`@scure/bip39`** | BIP-39 mnemonic for recovery shard | IMPL-AUTH-027 | **Conditional** — only when the passkey-recovery flow is scheduled (see §5). |
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
  `apps/server`, `apps/worker`, or `packages/db`; separate Bun build configs, CI fails on violation.
  Shared types only flow through `packages/core`; calculation logic stays server/worker-side.
  (ARCH-D-001, ARCH-P-001/P-004, IMPL-ARCH-010/011/026, IMPL-AUTH-032, IMPL-DATA-040)
- **Single source of truth for domain types.** Placement, contribution, commission, plan-version, invoice,
  draw, exception, and payroll-export-row types are defined once in `packages/core`; no duplicated shapes.
  (ARCH-T-004, IMPL-ARCH-014/024)
- **Three databases, three insert-only-where-applicable roles, no cross-DB privileges.** `app_rw`,
  `analytics_w` (insert-only), `audit_w` (insert-only, no UPDATE/DELETE/TRUNCATE); three separate
  connection pools. (DATA-A-001, DATA-C-002, IMPL-DATA-003/004/043)
- **Audit-log-first.** Every sensitive read writes a `commission_audit` entry (separate key, separate DB)
  *before* the read; audit-write failure denies the read; no batching. (DATA-D-010/P-008, IMPL-DATA-021)
- **Keys never colocated with data.** GCP Cloud KMS only; no keys in env/config; random IV per call; keyVersion
  prefix on every ciphertext; master/wrapping key mounted on DB pods only, never on API/worker pods.
  (DATA-P-007/X-006, IMPL-DATA-042/045/046)
- **Worker is read-only + write-through-API.** Zero DB write grants; all mutations are authenticated API calls
  with single-use, ≤24h, task-scoped delegated tokens; network policy blocks worker→DB; capability declared in
  the k8s manifest, never selected at runtime. (WORKER-X-001, WORKER-P-001/P-002/P-003, WORKER-C-006)
- **Passkey-only, algorithm-pinned auth.** No passwords, no HS256, no JWT library, no localStorage tokens, no
  Auth SaaS as sole path; durable (not in-memory-only) JTI revocation; deny-by-default `requireScope` on every
  protected route. (AUTH-X-001/002/005, IMPL-AUTH-006/020/033/034)
- **Opaque task payloads.** Queue payloads carry only IDs + routing metadata; a creation-time denylist rejects
  financial/PII keys (amount, fee, salary, draw, email, name…). (TQ-P-002/C-004/X-002)
- **Immutable distroless containers, forward-only migrations, human-gated production.** No shell/package manager
  in images; no automated down-migrations against the append-only ledger; CI cannot deploy production; pre-migration
  labeled DB snapshots. (DEPLOY-D-001/P-010/P-012/P-017, ENV-T-003)
- **Real systems in tests, no mocks.** Real PostgreSQL in k3d/kind, headless Chromium (never JSDOM), recorded
  golden fixtures committed as files, ledger replay/recovery proven. (TEST-X-001/X-009, IMPL-TEST-024/027)
- **GitHub-enforced process.** Branch-protection ruleset with `bypass_actors: []`, all required checks green,
  one-feature/one-branch/one-PR, `Depends-on` ordering, merge queue; planning state in GitHub Issues (mirroring
  `docs/plan.md`); `.gitattributes merge=binary` for docs. (PROCESS-D-011/D-016/X-009, IMPL-PROCESS-001/003/016)
- **Single design system, distinct per-actor surfaces, single path per action, progressive disclosure.** One
  `packages/ui` design system across all six roles; no shared all-actor screen; no raw-DB admin; one canonical
  route per approval/export/dispute; advanced plan-config behind disclosure. (UX-D-002/D-004/D-005, UX-X-006/X-007)
- **Instrument every surface; annotate dormant-by-design code.** Every UI surface, page view, API route, and
  role-gated action emits a usage event to `commission_analytics`; cross-phase foundational code (clawback worker,
  external-partner guards, team-pool config) carries a `DORMANT_BY_DESIGN` annotation naming its dependent phase.
  (PRUNE-P-006/P-002, PRUNE-C-001/C-003)

## 5. Open Decisions

1. **Schema modeling — property graph vs domain-relational.** The blueprint baseline is a generic
   three-table property graph (`entities`/`relations`/`entity_types`, DATA-D-002, IMPL-DATA-002); the Plan
   describes "all placement-lifecycle entity tables" (relational). The complex commission calculations (tiers,
   pools, splits, draw offsets) favor explicit relational tables, while per-customer plan configurability
   (PRD Open Q4) favors the registry/JSONB approach. *Recommended default:* hybrid — relational tables for the
   integrity-critical commission/clawback journal and lifecycle entities, plus an `entity_types` registry
   (sensitive-field + `kms_key_id` metadata, plan-version schemas) for configurable, data-driven evolution.
   Resolve explicitly in the Phase 1 **Dev-scout** task. (DATA-P-003, IMPL-DATA-002/006/007)

2. **Monorepo package layout reconciliation.** Three blueprints name packages the Plan does not: IMPL-ARCH
   wants `packages/services` + `packages/integrations`; IMPL-DATA wants `packages/data` (db/crypto/kms/analytics/audit).
   The Plan uses `apps/worker` + `packages/db`. *Recommended default:* keep the Plan's `apps/worker`; map data-layer
   submodules (db/crypto/kms/analytics/audit) under `packages/db`; place ATS/AR/payroll/storage clients in a
   `packages/integrations` (or a clearly-bounded subdir) so Buy/DIY integration boundaries stay explicit. Document
   each package's non-overlapping responsibility here once chosen. (ARCH-T-007/C-014/C-017, IMPL-ARCH-009, IMPL-DATA-027)

3. **Passkey account-recovery flow (gap).** Passkey-only login makes recovery essential, but neither the PRD nor
   the Plan lists one — a Finance Admin losing all devices would be locked out mid-close. *Recommended default:*
   schedule a BIP-39 recovery-shard flow (`@scure/bip39` + AES-256-GCM/HKDF, second factor via Argon2id backup code
   or hardware key, re-enrolls a new passkey, device notifications, **no email reset**). Confirm before Phase 1
   closes. (AUTH-D-007/C-016, IMPL-AUTH-004/024/027)

4. **Hot-reload dev path (rule tension).** The Plan's `scripts/local-demo.ts` mentions a "hot-reload watch loop,"
   which conflicts with no-hot-reload-dev-server rules. *Recommended default:* the watch loop rebuilds and
   redeploys the **container image** into k3d (preserving environment parity) rather than running a long-lived
   in-process dev server, and `cloudflared` exposes the released frontend container. (DEPLOY-P-002/X-001,
   IMPL-DEPLOY-024, ENV-X-005/X-011)

5. **Differential privacy scope.** DP is prescribed for low-cardinality analytics exports (DATA-D-008), but the
   PRD's executive dashboards are *internal, authorized* views of the firm's own data — exact figures are required
   for payroll. *Recommended default:* apply DP only where an aggregate crosses an external trust boundary (e.g.
   the External Partner view, PRD §5.10) and to pseudonymous cohort/trend metrics; do not noise internal exact
   finance numbers. Decide per export in the Dev-scout. (DATA-D-007/D-008, IMPL-DATA-018/036)

6. **M-of-N for catastrophic operations.** Signing-key rotation and bulk compensation export warrant Shamir M-of-N
   (3-of-5 target, 2-of-3 min) operator approval; this is distinct from the per-run single-actor payroll approval
   the PRD already mandates. *Recommended default:* implement M-of-N for key rotation and bulk export as a
   production-hardening item, not MVP. (AUTH-P-007/D-006/C-019, AUTH-X-006)

7. **KMS stance conflict (resolved, noted for traceability).** IMPL-DATA-037 suggests "no KMS SDK needed
   (k3s encrypts Secrets, read keys from env)"; the Plan mandates GCP Cloud KMS. *Resolution:* the Plan wins — GCP
   Cloud KMS via the `KMSClient` interface manages envelope DEKs and rotation; the env-var/k8s-Secret path applies
   only to the dev stub and master/wrapping-key delivery. The k3s `EncryptionConfiguration` KMS (for k8s Secrets at
   rest) is a **distinct, complementary** layer from field-level GCP Cloud KMS. (IMPL-DATA-028/037, DEPLOY-P-013)

## 6. Blueprint Coverage

| Blueprint file | Rules applied | Rules not applicable |
|---------------|---------------|----------------------|
| `blueprints/arch.yaml` | 37 of 38 (runtime separation, monorepo boundaries, type-safe contracts, Buy/DIY, dependency hygiene) | ARCH-A-003 (polyrepo) |
| `blueprints/auth.yaml` | Passkeys, pinned alg, HTTP-only cookies, JTI revocation, agent gateway, dual attribution, immutable auth audit | Sandbox/twin credentials (AUTH-D-005/C-013); federated SSO (AUTH-A-002/C-031) deferred |
| `blueprints/data.yaml` | Three-DB/three-role, property-graph+journal, field encryption, audit-log-first, analytics tier, per-tenant keys | Signed-at-edge analytics (DATA-D-009); full DP/twins partial |
| `blueprints/deploy.yaml` | Distroless, k3s, KMS secrets, health-gated forward-only rollout, image signing, deploy audit, trace IDs | — (all applicable) |
| `blueprints/env.yaml` | k3s/k3d, distroless, three-container separation, ephemeral test DBs, agent-provisioned cluster, remote IDE | Multi-node replication (ENV-C-021/022) deferred to scale-out |
| `blueprints/process.yaml` | GitHub ruleset, required checks, Depends-on, merge queue, three-doc loop, infra-first | Calypso multi-agent orchestration partial (solo-agent loop is the default) |
| `blueprints/prune.yaml` | Full analytics instrumentation, `DORMANT_BY_DESIGN` annotations, DB-backed flags (if introduced) | Four-stage pruning pipeline / deprecation-notice (no pruning feature in scope) |
| `blueprints/task-queue.yaml` | Single-table PG queue, atomic claim, idempotency, bounded retry+dead-letter, stale recovery, opaque payloads | LISTEN/NOTIFY, priority escalation (partial/optional) |
| `blueprints/test.yaml` | Real-systems, k8s integration, headless Playwright, per-suite CI, ledger replay/recovery, golden fixtures | Digital-twin lifecycle partial (maps to DEMO_MODE isolation) |
| `blueprints/ux.yaml` | Unified service layer, single design system, per-actor surfaces, single-path nav, progressive disclosure, headless verify | Agent-account UX rules partial (worker is the only automated actor) |
| `blueprints/worker.yaml` | Read-only DB, write-through-API, atomic claim, delegated single-use tokens, dual attribution, distroless, network policy | Digital-twin (P-007/D-006), AI-vendor-API/CLI rules (no vendor calls in scope) |
| `implementations/ts/arch-ts.yaml` | TS/Bun/React/Tailwind/REST stack, shared `packages/core` types, Buy/DIY, versioned contracts | Layout deviation flagged (services/integrations vs worker/db — see §5) |
| `implementations/ts/auth-ts.yaml` | Passkeys+`@simplewebauthn`, DIY ES256 JWT, HTTP-only cookies, JTI table, scope middleware, agent tokens | Recovery shard (IMPL-AUTH-004/024/027) partial — Plan gap (see §5) |
| `implementations/ts/data-ts.yaml` | PG16 from commit zero, three roles/pools, `postgres` client/no-ORM, FieldEncryptor, audit-log-first | DP/HMAC/pseudonym rules partial; KMS-stance conflict resolved (see §5) |
| `implementations/ts/deploy-ts.yaml` | Multi-stage distroless Bun, frozen lockfile, k3s, kubectl-apply, KMS Secrets, trace-ID chain, browser error capture | Uniques log partial (not yet named in Plan); hot-reload tension (see §5) |
| `implementations/ts/env-ts.yaml` | Bun/git/gh/Playwright/tmux host toolchain, port-31415 preview convention | Agent-CLI/agent-context rules partial (dev-environment governance) |
| `implementations/ts/process-ts.yaml` | GitHub-Issues planning, gh surface, worktrees, scaffold-first, PRD state machines, `.gitattributes` | Calypso workflow YAML / task-catalog partial; `rust-quality`→TS substitution; IMPL-PROCESS-015 deprecated |
| `implementations/ts/test-ts.yaml` | Vitest single driver, Playwright provider, real-PG integration, per-suite CI, golden fixtures, dynamic ports | `release.yml`/schema-upgrade-compat workflows partial (not yet shipped) |
| `implementations/ts/ux-ts.yaml` | Bun surface layout, `Capability`/`ActorType`, service-flow state machines, React/Tailwind, DIY tokens/forms, headless verify | Agent-presence/SDK interfaces (IMPL-UX-004/015-SDK) — no account-bound agent in scope |

# Blueprint: IMPL-ARCH — Architecture Research

**Source:** blueprint/rules/implementations/ts/arch-ts.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint pins the entire TypeScript stack and repository topology for the commission platform. The most load-bearing rules for this project are the runtime-separation and shared-type rules (IMPL-ARCH-010, -011, -014, -016, -024): the platform must produce a payroll-ready export and a producer-facing portal that both depend on commission calculations, so the calculated payout types, plan-version contracts, and ledger types must have a single authoritative definition in `/packages/core` that both the browser app and the Bun server import. The Buy-vs-DIY dual threshold (IMPL-ARCH-022, -023, -025) directly governs the integration surface the PRD requires — ATS/CRM ingestion, AR/invoice ingestion, KMS, payroll export, document storage — where mature SDKs (e.g. GCP Cloud KMS, Stripe-class billing SDKs) are Buy and the commission rules engine, explainability, and audit ledger are DIY domain logic. The REST-only rules (IMPL-ARCH-008, -013, -015) fit the product cleanly because nothing in the PRD demands sub-second real-time or massive concurrency; the "continuously updated" producer payout is recalculation-on-event (the Plan's PostgreSQL task queue), not a live socket. The monorepo layout rules (IMPL-ARCH-009, -017 through -020) are partially divergent from the Plan, which adds `apps/worker` and `packages/db` not named in the blueprint's fixed layout — a deviation worth reconciling.

## Rule Analysis

### IMPL-ARCH-001: ts-only-language

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** TypeScript across `apps/web`, `apps/server`, `apps/worker`, and all packages. No plain `.js` source. The Plan's stack ("TypeScript + Bun") already commits to this.
- **Risk:** Mixing JS would break the single-type-system guarantee that the explainable-payout and payroll-export contracts depend on; financial field types could drift untyped between layers, producing silently wrong commission amounts.

### IMPL-ARCH-002: bun-runtime

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Bun is the server runtime and build tool for all packages. No Node.js. Confirmed by the Plan's Phase 1 stack and "Bun workspace" scaffold.
- **Risk:** Adopting Node alongside Bun fragments the build and tooling story for the monorepo, undermining the distroless single-runtime container model in the Plan.

### IMPL-ARCH-003: react-ui-framework

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** React (latest stable) for the producer payout portal, finance review queue, manager team view, and executive dashboard. The Plan references `Login.tsx`, confirming React.
- **Risk:** An alternative view library would break reuse of `/packages/ui` shared components across the multiple role-scoped surfaces the PRD requires.

### IMPL-ARCH-004: tailwind-css-styling

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Vanilla Tailwind CSS only — no CSS-in-JS, Sass, or CSS modules — for all dashboards, portals, and queues.
- **Risk:** Introducing a CSS pipeline adds build coupling and a dependency liability with no offsetting benefit for this data-dense, table-and-form-heavy UI.

### IMPL-ARCH-005: react-hooks-state-management

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** React hooks plus minimal context only. No Redux/MobX/Zustand. The role-scoped views (producer, manager, executive, partner) carry server-fetched, mostly read-derived state that fits hooks; payout figures are server-computed and stamped with derivation data, so heavy client state stores are unnecessary.
- **Risk:** A heavy state library would duplicate the server's authoritative ledger state on the client, risking the producer seeing stale payout numbers that contradict the "stamped with the data it was derived from" requirement.

### IMPL-ARCH-006: vitest-unit-testing

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Vitest for unit tests in `/tests/unit`. The commission rules engine (tiers, draw offset, desk-cost recovery, clawback) is the highest-value unit-test target. The Plan's `test-unit` CI suite maps here.
- **Risk:** Without unit coverage the calculation engine's many configurable branches (the PRD's enumerated calculation factors) cannot be regression-protected; wrong payouts directly cause the overpayment and dispute metrics the product targets.

### IMPL-ARCH-007: playwright-e2e-testing

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Playwright for browser/E2E in `/tests/e2e`. Targets: commission-run approval flow, payroll export generation, producer portal derivation view, dispute submission. Also already a sanctioned Buy dependency under IMPL-ARCH-022.
- **Risk:** The approval-gated close workflow ("no amount reaches payroll without approval") is a multi-step UI gate that needs E2E enforcement; a regression here is a compliance failure.

### IMPL-ARCH-008: rest-api-style

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** REST for all business integrations (ATS/CRM ingest, AR/invoice ingest, payroll export, document storage). The PRD has no sub-second real-time or massive-concurrency requirement, so REST is correct.
- **Risk:** Adopting GraphQL/WebSockets adds complexity and contract surface with no product justification, violating simplicity-scales.

### IMPL-ARCH-009: monorepo-directory-layout

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Blueprint fixes `/apps/web`, `/apps/server`, `/packages/ui`, `/packages/core`, `/packages/services`, `/packages/integrations`, `/tests/{unit,integration,e2e}`, `/docs`. The Plan diverges: it adds `apps/worker` and `packages/db`, and does not name `packages/services` or `packages/integrations`. This deviation should be reconciled — map the worker into the layout and decide whether ingestion/integration clients live in `packages/services`/`packages/integrations` (per IMPL-ARCH-017, -020) or are folded into `packages/db`/worker.
- **Risk:** Drifting from the canonical layout erodes the explicit package-boundary guarantees and makes the buy-vs-diy integration boundaries (services/integrations) ambiguous.

### IMPL-ARCH-010: web-browser-only-bundle

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** `/apps/web` builds a browser-only bundle with no resolvable server imports. Critical here because the PRD's confidentiality rules forbid producers/partners seeing other parties' amounts, margins, and draw balances — authorization and ledger access must be server-side and unreachable from the client graph.
- **Risk:** A server module leaking into the client bundle could expose firm-wide financials or other producers' payouts, directly breaching the §9 visibility-and-confidentiality constraint.

### IMPL-ARCH-011: server-bun-binary-only

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** `/apps/server` builds a Bun server binary with no browser/DOM imports. Aligns with the Plan's distroless container and `/healthz`/`/readyz` server.
- **Risk:** DOM imports bleeding into the server harm the distroless build and signal a boundary violation that can pull client code (and its trust assumptions) server-side.

### IMPL-ARCH-012: ci-separate-build-pipelines

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Separate web and server CI build pipelines; no shared build step or single root `tsconfig.json` across runtimes. The Plan's per-suite GitHub Actions (quality-gate, test-unit, test-api, test-migration, container build) should keep web and server builds distinct.
- **Risk:** Shared build steps couple runtime configs; a server tsconfig change could silently break or weaken the client's browser-only guarantee (IMPL-ARCH-010).

### IMPL-ARCH-013: rest-for-all-integrations

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** REST clients for ATS/CRM, AR/accounting, and document-storage integrations (PRD §7), housed in `/packages/services` and `/packages/integrations`. No GraphQL/WS/Protobuf.
- **Risk:** Non-REST transports for these batch/event-driven ingests add complexity without the real-time justification the rule requires.

### IMPL-ARCH-014: universal-types-in-packages-core

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** All API I/O types — placement, contribution/split, commission record, plan version, invoice, draw balance, exception, payroll-export row — defined once in `/packages/core` and imported by both web and server (and worker). This is the backbone for the producer portal showing the exact derivation the server computed.
- **Risk:** If types are not centralized, the portal's displayed payout fields can diverge from what the server calculated and exports to payroll, breaking the explainability constraint and trust in the source of truth.

### IMPL-ARCH-015: avoid-graphql-ws-protobuf

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Exclude GraphQL/WebSockets/Protobuf. The PRD's "continuously updated" producer payouts are recalculation-on-event served over REST (driven by the Plan's PostgreSQL task queue / event-driven recalculation), not live sockets — so the exclusion holds.
- **Risk:** Reaching for WebSockets to deliver "real-time" payouts would be unjustified complexity; the product needs freshness-on-fetch with a derivation stamp, not push.

### IMPL-ARCH-016: api-contracts-versioned-type-checked

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Versioned, type-checked API contracts; breaking changes update `/packages/core`. Reinforces the PRD's plan-version model (`Draft → Active → Superseded`) and immutable audit requirement — contract and plan versions must both be explicit.
- **Risk:** Unversioned contracts make historical payout reconstruction (a core finance pain) unreliable and can silently break the payroll export format the customer's payroll system expects.

### IMPL-ARCH-017: ingestion-in-packages-services

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** ATS/CRM and AR ingestion REST clients live in `/packages/services` and `/packages/integrations`. Maps to PRD §5.9 onboarding/import, §5.1 placement import, and §5.5 invoice import. Note the Plan does not yet name these packages (see IMPL-ARCH-009 deviation).
- **Risk:** Scattering ingestion logic into the server or worker without a package boundary makes the reconciliation queue and import-mapping logic hard to isolate and test.

### IMPL-ARCH-018: core-logic-in-packages-core

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The commission rules engine, split/attribution logic, draw recovery, clawback/holdback rules, and explainability generation — the product's domain core (PRD §5.3, Plan Phase 3) — live in `/packages/core` alongside domain types.
- **Risk:** Domain logic placed in the server app instead of `core` cannot be shared with the worker (which runs guarantee-expiry/clawback recalculation per the Plan), risking divergent calculation paths.

### IMPL-ARCH-019: ui-in-packages-ui-and-apps-web

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Shared components (tables, ledgers, status badges) in `/packages/ui`; role-specific workspaces (producer portal, finance review queue, manager view, executive dashboard) in `/apps/web`. Matches the Plan's `packages/ui` + `apps/web`.
- **Risk:** Duplicating shared display components per role surface causes inconsistent rendering of the same financial figures across views.

### IMPL-ARCH-020: integrations-in-packages-integrations

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Third-party SDK wrappers and export integrations in `/packages/integrations` — e.g. payroll-export format adapters (PRD §5.7, §8 export-only), document/file storage SDK, KMS SDK wrapper. Not named in the Plan layout; reconcile per IMPL-ARCH-009.
- **Risk:** Inline SDK calls scattered across the server make the export-format adapters and storage clients hard to swap per customer payroll system, undermining the "no manual reformatting" export requirement.

### IMPL-ARCH-021: auth-in-server-middleware

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Authn/authz as `/apps/server` middleware; no auth logic in the client bundle. The Plan implements WebAuthn passkey assertion plus six application roles enforced in middleware and session-cookie JTI revocation — exactly this rule.
- **Risk:** Any authorization decision made client-side would let producers/partners bypass the §9 confidentiality scoping and view other parties' payouts or firm financials.

### IMPL-ARCH-022: dependency-dual-threshold

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Add a dependency only if (1) critical and not feasible internally AND (2) mature/minimal/maintained. For this project: Buy = GCP Cloud KMS SDK, WebAuthn library, Playwright, a mature payroll-format/CSV and billing SDK class (Stripe-style). DIY = the commission rules engine, split-attribution model, explainability, audit ledger, date math (date-fns-class), small UI components.
- **Risk:** Treating the commission/clawback domain logic as a buyable dependency would forfeit control over the core differentiator and its auditability; conversely, hand-rolling crypto/KMS would be a security liability.

### IMPL-ARCH-023: dependency-doc-required

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Every dependency documented in `docs/dependencies.md` with risk/benefit, locked versions, and periodic transitive-tree review. Especially important for the KMS, WebAuthn, and any AR/ATS SDKs handling financial and PII data.
- **Risk:** Undocumented/unpinned dependencies in a system holding compensation and PII data create audit and supply-chain exposure inconsistent with the §9 audit/compliance constraint.

### IMPL-ARCH-024: antipattern-type-duplication

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Never redefine a response type in both `apps/web` and `apps/server`; import from `/packages/core`. Directly protects the payout-derivation contract shared between the producer portal and the server calculation.
- **Risk:** Duplicated types drift silently — a stale field in the portal would misstate a producer's commission, the exact opacity/trust failure the product exists to eliminate.

### IMPL-ARCH-025: antipattern-dependency-by-default

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Do not reflexively npm-install for every solved problem; evaluate building an internal, tested version first. Reinforces DIY for commission math, attribution, explainability, CSV import/export helpers.
- **Risk:** Dependency bloat increases maintenance and audit burden on a financial system and risks pulling unvetted transitive code into a compliance-sensitive codebase.

### IMPL-ARCH-026: antipattern-implicit-build-coupling

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** No shared `tsconfig.json` or build step between server and client; independent builds from day one. Server config changes must not affect the client build.
- **Risk:** Implicit coupling lets a server-side change weaken the browser-only bundle boundary (IMPL-ARCH-010), which is the enforcement mechanism for confidentiality scoping.

## Recommended Technology Choices

- **TypeScript everywhere**, no plain JS — single type system across web/server/worker/packages. (IMPL-ARCH-001)
- **Bun** as runtime and build tool; no Node.js. (IMPL-ARCH-002)
- **React (latest stable)** for all role-scoped UI surfaces. (IMPL-ARCH-003)
- **Vanilla Tailwind CSS** only, no CSS pipeline. (IMPL-ARCH-004)
- **React hooks + minimal context** for client state; no Redux/MobX/Zustand. (IMPL-ARCH-005)
- **Vitest** for unit tests (esp. the commission rules engine) in `/tests/unit`. (IMPL-ARCH-006)
- **Playwright** for E2E (approval-gated close, payroll export, producer portal) in `/tests/e2e`; also a sanctioned Buy. (IMPL-ARCH-007, -022)
- **REST APIs** for all ATS/CRM, AR, payroll-export, and document-storage integrations; no GraphQL/WebSockets/Protobuf. (IMPL-ARCH-008, -013, -015)
- **Shared domain + API types in `/packages/core`**, imported by web, server, and worker. (IMPL-ARCH-014, -018, -024)
- **Versioned, type-checked API contracts**, aligned with the PRD plan-version model. (IMPL-ARCH-016)
- **Ingestion/integration REST clients in `/packages/services` and `/packages/integrations`** — ATS/CRM import, AR import, payroll-export adapters, document storage and KMS SDK wrappers. (IMPL-ARCH-017, -020)
- **Shared UI in `/packages/ui`; role workspaces in `/apps/web`.** (IMPL-ARCH-019)
- **Auth as Bun server middleware** (WebAuthn passkeys + six roles + session JTI revocation); zero auth in the client bundle. (IMPL-ARCH-021)
- **Browser-only web bundle and Bun-binary-only server**, with separate CI pipelines and no shared tsconfig. (IMPL-ARCH-010, -011, -012, -026)
- **Buy:** GCP Cloud KMS, WebAuthn library, Playwright, mature billing/CSV/export SDK class. **DIY:** commission rules engine, split attribution, explainability, audit ledger, date utilities, small UI components. (IMPL-ARCH-022, -025)
- **`docs/dependencies.md`** with risk/benefit justification, locked versions, periodic transitive review. (IMPL-ARCH-023)
- **Reconcile layout deviation:** map the Plan's `apps/worker` and `packages/db` onto the blueprint's fixed layout and place ingestion/integration code in `packages/services`/`packages/integrations`. (IMPL-ARCH-009)

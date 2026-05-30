# Blueprint: ARCH — Architecture Research

**Source:** blueprint/rules/blueprints/arch.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

For this project the most load-bearing rules are the runtime-separation and monorepo-structure family (ARCH-D-001, ARCH-D-003, ARCH-A-001/A-002, ARCH-P-001, ARCH-P-002) and the type-safe-contract family (ARCH-D-004, ARCH-T-004, ARCH-T-008, plus the typed-endpoint checklists). The Plan already commits to a Bun workspace monorepo with `apps/server`, `apps/web`, `apps/worker`, `packages/core`, `packages/db`, and `packages/ui`, which is a direct instantiation of the multi-app monorepo architecture (ARCH-A-002) extended beyond the canonical single-product layout (ARCH-A-001). Because this is multi-tenant commission/financial software with strict per-role and per-tenant confidentiality requirements (PRD §9 Visibility and Confidentiality), the threat rules about server code leaking into the browser bundle (ARCH-T-001) and contract drift (ARCH-T-004/T-008) carry elevated risk: a leaked server module could expose KMS-decrypted financial fields or another producer's payout, and a silent contract change could mis-state money owed. The dependency-minimalism rules (ARCH-P-003, ARCH-D-002, ARCH-T-005/T-006) reinforce the Plan's explicit choice to build auth (WebAuthn), field encryption, and the task queue in-house rather than pulling broad frameworks, while still buying narrow, high-assurance primitives (Cloud KMS SDK, WebAuthn crypto). The structure must also remain legible to the agents building it across many sessions (ARCH-P-002, ARCH-P-005), which the boring, explicitly-named workspace layout satisfies.

## Rule Analysis

### ARCH-T-001: server-code-in-browser-bundle

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** `apps/web` (browser bundle) must never resolve an import into `apps/server`, `packages/db`, or the FieldEncryptor/KMS code. Enforce via separate Bun build configs and an import boundary so DB roles (`app_rw`), KMS keys, and session secrets cannot reach the client. Shared data shapes go through `packages/core` only.
- **Risk:** Leaking server code into the browser would expose KMS access, DB credentials, or decrypted financial fields (commission amounts, draw balances) — a direct breach of the confidentiality constraint (PRD §9) and the audit/compliance model.

### ARCH-T-002: browser-code-on-server

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** `apps/server` and `apps/worker` (Bun runtimes) must not import DOM/React/browser-only code from `apps/web` or `packages/ui`. Build/lint must fail on DOM imports in server entry points.
- **Risk:** Untrusted client logic running in the trusted server context (which holds DB write roles and KMS keys) could bypass RBAC and approval gates that gate money reaching payroll (PRD §9).

### ARCH-T-003: agent-places-code-wrong-directory

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The fixed Bun workspace layout (`apps/{server,web,worker}`, `packages/{core,db,ui}`) must unambiguously encode where each kind of code lives so the many agents building Phases 1–7 place new modules consistently.
- **Risk:** Inconsistent placement across the seven-phase, multi-agent build produces drift and duplicated logic in the commission engine and ledger, raising the cost of every later session.

### ARCH-T-004: shared-types-drift

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Domain types for placements, commissions, invoices, draws, exceptions, and plan versions must have a single source of truth in `packages/core`, imported by server, worker, and web. No duplicated hand-maintained shapes.
- **Risk:** Drift in financial domain types could mis-state commission bases, splits, or payout amounts and corrupt the payroll export and audit trail — directly violating explainability and audit constraints (PRD §9).

### ARCH-T-005: trivial-dependency-addition

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Build trivial utilities (date math for guarantee windows, percentage/split arithmetic, CSV mapping helpers) internally with tests rather than installing packages. Reserve dependencies for genuinely hard primitives.
- **Risk:** Each casual dependency is a supply-chain node touching financial data; uncontrolled additions enlarge the attack surface of a system holding compensation records.

### ARCH-T-006: deep-transitive-dependency-tree

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Prefer minimal, shallow dependencies. Audit the tree (ARCH-C-013) given the distroless/k3s deployment target where a small, auditable surface is a hard requirement.
- **Risk:** A deep transitive tree introduces unaudited vulnerabilities into a financial, multi-tenant system and bloats the distroless container the Plan commits to.

### ARCH-T-007: unbounded-package-creation

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The Plan fixes the package set (`core`, `db`, `ui`) plus apps; new packages require documented non-overlapping responsibility (ARCH-C-014). The commission rules engine, ledger, and explainability logic belong inside existing packages/apps, not new ad-hoc packages.
- **Risk:** Proliferating packages during the seven-phase build fragments business logic and makes the commission engine harder to reason about and audit.

### ARCH-T-008: api-contract-change-without-consumer-update

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** REST endpoint request/response types live in `packages/core`; integration tests validate live responses against them (ARCH-C-011). Server, worker, and web all consume the canonical types so a breaking change forces a compile error.
- **Risk:** An unsynchronized contract change between the producer portal and the calculation API could silently misreport payout figures, undermining producer self-service explainability (PRD §5.8, §9).

### ARCH-T-009: unnavigable-monorepo-structure

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Keep the workspace flat and obvious (apps + packages + tests + docs); no deep nesting or dynamic resolution. An agent must locate any of the lifecycle modules in seconds.
- **Risk:** A hard-to-navigate tree slows every agent session across a large seven-phase scope and invites misplacement.

### ARCH-P-001: boundaries-are-physical-not-conceptual

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Separate Bun build pipelines for `apps/web` vs `apps/server`/`apps/worker`; a client import reaching a server module must fail at build time, not runtime. CI runs separate build steps (ARCH-C-006).
- **Risk:** Conceptual-only boundaries eventually leak server secrets/financial data into the browser; the physical boundary is what protects the confidentiality and audit constraints.

### ARCH-P-002: directory-tree-is-architecture-diagram

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** The top-level tree must answer at a glance: deployables = `apps/{server,web,worker}`; shared contracts = `packages/core`; data access = `packages/db`; UI = `packages/ui`; tests and docs in their own roots. Document it in docs/architecture.md (ARCH-C-020).
- **Risk:** If the tree doesn't encode these answers, agents invent their own placement rules during the multi-phase build and structure degrades.

### ARCH-P-003: dependencies-are-liabilities

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Justifies the Plan's build-it-yourself stance: in-house WebAuthn flow, FieldEncryptor, and PostgreSQL task queue rather than heavyweight auth/job frameworks. Maintain docs/dependencies.md with Buy/DIY rationale (ARCH-C-005).
- **Risk:** Excess dependencies in a financial, distroless-deployed system raise audit and security burden disproportionate to time saved.

### ARCH-P-004: types-shared-logic-not

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Share only type/enum definitions through `packages/core` (placement states, commission states, role enums). Commission calculation logic, rendering, and DB access are NOT shared across the client-server boundary — calculation stays server/worker side. Accept duplicated trivial utilities over a shared runtime utils package.
- **Risk:** Sharing calculation logic across runtimes risks the client computing payout figures differently from the server of record, breaking the single source of truth for money owed.

### ARCH-P-005: simplicity-scales-cleverness-does-not

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Favor the boring, explicitly-named workspace already chosen; avoid auto-generated barrels, dynamic module resolution, or clever abstractions in the rules engine and ledger.
- **Risk:** Clever implicit structure breaks down under the scale of a seven-phase, multi-agent financial product and increases navigation cost.

### ARCH-D-001: strict-runtime-separation

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Three runtime entry points (`apps/server`, `apps/web`, `apps/worker`) with separate build configs; `packages/core` holds only type definitions, no runtime code. No client import path resolves into a server directory. Duplicate small utilities rather than create a shared runtime utils package.
- **Risk:** Without enforced separation, server-only KMS/DB code or another producer's data could ship to the browser, violating PRD §9 confidentiality.

### ARCH-D-002: buy-vs-diy-decision-framework

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Apply the two-question test and document each decision (ARCH-C-005). DIY: split/commission arithmetic, CSV import mapping, completeness validation, task queue. Buy: GCP Cloud KMS SDK, WebAuthn cryptographic primitives, PostgreSQL driver — mature primitives infeasible to safely build.
- **Risk:** Mis-building a security primitive (e.g., crypto for field encryption) is dangerous; mis-buying a trivial helper bloats the audit surface. The documented framework keeps both in check.

### ARCH-D-003: monorepo-explicit-package-boundaries

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Fixed top-level set: deployables in `apps/`, shared libraries in `packages/`, tests in `/tests`. New packages only with documented, non-overlapping responsibility (ARCH-C-017, C-014). `packages/db` owns data access; `packages/core` owns domain types/logic boundaries.
- **Risk:** Bending existing packages to hold unrelated commission/ledger code creates ambiguity that compounds across phases.

### ARCH-D-004: type-safe-api-contracts

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Define REST contracts as TypeScript types in `packages/core`; both web/worker and server import them; integration tests assert live responses match (ARCH-C-007, C-010, C-011); strict TS, no `any` (ARCH-C-012); version contracts (ARCH-C-019).
- **Risk:** Untyped or drifting contracts in a money-bearing API could misreport commission amounts to producers and finance and corrupt the payroll export.

### ARCH-A-001: monorepo-collocated-packages

- **Type:** architecture
- **Applicable:** partial
- **Technology implication:** The canonical single-product layout (`/apps/web`, `/apps/server`, `/packages/core`, `/packages/ui`, `/tests`, `/docs`) is the baseline this project follows, with single shared versioning. The project extends it with `apps/worker` and `packages/db`, moving toward ARCH-A-002.
- **Risk:** N/A — the project is a superset; the relevant risk is covered by ARCH-A-002 and the structure rules.

### ARCH-A-002: multi-app-monorepo

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** Best match for the Plan: multiple deployable apps (`apps/server`, `apps/web`, `apps/worker` ≈ server-api + web + server-jobs) over shared packages (`packages/core` = shared-types/core, `packages/db` = db, `packages/ui` = ui-kit), each built/deployed independently with distroless containers on k3s. Maintain package boundaries carefully.
- **Risk:** If shared packages aren't disciplined, the three apps drift; careful boundary maintenance is what keeps the worker, server, and web consistent on commission state.

### ARCH-A-003: polyrepo-shared-types

- **Type:** architecture
- **Applicable:** no
- **Technology implication:** Not applicable — the Plan commits to a single Bun workspace monorepo, not separate Web/API/Types repos. Cross-repo coordination cost is unwarranted for a one-to-few-agent single product.

### ARCH-C-001: repo-structure-initialized

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Initialize the Bun workspace with `apps/web`, `apps/server` (plus `apps/worker`), `packages/core`, `packages/ui` (plus `packages/db`), and `/tests` — exactly the Phase 1 "Monorepo scaffold" task.
- **Risk:** Missing baseline structure forces ad-hoc placement from the first commit.

### ARCH-C-002: web-no-server-imports

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `apps/web` browser bundle must build with zero server imports resolving; enforce in CI.
- **Risk:** A resolving server import would ship KMS/DB/secrets to the browser.

### ARCH-C-003: server-no-browser-imports

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `apps/server` (and `apps/worker`) must build and start on Bun with no browser/DOM imports resolving.
- **Risk:** DOM code in the trusted server runtime indicates a broken boundary that can bypass RBAC/approval gates.

### ARCH-C-004: shared-types-in-packages-core

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Define shared TS types (placement, commission, invoice, plan-version, role enums) in `packages/core`, imported by both apps.
- **Risk:** Types defined elsewhere drift between server and producer portal, misreporting money.

### ARCH-C-005: dependency-justification-documented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Create docs/dependencies.md listing every dependency with a Buy/DIY justification (KMS SDK, WebAuthn libs, pg driver, etc.).
- **Risk:** Undocumented dependencies in financial software are an unaccountable audit/supply-chain liability.

### ARCH-C-006: ci-separate-build-steps

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** The Phase 1 GitHub Actions CI must run separate build steps for web and server (and worker), aligning with the per-suite workflows already planned (quality-gate, test-unit, test-api, test-migration, container build).
- **Risk:** A shared build step can mask boundary violations between client and server.

### ARCH-C-007: typed-rest-endpoint

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** At least one REST endpoint with typed request/response matching `packages/core` types — e.g., the placement or commission-run endpoints.
- **Risk:** Untyped endpoints invite contract drift in money-bearing APIs.

### ARCH-C-008: vitest-configured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Configure Vitest for unit tests (the Plan's `test-unit` suite), covering the commission arithmetic and validation logic.
- **Risk:** Untested calculation logic risks incorrect payouts; omit only if a different unit runner is adopted, but a runner is required.

### ARCH-C-009: playwright-configured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Configure Playwright for headless browser tests of the web app (producer portal, finance review queue, sign-in/passkey UX).
- **Risk:** Without e2e coverage, role-scoped visibility and approval-gate UI regressions go undetected.

### ARCH-C-010: all-endpoints-typed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Every API endpoint gets corresponding `packages/core` types as the API surface grows across Phases 2–7.
- **Risk:** Any untyped endpoint becomes a drift vector for financial data.

### ARCH-C-011: integration-tests-validate-types

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** The `test-api` suite must assert live API responses match shared types.
- **Risk:** Without runtime validation, server responses can diverge from declared types and misreport amounts.

### ARCH-C-012: no-any-in-api-contracts

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Enforce strict TypeScript with no `any` in API contracts across the workspace.
- **Risk:** `any` in a commission/payout contract erases the compile-time guarantees protecting money math.

### ARCH-C-013: dependency-tree-audited

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Audit the dependency tree for unnecessary transitive deps — important for the distroless image and financial-data security posture.
- **Risk:** Unaudited transitive deps introduce vulnerabilities into a system holding compensation records.

### ARCH-C-014: new-package-requires-justification

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Any package beyond `core`/`db`/`ui` requires documented justification in docs/dependencies.md.
- **Risk:** Unjustified packages fragment the codebase across the seven-phase build.

### ARCH-C-015: build-times-under-thirty-seconds

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Measure build times; keep each step under 30s. Bun's fast builds and minimal dependencies support this.
- **Risk:** Slow builds tax every agent iteration; mainly a velocity (not correctness) risk.

### ARCH-C-016: decoupling-test-passed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Architecture docs must keep Principles/Patterns vendor-agnostic — removing Bun/React/Tailwind references should leave them intact. The blueprint principles here are already framework-neutral.
- **Risk:** Vendor-coupled principles rot when the stack evolves.

### ARCH-C-017: packages-have-documented-responsibilities

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Document non-overlapping responsibilities for `apps/server`, `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/ui` in docs/architecture.md.
- **Risk:** Overlapping responsibilities (e.g., DB access in both `core` and `db`) create ambiguity that compounds across agents.

### ARCH-C-018: zero-unused-dependencies

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Keep package.json / bun.lockb free of unused dependencies.
- **Risk:** Dead dependencies bloat the audit and supply-chain surface of financial software.

### ARCH-C-019: api-contract-versioning

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Version API contracts so breaking changes force type updates and consumer fixes — pairs with the audit/versioning needs of plan versions and ledger immutability (PRD §9).
- **Risk:** Unversioned breaking changes silently break the producer portal and payroll export consumers.

### ARCH-C-020: repo-structure-documented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Document the repository structure in docs/architecture.md and keep it matching the actual tree.
- **Risk:** Doc/tree drift misleads agents about where code belongs.

### ARCH-X-001: shared-utils-junk-drawer

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Do NOT create `packages/utils` or `lib/helpers`. Cohesive helpers belong in the package that owns the domain (e.g., commission math in the calculation module, DB helpers in `packages/db`).
- **Risk:** A junk-drawer package accumulates unrelated logic across phases and erodes boundaries.

### ARCH-X-002: import-path-acrobatics

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Use Bun workspace aliases (e.g., `@core/...`, `@db/...`) instead of deep `../../../` relative paths.
- **Risk:** Deep relative imports obscure code location and make refactoring across the large workspace error-prone.

### ARCH-X-003: server-code-in-browser-bundle

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Never import a server utility "just for one function" into `apps/web`; duplicate the trivial helper instead. Reinforces ARCH-D-001/ARCH-C-002.
- **Risk:** The bundler pulls the whole server module, potentially shipping KMS/DB code or decrypted financial data to the browser.

### ARCH-X-004: premature-microservices

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Keep the single monorepo with three collocated apps; do not split the commission domain into separate deployed services before boundaries are proven. The `apps/worker` split is justified by a distinct runtime/isolation need (network-isolated job execution), not premature decomposition.
- **Risk:** Premature service splitting adds deployment, monitoring, and contract overhead with no benefit while the domain boundaries are still being discovered across phases.

## Recommended Technology Choices

- **Multi-app Bun workspace monorepo** with `apps/server`, `apps/web`, `apps/worker` and shared `packages/core`, `packages/db`, `packages/ui` — single versioning, independently buildable/deployable apps (ARCH-A-002, ARCH-D-003, ARCH-A-001).
- **Strict physical runtime separation** with three entry points and separate Bun build configs; client builds fail on any server import (ARCH-D-001, ARCH-P-001, ARCH-C-002, ARCH-C-003, ARCH-C-006).
- **`packages/core` as the single source of truth for domain types and API contracts**, type-only with no runtime code; calculation logic stays server/worker-side (ARCH-P-004, ARCH-D-004, ARCH-C-004, ARCH-C-010).
- **Strict TypeScript, no `any` in contracts, versioned contracts, and integration tests asserting live responses match shared types** (ARCH-C-011, ARCH-C-012, ARCH-C-019, ARCH-T-008).
- **Vitest for unit tests and Playwright (headless) for browser/e2e tests** (ARCH-C-008, ARCH-C-009).
- **Build-it-yourself for auth (WebAuthn flow), field encryption (FieldEncryptor), task queue, split/commission arithmetic, and CSV import mapping**; buy only narrow primitives — GCP Cloud KMS SDK, WebAuthn cryptographic libs, PostgreSQL driver (ARCH-P-003, ARCH-D-002, ARCH-T-005).
- **docs/dependencies.md with Buy/DIY justification for every dependency and every package**, plus an audited, minimal, shallow dependency tree suited to distroless containers (ARCH-C-005, ARCH-C-013, ARCH-C-014, ARCH-C-018, ARCH-T-006).
- **Workspace import aliases (e.g., `@core`, `@db`) — no deep relative paths and no `packages/utils` junk drawer** (ARCH-X-001, ARCH-X-002).
- **docs/architecture.md documenting the directory tree and each package's non-overlapping responsibility, kept in sync with the actual tree** (ARCH-P-002, ARCH-C-017, ARCH-C-020).
- **Single monorepo (no polyrepo, no premature microservices)**; the `apps/worker` split is justified only by its network-isolation requirement (ARCH-A-003 rejected, ARCH-X-004).

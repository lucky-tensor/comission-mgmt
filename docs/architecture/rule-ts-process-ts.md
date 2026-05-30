# Blueprint: IMPL-PROCESS — Architecture Research

**Source:** blueprint/rules/implementations/ts/process-ts.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint governs the *development process and orchestration surface* (Calypso) rather than the product runtime. Its rules constrain how planning state is stored (GitHub Issues, not repo files), how features are partitioned (one feature = one branch = one worktree = one PR), how the agent workflow advances (a tracked YAML state machine with grouped gates and a typed task catalog), and how documentation is merged conflict-free. For this project the most load-bearing rules are IMPL-PROCESS-001/013/014 (issue-based living plan — directly realized by the phased `docs/plan.md` and its GitHub tracking issue), IMPL-PROCESS-019 (scaffold-before-features — exactly the Phase 1 Foundation issue), IMPL-PROCESS-012-A (PRD must carry per-goal state machines — already satisfied by §6 Entity Lifecycle), and IMPL-PROCESS-007 (gh CLI as the GitHub control surface). None of these rules introduce product runtime technology choices; they prescribe tooling for the build pipeline: `gh` CLI, git worktrees, GitHub Actions CI, git hooks, and `.gitattributes`. The chief technology implication is that the commission platform must be developed under a Calypso-orchestrated, issue-driven workflow with a tracked workflow YAML and a scaffold-complete-first Foundation phase — which the existing plan already reflects.

## Rule Analysis

### IMPL-PROCESS-001: github-issues-based-planning

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Planning state lives in GitHub Issues, not repo files. The Implementation Plan is a never-closing GitHub tracking issue with phases and feature-issue links; feature issues use structured sections (Motivation, Features, Test Plan, Stage). `docs/plan.md` is the phased source that must be mirrored into this tracking issue and per-feature issues; the markdown file is a working draft, not the canonical planning state.
- **Risk:** If the plan stays only in `docs/plan.md`, the orchestrator and agents lose the canonical, query-able planning state, breaking issue-driven advancement and leaving phase progress (Foundation → Leadership Visibility) untracked.

### IMPL-PROCESS-002: workflow-state-machine-definition

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** A Calypso feature workflow must be declared in YAML at `agent-context/workflows/calypso-default-feature-workflow.yaml` with states new, prd-review, architecture-plan, scaffold-tdd, implementation, qa-validation, ready-for-review, done plus recovery states waiting-for-human, blocked, aborted. This is process infrastructure; the plan does not yet name this file but its phased TDD-gated execution depends on such a workflow existing.
- **Risk:** Without the declared workflow YAML, feature lifecycle transitions are ad hoc; QA-validation and ready-for-review gates that protect commission-correctness changes cannot be enforced.

### IMPL-PROCESS-003: feature-unit-invariant

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** One feature = one branch = one worktree = one pull request, enforced by the CLI. Each plan checkbox (e.g., "Commission calculation engine", "Payroll-ready export") maps to a single feature issue, branch, worktree, and PR. Requires git worktree support in the dev environment.
- **Risk:** Bundling multiple plan items into one branch/PR defeats reviewability and gate evaluation, raising the chance of an unreviewed change reaching the commission-calculation or payroll-export paths.

### IMPL-PROCESS-004: single-orchestrator-per-repo

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Exactly one Calypso orchestrator (the CLI) per repository owns workflow state, task dispatch, gate evaluation, and operator interaction; it is not the coding agent. The monorepo (apps/server, apps/web, apps/worker, packages/*) is driven by a single orchestrator instance.
- **Risk:** Multiple orchestrators against one repo would produce conflicting workflow-state mutations and racing PRs, corrupting the issue-based plan state.

### IMPL-PROCESS-005: early-pull-request-creation

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** PRs are opened early in the feature lifecycle, not deferred to completion. Pairs with GitHub Actions CI (Phase 1 CI pipeline) so per-suite checks run continuously against an open PR.
- **Risk:** Late PR creation hides CI failures (quality-gate, test-unit, test-api, test-migration) until the end, delaying detection of regressions in financial logic.

### IMPL-PROCESS-006: structured-agent-outcomes

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Agent tasks must return only OK, NOK, or ABORTED. This is an orchestration contract consumed by the CLI's gate evaluation; no product runtime impact.
- **Risk:** Non-standard agent results break gate evaluation and automatic workflow advancement.

### IMPL-PROCESS-007: gh-as-github-surface

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The `gh` CLI is the required control surface for all GitHub operations (issue creation, PR management, labels, checks). Mandates `gh` in the dev/CI toolchain; the plan's "git init + gh repo create" scaffold step already aligns.
- **Risk:** Using the raw REST API or web UI instead of `gh` diverges from the orchestrator's expected surface and breaks reproducible automation.

### IMPL-PROCESS-008: cli-tui-operator-surfaces

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** CLI and TUI are the primary operator surfaces for interacting with Calypso. This is the developer/operator interface for the build process, distinct from the product's web app (apps/web). No product runtime implication.
- **Risk:** N/A for product behaviour; absence would only reduce build-time operability.

### IMPL-PROCESS-009: gate-groups

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Workflow gates are grouped into specification, implementation, validation, and merge-readiness; each gate records task, owner role, status source, blocking behavior, and checklist label. These map onto the plan's CI suites and approval gates (manager split approval, finance commission-run approval) at the workflow level, and onto branch-protection requiring all checks green.
- **Risk:** Without grouped, blocking gates, an approval-gated product (no commission to payroll without explicit approval) could ship code that bypasses its own validation gates.

### IMPL-PROCESS-010: task-catalog

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The workflow declares a task catalog of three kinds — builtin (doctor-clean, feature-unit-bound, workflow-files-present, rust-quality, test-matrix, main-compatibility), agent (pr-editor, documentation-merge, blueprint-review), and human (human-clarification, human-review-approval). Note the builtin set includes `rust-quality`, which does not apply to this TypeScript/Bun project; the TS quality equivalent (lint/format/test via the CI suites) substitutes. test-matrix maps to the plan's per-suite GitHub Actions (test-unit, test-api, test-migration).
- **Risk:** Missing builtin tasks (e.g., main-compatibility, feature-unit-bound) would let branches drift from main or violate the one-feature-one-PR invariant before merge.

### IMPL-PROCESS-011: agent-prompt-catalog

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Agent-backed tasks have stable prompt contracts: pr-editor (keep PR description aligned with feature state), documentation-merge (semantic doc reconciliation), blueprint-review (detect drift from blueprint rules). Prompts are short role-specific intents wrapped with context by the CLI. blueprint-review is relevant because this repo vendors a blueprint under `.agents/blueprint`.
- **Risk:** Without blueprint-review, drift between the vendored blueprint rules and the implementation goes undetected.

### IMPL-PROCESS-012: requirements-interview-output

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** A structured product-owner interview (template in product-owner-interview.md) produces the Implementation Plan GitHub Issue and initial Feature Issues. The existing `docs/prd.md` (rich PRD with roles, user stories, workflows, lifecycle) is the realized interview output and seeds the plan's feature issues.
- **Risk:** If feature issues are not derived from the PRD's workflows/constraints, implementation can omit governed requirements (audit trail, explainability, completeness gating).

### IMPL-PROCESS-012-A: prd-userflow-state-machines

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The PRD must include a state machine per user goal — entry/exit conditions, intermediate states, transitions, feedback, and edge-case recovery — formalized before implementation (UX Pattern 1: Service Flow Mapping). The PRD §6 Entity Lifecycle already specifies state machines for Placement, Commission, Invoice, Guarantee Period, Draw Balance, Exception, and Plan Version, including alternate/recovery paths (Refunded, Disputed, Clawback, Forgiven). These directly drive the data model and the worker's event-driven recalculation jobs.
- **Risk:** Implementing commission/guarantee/clawback transitions without the formalized state machines risks invalid state jumps (e.g., paying a Held commission, or skipping the guarantee window), corrupting the auditable economic record the product promises.

### IMPL-PROCESS-013: implementation-plan-format

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The Implementation Plan Issue uses phase headings with feature links in `- [ ] #<issue> Feature Name` checkbox format, updated at every commit for both discovery (new linked issues) and completion (checked boxes). `docs/plan.md`'s seven phases and checkbox feature lists must be rendered into this issue body and kept live.
- **Risk:** A stale plan issue misdirects agent priorities — e.g., starting Phase 3 calculation work before Phase 1 Foundation (schema, encryption, auth) is complete.

### IMPL-PROCESS-014: feature-issue-next-action-encoding

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Feature issue descriptions encode the next action via a Stage field and explicit next steps; updating the issue (checking features, updating stage, adding test results) narrates progress and replaces any next-prompt file. Each commission feature issue carries its own Stage to drive self-advancing execution.
- **Risk:** Without next-action encoding in issues, the self-advancing state machine stalls and requires manual prompting between stages.

### IMPL-PROCESS-015: pre-commit-hook-plan-enforcement

- **Type:** implementation (DEPRECATED)
- **Applicable:** no
- **Technology implication:** Deprecated. The git pre-commit hook must NOT enforce planning-file requirements (planning moved to GitHub Issues); the hook is limited to code-quality gates (lint, format, tests). Informs how the Phase 1 pre-commit/CI hooks are configured — quality only, no plan-file checks.

### IMPL-PROCESS-016: documentation-merge-gitattributes

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** `.gitattributes` must mark documentation files (`*.md`, `*.rst`, `*.txt`) with `merge=binary` to prevent automatic line-level merges. Required repo file given the doc-heavy `docs/` tree (prd.md, plan.md, architecture/*).
- **Risk:** Line-level auto-merges of the PRD/plan/architecture docs across concurrent feature branches produce silently corrupted requirements documents.

### IMPL-PROCESS-017: documentation-merge-conflict-check

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** `.githooks/pre-commit` must scan staged documentation files and block commits containing merge-conflict markers. Pairs with IMPL-PROCESS-016 and the Phase 1 git-hook setup.
- **Risk:** Committed conflict markers in PRD/plan corrupt the canonical requirements and can propagate into the GitHub plan issue.

### IMPL-PROCESS-018: documentation-merge-protocol

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Documentation merges follow a protocol: read older and newer docs, produce one coherent result, prefer the newer when uncertain; agent resolution (documentation-merge task) is mandatory for agent-maintained docs. Governs how `docs/` is reconciled across feature branches.
- **Risk:** Naive merges lose intentional updates to governed requirements (audit, explainability, confidentiality constraints), weakening the spec the implementation is validated against.

### IMPL-PROCESS-019: scaffold-checklist

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Stage 0 scaffold must: git init + gh repo create; create `.github/workflows/` CI jobs; stub all test suites (server unit, integration, browser unit, component, e2e); verify all tests run and fail; write the initial implementation plan. This is precisely the Phase 1 Foundation issue (monorepo scaffold, CI pipeline, stubbed suites mapped to test-unit/test-api/test-migration/container build). Mandates GitHub Actions CI and a full failing-test scaffold before feature work.
- **Risk:** Building commission features before the scaffold (three-DB schema, encryption, auth, CI) means later modules have no tested foundation, and financial logic ships without the test matrix that guards it.

### IMPL-PROCESS-020: no-runtime-dependencies

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The process implementation introduces no runtime dependencies — Calypso/process tooling must not add libraries to the product's runtime dependency set. The commission platform's runtime stack (Bun, PostgreSQL 16 driver, WebAuthn, KMS client) stays free of process/orchestration packages.
- **Risk:** Leaking orchestration tooling into the product runtime bloats the distroless container image and expands the production attack surface for a financial system.

### IMPL-PROCESS-021: workflow-yaml-tracked-artifact

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The Calypso workflow YAML is a tracked repository artifact (committed under `agent-context/workflows/`), not an ephemeral CLI cache. Must be version-controlled alongside the code.
- **Risk:** An untracked workflow definition makes gate/state behaviour non-reproducible across machines and PRs, undermining auditability of how changes were validated.

## Recommended Technology Choices

- **GitHub Issues as canonical planning store** — a never-closing Implementation Plan tracking issue plus structured per-feature issues, mirroring `docs/plan.md`'s seven phases (IMPL-PROCESS-001, IMPL-PROCESS-012, IMPL-PROCESS-013, IMPL-PROCESS-014).
- **`gh` CLI as the sole GitHub control surface** for issues, PRs, labels, and checks in dev and CI (IMPL-PROCESS-007).
- **Git worktrees with a one-feature/one-branch/one-worktree/one-PR model** enforced by the orchestrator CLI (IMPL-PROCESS-003, IMPL-PROCESS-004).
- **Calypso workflow state machine in tracked YAML** at `agent-context/workflows/calypso-default-feature-workflow.yaml`, with grouped gates and a typed task catalog (IMPL-PROCESS-002, IMPL-PROCESS-009, IMPL-PROCESS-010, IMPL-PROCESS-021).
- **GitHub Actions CI with stubbed, initially-failing test suites created at scaffold time** — quality-gate, test-unit, test-api, test-migration, container build — before any feature work; the Phase 1 Foundation issue is this scaffold (IMPL-PROCESS-005, IMPL-PROCESS-019).
- **Quality-only git hooks** (`.githooks/pre-commit` for lint/format/tests and doc conflict-marker scanning), with no planning-file enforcement (IMPL-PROCESS-015, IMPL-PROCESS-017).
- **`.gitattributes` with `merge=binary` for `*.md`/`*.rst`/`*.txt`** plus agent-driven documentation-merge resolution for the `docs/` tree (IMPL-PROCESS-016, IMPL-PROCESS-018).
- **Agent task prompt catalog** including a blueprint-review task to detect drift against the vendored `.agents/blueprint` rules (IMPL-PROCESS-011, IMPL-PROCESS-006).
- **Formalized PRD state machines preceding implementation** — the PRD §6 entity lifecycles (Placement, Commission, Invoice, Guarantee, Draw, Exception, Plan Version) are the authoritative source for the data model and worker recalculation jobs (IMPL-PROCESS-012-A).
- **No process/orchestration packages in the product runtime** — keep the Bun/PostgreSQL/WebAuthn/KMS distroless image free of build-time tooling (IMPL-PROCESS-020).

> Note: the `rust-quality` builtin task named in IMPL-PROCESS-010 does not apply to this TypeScript/Bun project; the TS quality gate (lint/format/test via the CI suites) is the equivalent.

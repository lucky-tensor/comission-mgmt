# Blueprint: IMPL-TEST (Testing — TypeScript Implementation) — Architecture Research

**Source:** blueprint/rules/implementations/ts/test-ts.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint pins the entire TypeScript testing stack for the project to a single driver — Vitest — with Playwright as a browser provider, ESLint and Prettier as quality tooling, and a per-suite GitHub Actions CI topology. The most load-bearing rules for this project are the ones that govern integration testing against real systems (IMPL-TEST-005, -016, -017, -024) and the CI/merge-gate topology (IMPL-TEST-008 through -012, -029), because the product is an auditable financial ledger built on three PostgreSQL 16 databases with a claim-execute-submit task queue and field-level encryption (per the Plan's Phase 1 Foundation). Commission correctness, collection gating, and clawback recalculation are exactly the kind of stateful, multi-database, money-touching behaviour that must be tested against real Postgres containers with dynamically allocated ports rather than mocks or fixed URLs. The browser-fidelity rules (IMPL-TEST-002, -006, -007, -018, -027) apply to the producer portal, finance review queue, and executive dashboard React surfaces. The fixture-recorder and golden-fixture rules (IMPL-TEST-013, -014, -025) map directly onto the ATS/CRM, AR/invoice, payroll-export, and KMS integration boundaries. The Plan already commits to a per-suite CI workflow shape (quality-gate, test-unit, test-api, test-migration, container build), which is consistent with this blueprint and confirms Vitest + per-suite workflows as the mandated choice.

## Rule Analysis

### IMPL-TEST-001: vitest-single-driver

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Vitest is the sole test runner for all TS test categories (unit, API integration, component, E2E). Jest, Mocha, and a standalone Playwright runner are forbidden. The Plan's per-suite CI (test-unit, test-api, test-migration) must all be Vitest-driven.
- **Risk:** Adopting a second runner fragments lifecycle/setup logic across the commission engine, ledger, and portal suites, making it impossible to share the real-Postgres setup that the financial correctness tests require.

### IMPL-TEST-002: playwright-browser-provider

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Playwright is used only as a headless Chromium provider under Vitest, never as a top-level runner. Applies to the React surfaces in the Plan: producer payout portal, finance review queue, manager team view, executive dashboard, and the WebAuthn sign-in page.
- **Risk:** Running Playwright standalone splits reporting/lifecycle from the rest of the suites and breaks the single-driver guarantee, leaving UI tests for money-bearing views outside the unified gate.

### IMPL-TEST-003: bun-runtime-infra-owner

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** All infra setup/teardown (Postgres containers, app server, worker subprocesses, env wiring) runs from the Bun runtime side of Vitest hooks/setup files. The Plan's Bun workspace (apps/server, apps/worker) and three-database topology must be provisioned this way.
- **Risk:** If infra is owned outside Bun-side hooks, the three-DB roles (app_rw, analytics_w, audit_w) and task-queue worker cannot be reliably stood up and torn down per suite, producing flaky or cross-contaminated audit/ledger tests.

### IMPL-TEST-004: unit-test-location

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Unit tests live in /tests/unit, run via Vitest with no browser engine in Bun runtime. Natural home for pure commission-rules-engine logic (tiers, draw offset, splits) from Plan Phase 3.
- **Risk:** Misplaced or browser-loaded unit tests slow the suite and blur the boundary between pure calculation logic and integration behaviour.

### IMPL-TEST-005: api-integration-location

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** API integration tests live in /tests/integration, Vitest, no browser, Bun runtime, against real systems. This is the primary home for testing commission calculation, collection gating, approval gates, and payroll export against real Postgres.
- **Risk:** Without real-system integration tests, collection-gated release, clawback recalculation, and approval-gated payroll export — all auditable money paths — would be validated only against mocks and could diverge from production Postgres behaviour.

### IMPL-TEST-006: component-test-location

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** React component tests live in /tests/component, Vitest with Playwright headless Chromium. Covers the packages/ui and apps/web components for portal, review queue, and dashboards.
- **Risk:** Component tests outside this location/engine lose real-browser fidelity for the producer-facing payout derivation views, where rendering correctness affects trust.

### IMPL-TEST-007: e2e-test-location

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Full-page user-story tests live in /tests/e2e, Vitest with Playwright headless Chromium. Maps to PRD user stories such as run-a-commission-cycle, submit-a-dispute, and partner-scoped access.
- **Risk:** Missing or misplaced E2E coverage leaves cross-role flows (finance approve to payroll export, manager split approval) unverified end to end.

### IMPL-TEST-008: per-suite-ci-workflows

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Separate CI workflow files per suite: test-unit.yml, test-api.yml, test-component.yml, test-e2e.yml, test-pg-container.yml. The Plan already commits to per-suite GitHub Actions workflows (test-unit, test-api, test-migration, container build); align naming and add the missing component/e2e/pg-container workflows.
- **Risk:** A monolithic workflow hides which money-path suite failed and slows feedback on the financial-correctness suites.

### IMPL-TEST-009: quality-gate-workflow

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** quality-gate.yml installs Bun + deps and runs lint, format check, and build verification, separate from test suites. The Plan explicitly lists a quality-gate workflow.
- **Risk:** Folding quality checks into test workflows duplicates work and muddies gate signals.

### IMPL-TEST-010: test-workflows-tests-only

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Test-suite workflows run only their canonical test command; lint/format/build are not duplicated there.
- **Risk:** Duplicated quality checks waste CI minutes and create conflicting pass/fail semantics.

### IMPL-TEST-011: merge-gate-all-pass

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Merge is blocked unless the quality gate and all required test workflows pass. The Plan's "branch protection requiring all checks green" implements this.
- **Risk:** Without an all-pass merge gate, unverified changes to commission calculation, audit immutability, or RBAC could merge — unacceptable for a governed financial ledger.

### IMPL-TEST-012: local-ci-command-parity

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Local invocation uses the exact same per-suite commands as CI; CI may not use alternate runners or entrypoints. Canonical commands must be documented (e.g. in package.json scripts / README).
- **Risk:** Drift between local and CI commands means a green local run on the commission engine may still fail in CI, eroding developer trust in the gate.

### IMPL-TEST-029: release-workflow-gates

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Release builds must pass release.yml gates before tagged publication. The Plan ships distroless container builds and deployment scripts but does not yet name a release.yml; add one if tagged releases are produced.
- **Risk:** Tagging/publishing a container image that skipped the full gate could ship an unverified build of a financial system.

### IMPL-TEST-013: golden-fixture-recorder

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** A Bun script reads runtime config, makes real HTTP requests to external services, writes bodies/headers to JSON under /tests/fixtures/, and logs schema drift. Directly applies to the PRD's ATS/CRM, AR/invoice, and payroll-export integration boundaries (§7).
- **Risk:** Without recorded golden fixtures, ATS/AR integration tests drift silently when an upstream schema changes, causing incorrect placement/invoice ingestion to go undetected.

### IMPL-TEST-014: fixtures-are-files

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Fixtures are committed file artifacts under /tests/fixtures/ (or suite-specific folders); env vars are configuration only. Applies to ATS/AR payloads and payroll-export format fixtures.
- **Risk:** Storing integration payloads outside version-controlled files loses the auditable record of what external-system shapes the platform was tested against.

### IMPL-TEST-015: vitest-lifecycle-setup

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Vitest lifecycle hooks / setup files / test projects create and destroy infrastructure; no ad hoc shell orchestration. Applies to standing up the three Postgres DBs, roles, and the task-queue worker per suite.
- **Risk:** Manual/shell orchestration of the multi-DB stack produces non-reproducible test environments and cross-suite state leakage in audit and ledger data.

### IMPL-TEST-016: dynamic-infra-values

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Dynamic infra values (e.g. DB URL with random port) are generated in Bun runtime and passed into app processes started by Vitest setup. Required for the per-suite Postgres 16 containers in the Plan.
- **Risk:** Hard-coded ports/URLs cause collisions when unit, api, migration, and pg-container suites run concurrently in CI, yielding flaky financial tests.

### IMPL-TEST-017: no-fixed-database-url

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Never rely on a fixed DATABASE_URL for browser/integration suites when the container helper provides a random host port. Reinforces dynamic wiring for commission_app / commission_analytics / commission_audit test instances.
- **Risk:** A fixed DATABASE_URL collides with parallel suites or points at a stale DB, producing false passes/fails on collection-gating and audit-trail tests.

### IMPL-TEST-018: headless-no-display

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Browser tests run in real Playwright Chromium headless — no GUI, no display server, no DISPLAY dependency — launched through Vitest config, not a standalone runner. Applies to component and E2E suites for the portal and dashboards, and to CI runners.
- **Risk:** A DISPLAY/xvfb dependency would make CI brittle and non-portable across the distroless/k3s deployment toolchain in the Plan.

### IMPL-TEST-019: vitest-dependency

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Vitest is a mandatory Buy dependency owning lifecycle, orchestration, and reporting. Add to devDependencies in the Bun workspace.
- **Risk:** Reimplementing a test driver is wasted effort and would diverge from the single-driver mandate.

### IMPL-TEST-020: playwright-dependency

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Playwright is a mandatory Buy dependency providing the headless browser engine for Vitest. Add as a devDependency / browser provider.
- **Risk:** Substituting a DOM simulation for a real browser engine (see IMPL-TEST-027) loses production fidelity.

### IMPL-TEST-021: eslint-dependency

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** ESLint is a Buy dependency for linting with ecosystem plugins; runs in quality-gate.yml.
- **Risk:** Hand-rolled linting cannot match ecosystem rule coverage and would weaken the quality gate.

### IMPL-TEST-022: prettier-dependency

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Prettier is a Buy dependency for deterministic formatting; format check runs in quality-gate.yml.
- **Risk:** An agent-generated formatter would diverge, producing churny diffs and unstable format-check gating.

### IMPL-TEST-023: no-split-runners

- **Type:** implementation (antipattern)
- **Applicable:** yes
- **Technology implication:** Do not run some TS suites in Vitest and others in standalone Playwright/Jest/Mocha. All TS suites are Vitest-driven.
- **Risk:** Split runners fragment the real-Postgres setup and the merge gate, undermining confidence across the commission/ledger/portal suites.

### IMPL-TEST-024: no-infra-outside-bun

- **Type:** implementation (antipattern)
- **Applicable:** yes
- **Technology implication:** Do not start databases/servers manually and hope tests discover them; infra is created/cleaned by Bun-side Vitest setup so each suite is self-contained. Applies to the three Postgres DBs and the task-queue worker.
- **Risk:** Manually started, undiscovered infra causes order-dependent, leaky tests — especially dangerous for audit immutability and ledger-adjustment tests where stale state corrupts assertions.

### IMPL-TEST-025: no-fixtures-in-env-vars

- **Type:** implementation (antipattern)
- **Applicable:** yes
- **Technology implication:** Do not put replay payloads or expected responses in .env values; ATS/AR/payroll fixtures must be committed files.
- **Risk:** Env-var fixtures are unauditable and easily lost, breaking the recorded-contract guarantee for external-system ingestion.

### IMPL-TEST-026: no-local-ci-drift

- **Type:** implementation (antipattern)
- **Applicable:** yes
- **Technology implication:** Do not run a suite with one command locally and a different command in CI; keep canonical per-suite commands identical.
- **Risk:** Command drift hides CI-only failures in money-path suites and erodes the value of the merge gate.

### IMPL-TEST-027: no-jsdom-as-browser

- **Type:** implementation (antipattern)
- **Applicable:** yes
- **Technology implication:** Do not run component tests in JSDOM or Happy DOM; use real Chromium via Playwright. Applies to all packages/ui and apps/web component tests for portal, review queue, and dashboards.
- **Risk:** A component that passes in JSDOM but fails in Chromium fails in production — unacceptable for producer payout-derivation and finance approval UIs where layout, real events, and network behaviour matter.

### IMPL-TEST-028: schema-upgrade-not-yet-implemented

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Schema-upgrade compatibility is required release doctrine, but no canonical test-schema-upgrade-compatibility CI workflow ships yet; do not claim it exists. The Plan includes a test-migration workflow and a packages/db migration runner, which is adjacent but not the same as a schema-upgrade-compatibility suite.
- **Risk:** Claiming a schema-upgrade workflow exists when it does not would give false assurance about safe migrations of the audit/ledger schema across releases.

## Recommended Technology Choices

- **Vitest as the single test driver** for unit, integration, component, and E2E suites — IMPL-TEST-001, IMPL-TEST-019, IMPL-TEST-023.
- **Playwright as a headless Chromium browser provider under Vitest** (never standalone, never JSDOM/Happy DOM) for the producer portal, finance review queue, manager team view, and executive dashboard — IMPL-TEST-002, IMPL-TEST-006, IMPL-TEST-007, IMPL-TEST-018, IMPL-TEST-020, IMPL-TEST-027.
- **Bun-runtime, Vitest-owned infrastructure setup** that stands up the three PostgreSQL 16 databases (commission_app, commission_analytics, commission_audit), their roles, and the task-queue worker per suite, with dynamically allocated DB URLs/ports — IMPL-TEST-003, IMPL-TEST-015, IMPL-TEST-016, IMPL-TEST-017, IMPL-TEST-024.
- **Real-system API integration tests against containerized Postgres** for commission calculation, collection gating, approvals, and payroll export — IMPL-TEST-005.
- **Standard test directory layout**: /tests/unit, /tests/integration, /tests/component, /tests/e2e — IMPL-TEST-004 through IMPL-TEST-007.
- **A Bun-based golden-fixture recorder writing committed JSON fixtures under /tests/fixtures/** for the ATS/CRM, AR/invoice, and payroll-export integration boundaries — IMPL-TEST-013, IMPL-TEST-014, IMPL-TEST-025.
- **ESLint + Prettier in a dedicated quality-gate.yml** (lint, format check, build) separate from test workflows — IMPL-TEST-009, IMPL-TEST-010, IMPL-TEST-021, IMPL-TEST-022.
- **Per-suite GitHub Actions workflows** (test-unit.yml, test-api.yml, test-component.yml, test-e2e.yml, test-pg-container.yml) with identical local/CI canonical commands and an all-pass branch-protection merge gate — IMPL-TEST-008, IMPL-TEST-011, IMPL-TEST-012, IMPL-TEST-026.
- **A release.yml release-gate workflow** before any tagged container publication, and **no claim of a schema-upgrade-compatibility workflow until it actually exists** — IMPL-TEST-029, IMPL-TEST-028.

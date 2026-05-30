# Blueprint: TEST — Architecture Research

**Source:** blueprint/rules/blueprints/test.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This is a TESTING blueprint, and it is load-bearing for a product whose core value proposition is a governed, auditable economic ledger where "no commission amount may reach payroll without approval" and "history is never silently overwritten." The most consequential rules are the replay/recovery/twin family (TEST-P-008, TEST-D-006, TEST-D-007, TEST-C-014/015/016/017) because the PRD's immutable-ledger and audit-trail constraints map directly to ledger-replay and backup-restore verification surfaces; the real-systems family (TEST-P-001, TEST-X-001, TEST-C-018 "no mocks") because correct commission math against real PostgreSQL is the whole product; the target-platform family (TEST-P-003, TEST-A-001/002, TEST-C-004 — integration tests in k8s) which the Plan already adopts (k3s/k3d, distroless containers, three PostgreSQL 16 databases); and the suite-per-workflow CI family (TEST-D-002, TEST-D-005, TEST-A-002) which the Plan's Phase 1 already commits to (per-suite GitHub Actions: quality-gate, test-unit, test-api, test-migration, container build). The headless-browser family (TEST-D-004, TEST-C-002/005/006/023) applies to the web app (apps/web, producer portal, executive dashboard) and prescribes Playwright + real Chromium over JSDOM. Together these rules constrain the test toolchain to Vitest (unit), Playwright/headless Chromium (component + E2E), real PostgreSQL in k3d/kind for integration, a golden-fixture recorder for the ATS/AR/payroll integration boundaries, and a one-workflow-per-suite CI gate with local-CI command parity.

## Rule Analysis

### TEST-T-001: environment-parity

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Tests must run on the same OS/runtime as production. Production targets Linux distroless containers on k3s; CI runners and the integration suite must execute on Linux, not a developer's macOS host. Bun must be the runtime in both.
- **Risk:** Commission math or encryption (FieldEncryptor/KMS, BYTEA columns) that passes on a dev machine but diverges on Linux distroless would surface only in production, corrupting payout records that are supposed to be the trusted source of truth.

### TEST-T-002: test-validity

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Tests must exercise real behavior, not assumptions — drives use of real PostgreSQL 16 and real KMS/encryption logic over hand-mocks for the commission engine and ledger.
- **Risk:** Mocked commission/collection-gate logic could pass while real payout calculations are wrong, producing overpayments — the exact failure the product exists to prevent (success metric: "reduction in commission overpayment").

### TEST-T-003: fixture-accuracy

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Fixtures for the ATS/CRM, AR/accounting, and payroll-export integration boundaries (§7) must be recorded from real traffic, never fabricated.
- **Risk:** Hand-guessed ATS/invoice payload shapes would make import and collection-gating tests green while real onboarding imports fail or silently drop attribution data.

### TEST-T-004: browser-fidelity

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Component and E2E tests for apps/web (producer portal, finance review queue, executive dashboard) must run in a real browser engine (Chromium), not Node/JSDOM.
- **Risk:** Payout-statement or dashboard rendering bugs that pass in JSDOM but break in Chromium would erode the producer-transparency goal and re-create finance support load.

### TEST-T-005: coverage-completeness

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Test categories must span unit, integration, component, and E2E. The Plan currently names unit/api/migration suites; a component and full-page E2E suite must be added for the web workflows.
- **Risk:** A passing suite that omits the commission-close → payroll-export workflow leaves the product's primary user journey unverified.

### TEST-T-006: merge-gating

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Branch protection must require all suite workflows green before merge — Plan Phase 1 already specifies "branch protection requiring all checks green."
- **Risk:** A merge with a failing commission-calculation test ships incorrect payout logic into a finance-critical system.

### TEST-T-007: test-reliability

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Every test must be deterministic; flaky tests are bugs. Time-dependent logic (guarantee-window expiry, payout cycles, draw recovery schedules) must use injected/controlled clocks rather than wall-clock time.
- **Risk:** Flaky guarantee/clawback timing tests get disabled, leaving the post-placement-risk engine unverified.

### TEST-T-008: test-first-discipline

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Test stubs encoding expected behavior must be written before feature code, per phase. Each phase task in the Plan (e.g., commission calculation engine, payroll export) should begin with failing stubs.
- **Risk:** Tests written after implementation encode whatever the engine happened to compute as "correct," cementing payout bugs as expected behavior.

### TEST-T-009: failure-diagnosis

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Each suite runs in its own CI workflow so a red check names the broken category — Plan already has separate quality-gate/unit/api/migration workflows.
- **Risk:** A monolithic workflow forces log-scraping to find whether unit, migration, or E2E broke, slowing the team and tolerating broken windows.

### TEST-P-001: prefer-real-systems

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Order of preference: real dependency → recorded fixture → narrow fake. Use real PostgreSQL 16 and real encryption/KMS (dev stub is acceptable as the documented narrow fake at that boundary); use recorded golden fixtures for external ATS/AR/payroll APIs.
- **Risk:** Over-faking the ledger or commission engine yields false confidence in a system whose entire selling point is trusted, auditable correctness.

### TEST-P-002: fixtures-are-files

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Golden fixtures (ATS/AR/payroll request-response pairs, payload snapshots) are committed files on disk, never stored in env vars. Env vars are config only.
- **Risk:** Replay data hidden in .env is unversioned and unreviewable, undermining fixture provenance for integration tests.

### TEST-P-003: test-on-target

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Code must be tested on its target platform — integration tests run against containers deployed to a local Kubernetes cluster (k3d/kind) matching the k3s production target; browser code in a real headless browser.
- **Risk:** Native-host integration tests miss container/k8s, networking, and worker-credential-delegation behavior that only manifests in the real deployment.

### TEST-P-004: tests-before-code

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Create failing test stubs during scaffold for every planned feature area across the seven phases; make them pass during implementation.
- **Risk:** Without stubs, later phases (risk engine, leadership visibility) ship without a specification of intended behavior.

### TEST-P-005: suite-independence

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Each suite owns its setup/teardown/fixture loading (DB provisioning of the three databases, seed, migration) and can run in isolation; no cross-suite ordering dependencies.
- **Risk:** Shared global state between suites produces order-dependent passes that hide real failures.

### TEST-P-006: local-ci-parity

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** The same canonical per-suite commands (e.g., Bun test scripts) run locally and in CI; CI must not use a different runner or setup path.
- **Risk:** "Passes locally, fails in CI" destroys trust in the gate and slows every merge.

### TEST-P-007: precise-failure

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Failures must name suite/test/assertion without log parsing — reinforces one-workflow-per-suite CI organization already in the Plan.
- **Risk:** Imprecise failures slow diagnosis and erode the zero-broken-window discipline.

### TEST-P-008: replay-recovery-simulation

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** The system must prove it can replay durable facts into correct state, recover from clean backups, and create isolated sandbox twins. This maps directly onto the PRD's immutable ledger (§6 lifecycles, §9 audit constraint: "never silently overwritten") and the ledger-posted adjustments for clawbacks. Requires a replayable event/ledger model in the three-database design (commission_app + commission_audit).
- **Risk:** A ledger that cannot be deterministically replayed or restored fails the core "governed, auditable home" promise precisely during a dispute or audit — the moment it matters most.

### TEST-P-009: deterministic-gates

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Enforce machine-checkable gates for suite pass/fail, local-CI command parity, fixture provenance, replay coverage, recovery coverage, and twin lifecycle. Implies CI scripts/checks beyond merely running tests.
- **Risk:** A repo with tests but no provable gates is non-compliant and can silently regress these guarantees.

### TEST-D-001: golden-fixture-recording

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Build a fixture recorder that issues real HTTP requests to the ATS/CRM, AR/accounting, and payroll boundaries (§7) and serializes request/response pairs to disk, committed and replayed in integration tests.
- **Risk:** Without recorded golden fixtures, integration tests rely on fabricated payloads (TEST-X-002) and onboarding/collection-gating breaks against real customer data.

### TEST-D-002: suite-per-workflow-ci

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** One self-contained CI workflow file per suite; merge gate requires all to pass. Plan Phase 1 already adopts per-suite GitHub Actions workflows.
- **Risk:** A monolithic workflow re-introduces log-scraping and slow diagnosis.

### TEST-D-003: local-ci-command-parity

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Define canonical per-suite commands (Bun scripts) executed identically locally and in each CI workflow, plus an aggregate local command invoking them unchanged.
- **Risk:** Divergent command sets break the predictive value of local runs.

### TEST-D-004: headless-browser-testing

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Browser tests (component + E2E for apps/web) run headless on a real engine via a browser automation framework — Playwright/Chromium — with screenshot capture, since agent dev environments have no display.
- **Risk:** DOM-simulation testing misses real rendering of payout statements, dispute forms, and dashboards.

### TEST-D-005: separate-quality-gate

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** One dedicated quality-gate workflow (lint, format check, build) separate from test-suite workflows. Plan Phase 1 already names a "quality-gate" workflow distinct from test-unit/test-api/test-migration.
- **Risk:** Quality checks duplicated across suites inflate CI time, or omitted entirely let lint/build failures leak past the gate.

### TEST-D-006: ledger-replay-recovery

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Add a dedicated suite proving replay from genesis, replay from checkpoints, restore-from-backup into a clean environment, rebuilt-vs-materialized state comparison, and rollback/compensation-misuse scenarios — run against real PostgreSQL and real validator logic. Directly serves the immutable adjustment ledger, clawback/holdback postings, and exception audit trail.
- **Risk:** Disaster-recovery and audit-reconstruction guarantees cannot be established without these tests; a corrupted or non-reproducible ledger destroys the product's trust premise.

### TEST-D-007: digital-twin-lifecycle

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** A twin-lifecycle suite (provision sandbox twin, run a transaction sequence, assert diff/events, verify production unchanged, confirm teardown revokes access/removes state) applies if the platform exposes sandboxed twins. The PRD does not name a customer-facing twin feature, but the Plan's DEMO_MODE ephemeral accounts and demo-seed isolation are twin-like and warrant isolation verification.
- **Risk:** If demo/sandbox sessions leak mutations into the real commission ledger, demo activity could corrupt finance-critical production data.

### TEST-A-001: single-cluster-sequential-gate

- **Type:** architecture
- **Applicable:** partial
- **Technology implication:** Sequential single-runner execution with a local k8s cluster for integration tests is appropriate only while the full gate stays under five minutes. Viable early (Phase 1–2); with replay, recovery, twin, and E2E suites added later it will likely exceed five minutes and yield to TEST-A-002.
- **Risk:** Forcing sequential execution once the suite grows past five minutes harms merge throughput.

### TEST-A-002: parallel-ci-suites

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** Each suite on its own CI runner in parallel (quality-gate, unit, k8s-integration, component, E2E), merge gate requires all. This is the target architecture given the seven-phase scope and the slow replay/recovery/integration suites. Plan's per-suite workflow split is the foundation.
- **Risk:** Without parallelization the growing gate becomes a bottleneck and tempts broken-window tolerance.

### TEST-A-003: fixture-refresh-pipeline

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** A scheduled CI job re-runs the fixture recorder against live ATS/AR/payroll APIs, compares to committed fixtures, alerts on schema drift, and commits updates. Requires API credentials in CI for the recorder job only.
- **Risk:** Stale ATS/AR fixtures pass while real integrations have drifted, breaking imports and collection-gating in production.

### TEST-C-001: vitest-unit-tests

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Vitest configured for unit tests with at least one passing test (commission-math and pure-logic units).
- **Risk:** No unit harness leaves the rules engine's pure logic unverified.

### TEST-C-002: playwright-installed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Playwright installed with OS deps; headless Chromium launches on the Linux CI/dev environment.
- **Risk:** Browser suites cannot run, leaving the web app untested in a real engine.

### TEST-C-003: golden-fixture-recorded

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Golden-fixture recorder built; at least one ATS/AR/payroll fixture recorded from live traffic.
- **Risk:** Integration tests fall back to fabricated fixtures.

### TEST-C-004: integration-tests-in-k8s

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Integration tests run against a deployed container in Kubernetes (local k3d/kind) with real PostgreSQL 16 connections across the three databases.
- **Risk:** Host-native integration tests miss container, networking, and multi-DB/role behavior.

### TEST-C-005: component-tests-in-browser

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Component tests run in headless Chromium via Playwright, not JSDOM (packages/ui, apps/web components).
- **Risk:** JSDOM component tests give false confidence in rendering.

### TEST-C-006: e2e-test-passing

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Full-page E2E suite with at least one passing test over a core workflow (e.g., commission run → approve → export, or producer payout view).
- **Risk:** The primary user journey ships unverified end-to-end.

### TEST-C-007: four-ci-workflows

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Four CI workflows exist (unit, integration, component, E2E). The Plan currently lists unit/api/migration plus quality-gate and container build; component and full-page E2E workflows must be added to satisfy this.
- **Risk:** Missing component/E2E workflows leave web workflows out of the gate.

### TEST-C-008: ci-runs-all-suites

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** CI executes all defined suites on every merge-gated change.
- **Risk:** Skipped suites allow regressions to merge.

### TEST-C-009: canonical-commands-documented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Canonical per-suite Bun commands documented and identical local vs CI.
- **Risk:** Undocumented/divergent commands break local-CI parity.

### TEST-C-010: quality-gate-workflow

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Dedicated quality-gate workflow runs lint, format check, build verification — already in Plan Phase 1.
- **Risk:** Lint/format/build failures leak past the gate.

### TEST-C-011: suite-workflows-tests-only

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test-suite workflows run tests only, no duplicated quality checks.
- **Risk:** Duplicated lint/build inflates CI time (TEST-X-006).

### TEST-C-012: merge-gate-configured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Branch protection requires all workflows pass before merge — Plan Phase 1 specifies this.
- **Risk:** Unverified payout logic merges.

### TEST-C-013: test-stubs-exist

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Failing test stubs exist for all planned feature areas (all seven phases). Failing is expected; missing is not.
- **Risk:** Missing stubs mean later phases lack a behavioral specification.

### TEST-C-014: ledger-replay-tests

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Ledger replay tests exist: genesis replay, checkpoint replay, materialized-state comparison — against the commission ledger/adjustment model.
- **Risk:** Replay correctness of the audit ledger is unproven.

### TEST-C-015: backup-restore-test

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Backup restore test: clean environment restored from backup and replayed to current state (the three PostgreSQL databases).
- **Risk:** Disaster-recovery guarantee for finance-critical data is unverified.

### TEST-C-016: twin-lifecycle-test

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Twin lifecycle test (clone creation, sandbox execution, teardown, production-unchanged proof) applies to DEMO_MODE ephemeral accounts / demo isolation rather than a named product twin.
- **Risk:** Demo/sandbox sessions could leak mutations into production ledger data.

### TEST-C-017: consequential-transaction-tests

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Tests cover dual attribution (splits/co-contributors), delegated authority (manager approval, escalation tiebreaker, worker delegated scoped credentials), and compensation paths (clawback/holdback/refund, draw recovery).
- **Risk:** The most disputed, money-moving transactions ship unverified, directly threatening the dispute-reduction and overpayment-reduction goals.

### TEST-C-018: no-mocks

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** No mocks in test code; grep for mock/jest.fn/vi.fn returns zero results. Use real PostgreSQL and recorded fixtures instead.
- **Risk:** Mocks reintroduce TEST-X-001 false confidence in commission correctness.

### TEST-C-019: fixture-refresh-pipeline

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Scheduled fixture-refresh pipeline runs; schema-drift alerts configured for ATS/AR/payroll boundaries.
- **Risk:** Fixtures drift from real APIs undetected.

### TEST-C-020: suites-under-five-minutes

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Total CI test time under five minutes governs the choice between TEST-A-001 (sequential) and TEST-A-002 (parallel); replay/recovery suites are slow, so parallelism is expected to be needed to stay near this target.
- **Risk:** A slow gate erodes throughput or invites skipping suites.

### TEST-C-021: zero-flaky-tests

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Zero flaky tests; intermittent failures fixed immediately. Requires controlled clocks for guarantee/payout-cycle timing.
- **Risk:** Tolerated flakiness masks real timing/ordering bugs in the risk engine.

### TEST-C-022: coverage-measured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Coverage measured and reported (visible, not gated) — Vitest coverage reporting.
- **Risk:** Untracked coverage hides untested critical paths.

### TEST-C-023: component-interaction-tests

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Component tests cover all critical UI components with at least one interaction test each (payout statement, dispute form, review queue, dashboard, login/passkey UX).
- **Risk:** Interaction bugs in finance-critical UI ship unverified.

### TEST-C-024: e2e-covers-workflows

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Full-page E2E covers all user-facing workflows documented in the PRD (§5.1–5.10: ledger creation, attribution, calculation, approval/exception, collection, guarantee, close/export, producer portal, onboarding import, partner access).
- **Risk:** Any uncovered PRD workflow can regress silently.

### TEST-C-025: fixtures-refreshed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Golden fixtures refreshed within the last 30 days; no stale fixtures.
- **Risk:** Stale ATS/AR/payroll fixtures pass while production integrations fail.

### TEST-C-026: ci-passes-last-fifty

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** CI green on every commit to main for the last 50 commits; no broken-window tolerance.
- **Risk:** Tolerated red main normalizes shipping unverified commission logic.

### TEST-C-027: execution-time-monitored

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Suite execution time monitored; degradation triggers investigation (especially as replay/integration suites grow).
- **Risk:** Unnoticed slowdown pushes the gate past the five-minute threshold and tempts shortcuts.

### TEST-C-028: features-require-tests

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** No feature merges without corresponding test coverage in the appropriate suite — enforced via merge gate.
- **Risk:** Untested features accrete, degrading the executable specification.

### TEST-C-029: test-documentation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** docs/ describes how to run each suite locally and how to add tests. Pairs with the Plan's deployment/dev scripts.
- **Risk:** Undocumented suites reduce local-CI parity adherence and onboarding speed.

### TEST-X-001: mock-everything

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden — do not replace PostgreSQL, the commission engine, or integration boundaries with hand mocks. Use real systems and golden fixtures.
- **Risk:** Tests validate the mock, not the system; commission overpayments reach production.

### TEST-X-002: fabricated-fixtures

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden — do not hand-write ATS/AR/payroll fixtures from docs/memory; record from live traffic.
- **Risk:** Fixtures reflect incomplete API understanding; imports/collection-gating break in production.

### TEST-X-003: fixtures-in-env-vars

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden — no replay data in .env/env vars; fixtures are committed files.
- **Risk:** Unversioned, unreviewable fixtures with no provenance.

### TEST-X-004: monolithic-ci-workflow

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden — do not run all suites in one workflow. Plan's per-suite split already avoids this.
- **Risk:** Log-scraping to locate failures; slow diagnosis.

### TEST-X-005: local-ci-divergence

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden — local and CI must run identical canonical commands.
- **Risk:** "Passes locally, fails in CI" destroys gate confidence.

### TEST-X-006: duplicated-quality-checks

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden — do not re-run lint/format/build inside suite workflows; keep them in the dedicated quality-gate workflow.
- **Risk:** Inflated CI runtime.

### TEST-X-007: tests-after-features

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden — do not write tests after implementation to confirm behavior; write failing stubs first.
- **Risk:** Payout bugs become encoded as expected behavior.

### TEST-X-008: ignored-flakiness

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden — do not re-run flaky tests; fix root cause (timing/ordering/shared state).
- **Risk:** Hidden timing bugs in guarantee/clawback scheduling persist.

### TEST-X-009: test-environment-shortcuts

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden — do not run integration tests natively on the host; run against containers in Kubernetes (k3d/kind) since production runs on k3s.
- **Risk:** Container/k8s/networking/credential-delegation behavior goes untested.

## Recommended Technology Choices

- **Vitest** as the unit test runner with coverage reporting enabled (TEST-C-001, TEST-C-022).
- **Playwright driving real headless Chromium** for both component and full-page E2E tests of apps/web (producer portal, finance review queue, executive dashboard, passkey login) — never JSDOM (TEST-D-004, TEST-C-002, TEST-C-005, TEST-C-006, TEST-C-023, TEST-T-004).
- **Real PostgreSQL 16 across all three databases** (commission_app, commission_analytics, commission_audit) in integration tests, with no DB mocks (TEST-P-001, TEST-C-004, TEST-C-018, TEST-X-001).
- **Integration tests deployed into a local Kubernetes cluster (k3d or kind)** mirroring the k3s production target and Linux distroless runtime (TEST-P-003, TEST-A-001/002, TEST-C-004, TEST-T-001, TEST-X-009).
- **A golden-fixture recorder** capturing real request/response pairs from the ATS/CRM, AR/accounting, and payroll-export boundaries, committed to the repo as files (TEST-D-001, TEST-P-002, TEST-C-003, TEST-X-002, TEST-X-003).
- **A scheduled fixture-refresh CI pipeline** with schema-drift alerts and CI-held API credentials for the recorder job (TEST-A-003, TEST-C-019, TEST-C-025).
- **Per-suite GitHub Actions workflows** (quality-gate; unit; k8s-integration; component; full-page E2E) with a separate dedicated quality-gate workflow for lint/format/build, plus branch protection requiring all green (TEST-D-002, TEST-D-005, TEST-A-002, TEST-C-007, TEST-C-010, TEST-C-011, TEST-C-012, TEST-X-004, TEST-X-006). Note: the Plan's current unit/api/migration/container set must add explicit component and full-page E2E workflows.
- **Canonical per-suite Bun commands run identically locally and in CI**, plus an aggregate local command, documented in docs/ (TEST-D-003, TEST-P-006, TEST-C-009, TEST-C-029, TEST-X-005).
- **A dedicated ledger replay/recovery suite** against real PostgreSQL and real validator logic: genesis replay, checkpoint replay, rebuilt-vs-materialized comparison, backup-restore into a clean environment, and rollback/compensation-misuse scenarios — grounding the PRD's immutable, never-overwritten audit ledger (TEST-P-008, TEST-D-006, TEST-C-014, TEST-C-015).
- **Consequential-transaction tests** for dual attribution/splits, delegated authority (manager approval, escalation, worker scoped credentials), and compensation paths (clawback/holdback/draw recovery) (TEST-C-017).
- **A sandbox/twin isolation suite** applied to DEMO_MODE ephemeral accounts, proving demo activity never mutates production ledger state (TEST-D-007, TEST-C-016).
- **Controlled/injected clocks and deterministic data** to eliminate flakiness in guarantee-window, payout-cycle, and draw-recovery timing (TEST-T-007, TEST-C-021, TEST-X-008).
- **Test-first stubs for all seven phases** authored during scaffolding before feature code (TEST-P-004, TEST-C-013, TEST-X-007).

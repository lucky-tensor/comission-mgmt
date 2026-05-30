# Blueprint: PROCESS — Architecture Research

**Source:** blueprint/rules/blueprints/process.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This is a meta-process blueprint: it governs *how* the commission-management platform is built and merged, not the runtime architecture of the product itself. Its most load-bearing rules for this project are the GitHub-enforcement design patterns and checklists (PROCESS-D-011 branch-protection ruleset, PROCESS-P-009 main-is-always-deployable, PROCESS-D-010 Depends-on enforcement, PROCESS-D-013/014/015 PR gates, PROCESS-D-016 merge queue) because they translate directly into concrete repository configuration — twelve named required status checks, `.github/workflows/*.yml` files, and a `ruleset.json` applied via the GitHub Rulesets API. These map cleanly onto the plan's Phase 1 CI pipeline task and the heavily audit/approval-driven product (a commission platform where "no amount reaches payroll without approval" is a hard constraint, mirroring "no PR reaches main without passing gates"). The three-document planning loop (PROCESS-D-001), infrastructure-before-features sequencing (PROCESS-P-007 / PROCESS-D-009), and the structured-requirements interview (PROCESS-D-008) are also strongly applicable — the plan already orders a Foundation phase ahead of all feature phases, and the PRD is the committed contract with testable acceptance criteria. The Calypso-specific rules (PROCESS-D-003 YAML workflow, PROCESS-A-002 multi-agent orchestration) are applicable as the orchestration substrate but are tooling choices external to the product code. Technology implications are almost entirely GitHub-platform and git-workflow choices; the product's own stack (TypeScript/Bun, PostgreSQL 16, k3s) is unaffected by this blueprint except that the nine CI checks must be wired to that stack's build/test/coverage tooling.

## Rule Analysis

### PROCESS-T-001: no-prior-context

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Requires a session-recovery artifact (untracked `next-prompt.md`) plus the durable GitHub Implementation Plan issue so an agent resumes the multi-phase plan (Foundation → Leadership Visibility) without re-deriving state.
- **Risk:** With seven phases and a large entity model (placement, commission, invoice, guarantee, draw, exception, plan version), a context-less restart would re-plan or duplicate work across phases.

### PROCESS-T-002: premature-feature-work

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Foundation (monorepo scaffold, three-DB schema, passkey auth, field encryption, CI, task queue) must be operational before Phase 2+ feature commits.
- **Risk:** Building the placement ledger or commission engine before field-level KMS encryption and the three-database tenancy model exist would force expensive rework of financial-data storage and audit guarantees.

### PROCESS-T-003: requirements-change-mid-development

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Plan lives as a living GitHub issue; PRD §10 Open Questions (segment priority, configurability threshold, plan-acknowledgment) are unresolved and will change scope.
- **Risk:** Unresolved configurability decisions (retroactive tiers, draw recovery, team pools) could land in the wrong phase if the plan does not absorb changes without losing completed-work tracking.

### PROCESS-T-004: priority-inversion

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The phase ordering in plan.md encodes priority; the implementation-plan issue must preserve it.
- **Risk:** Agents could build the Producer Portal (Phase 5) or Executive dashboard (Phase 7) while the commission engine (Phase 3) is incomplete, producing screens with no data to display.

### PROCESS-T-005: conflicting-parallel-plans

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** One Calypso state machine governs advancement if multiple agents run; otherwise a single Implementation Plan issue is the sole authority.
- **Risk:** Concurrent agents inventing parallel plans across the seven phases would create incompatible branching of the shared schema and CI config.

### PROCESS-T-006: stale-plan-after-commit

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Plan issue updated at every commit; discovered tasks (e.g. dev-scout outputs in Phase 1) added back into the plan.
- **Risk:** A stale plan misleads later agents about which lifecycle entities or CI checks already exist.

### PROCESS-T-007: human-override-ignored

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** `next-prompt.md` is human-editable; agent must respect human edits.
- **Risk:** For a finance/compliance product, a human redirect (e.g. prioritize audit-trail immutability) being ignored would erode trust in the build process.

### PROCESS-T-008: session-crash-data-loss

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Git commits are the unit of durable progress; small frequent commits.
- **Risk:** Losing uncommitted work on the schema or encryption registry would be costly to reconstruct.

### PROCESS-T-009: ambiguous-requirements

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** PRD interview must extract concrete, testable acceptance criteria; PRD already encodes constraints (audit, explainability, data-completeness gating).
- **Risk:** Ambiguity in commission rules (tiers, clawbacks, draw offset) would produce an engine that computes wrong payouts — a direct financial-correctness failure.

### PROCESS-T-010: self-attestation

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** State advancement requires a validation transition / required PR review, not the producing agent's own sign-off.
- **Risk:** Self-attested completion of approval-gating or collection-gating logic could ship unreviewed financial control code.

### PROCESS-T-011: gate-skipping

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** CLI / CI must evaluate declared gates before state advance; nine required status checks block merge.
- **Risk:** Skipping the coverage or integration gate on commission-calculation code lets miscalculations reach main.

### PROCESS-T-012: merge-without-required-checks

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** GitHub branch-protection ruleset with `bypass_actors: []` and a PR checklist gate; plan's Phase 1 CI task explicitly requires "branch protection requiring all checks green."
- **Risk:** Broken commission or payroll-export code reaching main and deploying to the k3s environments without all checks passing.

### PROCESS-P-001: commit-is-unit-of-progress

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Small, frequent git commits; pre-commit hooks run build/lint/format only.
- **Risk:** Large monolithic commits make reverts of buggy financial logic catastrophic.

### PROCESS-P-002: plans-are-living-documents

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Implementation Plan maintained as a GitHub issue, updated each commit via `gh`.
- **Risk:** A frozen plan diverges from the actual phase progression and misleads onboarding agents.

### PROCESS-P-003: state-machine-authorizes-progression

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** Calypso YAML state machine + CLI authorizes advancement; adopt if running orchestrated agents, otherwise the GitHub gates serve as the deterministic authority.
- **Risk:** Without a single advancement authority, multi-agent work on the shared schema drifts.

### PROCESS-P-004: next-action-always-explicit

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Untracked `next-prompt.md` holds the single next action, written at end of each commit, human-overridable.
- **Risk:** Cold-start re-derivation across a seven-phase plan wastes effort and risks divergent decisions.

### PROCESS-P-005: agents-are-narrow-specialists

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** Producer/checker role separation; relevant when Calypso multi-agent orchestration is used.
- **Risk:** Broad free-form autonomy on a complex financial domain produces unreviewed, scope-creeping work.

### PROCESS-P-006: requirements-extracted-not-assumed

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** PRD (`docs/prd.md`) is the committed contract; if not in the PRD, it is not built. PRD §8 Out of Scope explicitly fences (no contract-staffing GP engine, single-currency, no plan simulation, no client portal, no native payroll integration).
- **Risk:** Building out-of-scope items (e.g. multi-currency, timesheet GP) wastes effort and violates the contract.

### PROCESS-P-007: infrastructure-enforces-sequencing

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Repo, CI, test stubs, deployment must be operational before first feature commit — exactly the plan's Phase 1 Foundation (scaffold, three DBs, auth, KMS, CI, task queue, deploy scripts).
- **Risk:** Feature work on a broken foundation cannot be tested, deployed (k3s/AlloyDB), or extended.

### PROCESS-P-008: deterministic-gates-first-class

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Every transition has machine-checkable gates (tests pass, coverage ≥99%, required docs/workflows present), executed by CI/CLI.
- **Risk:** Non-machine-checkable "looks done" gates let incomplete commission logic advance.

### PROCESS-P-009: main-is-always-deployable

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Every main commit passes nine required checks (build, lint, format, unit, integration, e2e, coverage ≥99%, checklist, depends-on); ruleset applied immediately after first push; no bypass actors.
- **Risk:** A non-deployable main breaks the health-gated GCP rollout and demo deployments; for a finance product, a broken main risks shipping incorrect payout math.

### PROCESS-P-010: user-grounded-intake

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Each feature must name a user role and ≥1 user story; PRD §3–§4 already define six roles (Finance Admin, Producer, Manager, Executive, HR/People Ops, External Partner) with stories.
- **Risk:** Features built without role grounding (e.g. external-partner scoping) implement the implementer's assumptions, breaking confidentiality constraints in §9.

### PROCESS-D-001: three-document-planning-loop

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** PRD committed at `docs/prd.md` (present); Implementation Plan as a GitHub Issue; `next-prompt.md` local and untracked (gitignored). Pre-commit hooks must not gate on plan or next-prompt.
- **Risk:** Storing the plan as a committed file would create merge conflicts and state drift across parallel phase work.

### PROCESS-D-002: self-advancing-state-machine

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Each commit writes `next-prompt.md` as its final action; next session reads it first.
- **Risk:** A poor next-prompt starts the next session on the wrong phase task; mitigated by the plan issue.

### PROCESS-D-003: calypso-yaml-workflow-definition

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Adopt the Calypso workflow YAML (states: new → prd-review → architecture-plan → scaffold-tdd → … → done) and the feature-unit invariant (1 feature = 1 branch = 1 worktree = 1 PR) if using Calypso orchestration. This is build-tooling, external to product code.
- **Risk:** Prose-only workflow lets multiple agents branch incompatibly across the shared monorepo.

### PROCESS-D-004: producer-validator-handoff

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Separate producer and validator transitions; required PR review (≥1 approval per repo standards) is the minimum enforcement even without Calypso.
- **Risk:** Producing agent self-approving collapses review into self-attestation on financial logic.

### PROCESS-D-005: merge-queue-ownership

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** A dedicated merge-queue role selects the queue-head PR; pairs with GitHub merge queue (PROCESS-D-016). Relevant when multiple PRs are concurrently ready.
- **Risk:** Without merge ordering, two PRs touching the shared schema or CI config land in a conflicting order.

### PROCESS-D-006: gate-groups-and-evidence

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Gates grouped (specification, implementation, validation, merge-readiness), each with owner, evidence source, blocking behavior, PR checklist label.
- **Risk:** Scattering checks across ad-hoc scripts loses the unified proof-of-compliance the audit-heavy product mirrors.

### PROCESS-D-007: task-catalog-backing-workflow

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Calypso task catalog (builtins like test-matrix, agent tasks, human tasks). Note `rust-quality` is a Calypso-CLI builtin; this project's quality task must target TypeScript/Bun tooling instead.
- **Risk:** Naming gates without executable tasks leaves enforcement ambiguous.

### PROCESS-D-008: structured-requirements-interview

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Interview by domain (user roles, data model, workflows, integrations, constraints) → canonical PRD with testable criteria. PRD already reflects this structure (roles, entity lifecycles §6, integration needs §7, constraints §9).
- **Risk:** Skipping the interview on domain-specific commission rules (clawback, draw, tiers) yields an engine built on guesses.

### PROCESS-D-009: infrastructure-before-features

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Scaffold (repo, CI, test stubs, deployment) complete before any feature; matches the explicit Phase 1 Foundation in plan.md.
- **Risk:** A demo with no foundation — schema, KMS, CI — cannot be tested or deployed to the three target environments.

### PROCESS-D-010: pr-depends-on-enforcement

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** `.github/workflows/pr-depends-on.yml` + `Depends-on: #N` PR-body line; `depends-on` as a required status check.
- **Risk:** Phase 1 schema/migration PRs merging after the feature PRs that depend on them breaks main; explicit Depends-on prevents out-of-order landing across the dependent phases.

### PROCESS-D-011: github-branch-protection-ruleset

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Apply a GitHub ruleset (targeting `~DEFAULT_BRANCH`, `bypass_actors: []`) via the Rulesets API requiring twelve checks (build, lint, format, unit, integration, e2e, coverage, checklist, depends-on, issue-checklist, conflicts, single-issue). Store `examples/github-workflows/ruleset.json`; pre-register check names via dummy PR / workflow_dispatch.
- **Risk:** Any unprotected path lets unreviewed payout/export code reach main — a single point of failure undermining every other guarantee.

### PROCESS-D-012: fused-gate-architecture

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Two-tier gates: local git hooks (pre-push, per plan's `.calypso` hook) vs GitHub Actions CI; doctor checks detect drift between declared and actual gate state.
- **Risk:** Declared-but-unenforced gates give false confidence that financial-logic checks run.

### PROCESS-D-013: pr-issue-completeness-gate

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** `.github/workflows/pr-issue-checklist.yml` parses `Closes/Fixes/Resolves #N` and fails `issue-checklist` if the linked issue has unchecked `- [ ]` items; PRs must use closing keywords at line start.
- **Risk:** Merging before a phase issue's acceptance criteria are checked silently ships unfinished commission features.

### PROCESS-D-014: pr-conflict-visibility-gate

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** `.github/workflows/pr-conflicts.yml` on push + 30-min cron, failing `conflicts` check with rebase instructions.
- **Risk:** Headless agents overlook GitHub's passive conflict banner and loop on the shared monorepo files.

### PROCESS-D-015: pr-single-issue-invariant

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** `.github/workflows/pr-single-issue.yml` enforces exactly one closing reference and no bare `#N`; backs the 1:1:1 feature-unit invariant.
- **Risk:** Scope-creeping PRs that close multiple phase issues make history and dependency ordering ambiguous.

### PROCESS-D-016: merge-queue-ruleset-scaffold

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Apply merge-queue ruleset (`grouping_strategy: HEADGREEN`, `min_entries_to_merge: 1`) during init; merge agent uses `gh pr merge --merge`.
- **Risk:** No atomic sequencing of concurrent ready PRs → race conditions on the shared schema/CI; PRs touching shared files must declare Depends-on.

### PROCESS-A-001: solo-agent-loop

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** Single-agent loop (read PRD+plan+next-prompt → execute → commit code+plan+next-prompt → loop); the default, simplest fit for this early-stage build.
- **Risk:** N/A (architecture option). Choosing this trades parallelism for predictability.

### PROCESS-A-002: calypso-orchestrated-multi-agent

- **Type:** architecture
- **Applicable:** partial
- **Technology implication:** Producer→validator agents under the Calypso CLI with deterministic gates; adopt only when concurrent agent execution across phases is needed.
- **Risk:** N/A (architecture option). Adds orchestration machinery for auditable concurrency.

### PROCESS-A-003: human-in-the-loop-gated

- **Type:** architecture
- **Applicable:** partial
- **Technology implication:** Human reviews each commit before the agent proceeds; well-suited to this finance/compliance domain where correctness outweighs velocity.
- **Risk:** N/A (architecture option). Trades throughput for per-commit human assurance.

### PROCESS-C-001: prd-exists-with-acceptance-criteria

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `docs/prd.md` exists with testable criteria (constraints §9, entity lifecycles §6) — already satisfied.
- **Risk:** Without testable criteria, commission-correctness cannot be verified.

### PROCESS-C-002: implementation-plan-issue-current

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** A GitHub Implementation Plan issue links all active feature issues and reflects current state. (plan.md is the source content; the canonical living plan should be the issue.)
- **Risk:** A stale plan misrepresents phase progress.

### PROCESS-C-003: next-prompt-valid

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `next-prompt.md` exists locally, untracked, with a self-contained next action.
- **Risk:** Committing it or leaving it invalid breaks session recovery.

### PROCESS-C-004: calypso-workflow-yaml-exists

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Calypso workflow YAML defining states/transitions/roles/gates — required only if Calypso orchestration is adopted.
- **Risk:** Without it (and without an equivalent authority), advancement is ungoverned.

### PROCESS-C-005: pre-commit-hook-enforces-updates

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Pre-commit hooks run quality checks only (build/lint/format); must NOT gate on plan issue or next-prompt.
- **Risk:** Hooks gating on planning artifacts block legitimate commits.

### PROCESS-C-006: scaffold-complete-before-features

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** All Phase 1 scaffold tasks verified before Phase 2 feature work.
- **Risk:** Feature work on incomplete scaffold is untestable/undeployable.

### PROCESS-C-007: full-loop-demonstrated

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Demonstrate one full commit → plan update → next-prompt → resume loop.
- **Risk:** An unproven loop means session continuity is untested.

### PROCESS-C-008: prd-human-approved

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Human review/approval of `docs/prd.md`.
- **Risk:** Unapproved PRD means the contract is not authoritative.

### PROCESS-C-009: no-features-before-scaffold

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify no Phase 2+ feature code precedes Foundation completion.
- **Risk:** Feature-first development (PROCESS-X-002) on a missing foundation.

### PROCESS-C-010: plan-reflects-reality

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Human-audited plan accuracy of completed/remaining work.
- **Risk:** Phantom plan misleads later agents.

### PROCESS-C-011: next-prompt-chain-unbroken

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Unbroken next-prompt chain for ≥10 consecutive commits.
- **Risk:** Chain breaks force cold re-derivation.

### PROCESS-C-012: human-override-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test that a human edit to next-prompt is respected.
- **Risk:** Ignored overrides erode human control of build priorities.

### PROCESS-C-013: multi-session-resume

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Demonstrate resume from next-prompt across a session boundary.
- **Risk:** Untested resume risks lost continuity.

### PROCESS-C-014: discovered-tasks-in-plan

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Plan includes tasks discovered during implementation (e.g. dev-scout findings on tenancy/encryption).
- **Risk:** Discovered work omitted from the plan never gets scheduled.

### PROCESS-C-015: process-docs-reflect-reality

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `docs/` process docs match the actual process used.
- **Risk:** Aspirational docs mislead onboarding.

### PROCESS-C-016: crash-recovery-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test resume after a crashed session with uncommitted work.
- **Risk:** Untested recovery risks silent work loss.

### PROCESS-C-017: onboarding-via-three-documents

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** A new agent can onboard from PRD + plan + next-prompt alone.
- **Risk:** If onboarding needs tribal knowledge, the planning loop is incomplete.

### PROCESS-C-018: producer-validator-transition-exercised

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Exercise ≥1 producer→validator transition through the Calypso CLI (only if Calypso adopted).
- **Risk:** Untested validation transition leaves self-attestation possible.

### PROCESS-C-019: gate-failure-handled

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Observe and handle ≥1 deterministic gate failure without manual improvisation.
- **Risk:** Improvised handling of CI failures defeats the gate.

### PROCESS-C-020: branch-protection-ruleset-applied

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Ruleset targeting `~DEFAULT_BRANCH` with the nine required checks and `bypass_actors: []` applied — directly satisfies the plan's Phase 1 "branch protection requiring all checks green."
- **Risk:** Unprotected main lets failing code merge.

### PROCESS-C-021: pr-checklist-workflow-deployed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `.github/workflows/pr-checklist.yml` present, failing on unchecked `- [ ]` in PR body.
- **Risk:** Unattested PR items merge silently.

### PROCESS-C-022: checklist-check-name-registered

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Register the `checklist` check name via dummy PR / workflow_dispatch so the ruleset can validate it.
- **Risk:** An unregistered check name cannot be enforced by the ruleset.

### PROCESS-C-023: pr-depends-on-workflow-deployed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `pr-depends-on.yml` present, `depends-on` required, PR template includes the Depends-on comment.
- **Risk:** Out-of-order merges across phase dependencies.

### PROCESS-C-024: all-check-names-pre-registered

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Run each of the nine workflows once before enabling the ruleset so GitHub recognizes the check names.
- **Risk:** Unrecognized checks cannot be required; ruleset is toothless.

### PROCESS-C-025: first-pr-all-checks-pass

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** First PR demonstrates all nine checks required and passing before merge.
- **Risk:** Misconfigured gates discovered late.

### PROCESS-C-026: admin-bypass-verified-blocked

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify an admin cannot merge a PR with a failing check.
- **Risk:** Hidden bypass path lets bad code reach main.

### PROCESS-C-027: coverage-gate-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify a PR dropping below 99% line coverage is blocked; the Bun test/coverage tooling must emit a `coverage` check.
- **Risk:** Under-tested commission/calculation code merges.

### PROCESS-C-028: pr-issue-checklist-workflow-deployed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `pr-issue-checklist.yml` present and `issue-checklist` required.
- **Risk:** PRs merge with incomplete linked-issue acceptance criteria.

### PROCESS-C-029: pr-conflicts-workflow-deployed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `pr-conflicts.yml` on PR + 30-min cron; `conflicts` required.
- **Risk:** Overlooked conflicts cause merge-time rebase loops.

### PROCESS-C-030: pr-single-issue-workflow-deployed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `pr-single-issue.yml` present; `single-issue` required.
- **Risk:** Multi-issue PRs break the feature-unit invariant.

### PROCESS-C-031: merge-queue-ruleset-applied

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Merge-queue ruleset applied with `HEADGREEN`; merge agent uses `gh pr merge --merge`.
- **Risk:** No atomic sequencing of concurrent ready PRs.

### PROCESS-C-032: intake-user-roles-and-stories-present

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Every intake names ≥1 role and ≥1 story; PRD already grounds all six roles.
- **Risk:** Ungrounded features violate confidentiality/visibility scoping (PRD §9).

### PROCESS-X-001: phantom-plan

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Avoid — keep the plan issue updated each commit.
- **Risk:** A frozen plan across seven phases diverges from reality and is ignored.

### PROCESS-X-002: feature-first-development

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Avoid — do not build placement/commission features before the Foundation scaffold.
- **Risk:** A demo with no schema/CI/encryption foundation that cannot be tested or deployed.

### PROCESS-X-003: session-amnesia

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Avoid — read next-prompt first, do not re-derive from the codebase.
- **Risk:** Conflicting/duplicate work across phases.

### PROCESS-X-004: parallel-agents-without-machine

- **Type:** antipattern
- **Applicable:** partial
- **Technology implication:** Avoid — if running multiple agents, govern them with the Calypso state machine + gates.
- **Risk:** Nondeterministic drift on the shared monorepo.

### PROCESS-X-005: monolithic-commits

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Avoid — keep commits small and frequent.
- **Risk:** Catastrophic reverts of large financial-logic changes; crash loss.

### PROCESS-X-006: verbal-requirements

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Avoid — formalize all requirements into the PRD before building.
- **Risk:** Building misunderstood commission rules from chat/verbal input.

### PROCESS-X-007: plan-as-wishlist

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Avoid — plan tasks must be concrete, verifiable actions (as the phase task lists already are).
- **Risk:** Vague tasks produce vague, unverifiable work.

### PROCESS-X-008: skipping-the-interview

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Avoid — do not assume domain knowledge; the structured interview surfaced PRD §10 open questions.
- **Risk:** Inferred commission/clawback rules are wrong for the customer's actual plans.

### PROCESS-X-009: admin-bypass-on-main

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Avoid — never add bypass actors or set ruleset to evaluate/disabled; hotfixes go through a fast normal PR.
- **Risk:** A bypass path lets unreviewed/untested code reach main and deploy.

### PROCESS-X-010: implicit-merge-order

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Avoid — declare `Depends-on` explicitly rather than relying on creation/review order.
- **Risk:** Out-of-order merges (e.g. feature before its schema migration) break main.

## Recommended Technology Choices

- **GitHub repository ruleset via the Rulesets API**, `bypass_actors: []`, enforcement active, targeting `~DEFAULT_BRANCH`, stored as `examples/github-workflows/ruleset.json` — PROCESS-D-011, PROCESS-P-009, PROCESS-X-009, PROCESS-C-020.
- **Twelve required status checks** wired to the TypeScript/Bun stack: build, lint, format, unit, integration, e2e, coverage (≥99% line), checklist, depends-on, issue-checklist, conflicts, single-issue — PROCESS-D-011, PROCESS-P-008, PROCESS-C-024/025/027. (The plan's Phase 1 CI lists quality-gate, test-unit, test-api, test-migration, container build, which must be mapped onto these named checks.)
- **GitHub Actions workflow files** under `.github/workflows/`: `pr-checklist.yml`, `pr-depends-on.yml`, `pr-issue-checklist.yml`, `pr-conflicts.yml` (with 30-min cron), `pr-single-issue.yml`, plus the project CI — PROCESS-D-010/013/014/015, PROCESS-C-021/023/028/029/030.
- **GitHub merge queue ruleset** with `grouping_strategy: HEADGREEN`, `min_entries_to_merge: 1`, applied at init; merges via `gh pr merge --merge` — PROCESS-D-016, PROCESS-C-031.
- **`Depends-on: #N` PR-body convention** plus `.github/PULL_REQUEST_TEMPLATE.md` to sequence Phase 1 schema/migration PRs ahead of dependent feature PRs — PROCESS-D-010, PROCESS-X-010.
- **Three-document planning loop**: committed `docs/prd.md` (present), the Implementation Plan as a GitHub Issue (content in `docs/plan.md`), and an untracked/gitignored `next-prompt.md` — PROCESS-D-001, PROCESS-D-002.
- **Pre-push/pre-commit git hooks running quality checks only** (build/lint/format), never gating on planning artifacts; two-tier fused gates with doctor drift checks — PROCESS-C-005, PROCESS-D-012.
- **Infrastructure-first sequencing**: complete Phase 1 Foundation (monorepo scaffold, three PostgreSQL 16 DBs, WebAuthn passkey auth, field-level KMS encryption, CI, task queue, deploy scripts) before any feature commit — PROCESS-P-007, PROCESS-D-009, PROCESS-C-006/009.
- **Required PR review (≥1 approval, dismiss-stale, require-last-push-approval)** as the producer/validator separation baseline — PROCESS-D-004, repo_standards.
- **Optional Calypso CLI + YAML state machine** as the orchestration authority and merge-queue role if concurrent multi-agent development is adopted; otherwise the solo-agent loop with GitHub gates suffices — PROCESS-D-003, PROCESS-A-001/A-002, PROCESS-P-003. (Note: the blueprint's `rust-quality` task is Calypso-CLI-specific and must be substituted with a Bun/TypeScript quality task for this project.)
- **Human-in-the-loop gated architecture** is a strong fit given the finance/compliance, audit-trail, and approval-gating constraints in PRD §9 — PROCESS-A-003.

# Blueprint: PRUNE (Feature Pruning) — Architecture Research

**Source:** blueprint/rules/blueprints/prune.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint governs how the system safely removes unused features through an evidence-driven, four-stage pipeline (signal collection → deprecation notice → flag-gated disablement → code removal). For the commission-management product, this blueprint is **forward-looking rather than feature-bearing**: neither the PRD nor the Plan describes a feature-pruning capability, so the pruning pipeline itself (stages, candidate reports, deprecation notices) is **not applicable** as a product feature. However, several of its foundational requirements are strongly load-bearing because the project already commits to the infrastructure the blueprint depends on. The most consequential rules are **PRUNE-P-006 / PRUNE-C-001 (every surface instrumented)** — directly satisfied by the planned `commission_analytics` database and analytics/audit event taxonomy (Phase 1); **PRUNE-P-005 / PRUNE-D-003 / PRUNE-A-003 (database-backed feature flags, not code flags)** — which the project does not yet plan and would need before any pruning cycle; and **PRUNE-P-002 / PRUNE-D-004 / PRUNE-C-003 (dormant-by-design annotations)** — highly relevant because the Plan builds many features (guarantee tracking, clawback jobs, external-partner access, team pools) whose dependencies ship in later phases and will appear "unused" in analytics until then. The blueprint's technology implications align cleanly with the project's existing PostgreSQL-16 three-database architecture and its task-queue worker model, which provide natural homes for the feature-flag table, the scheduled flip job, and the analytics collection report.

## Rule Analysis

### PRUNE-T-001: false-positive-pruning

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** No pruning pipeline exists yet, so this threat is latent. When pruning is introduced it must rest on the `commission_analytics` DB (Phase 1) for corroborating multi-dimensional signals. This product has many low-frequency-but-critical surfaces (annual budget-style commission cycles, clawback events, external-partner views) that are precisely the false-positive risk this threat warns about.
- **Risk:** Removing a rarely-exercised but business-critical capability (e.g., clawback recovery, guarantee-window handling) would create emergency rollback work and erode finance/producer trust — directly contrary to PRD goal 1 (governed source of truth).

### PRUNE-T-002: silent-removal-without-notice

- **Type:** threat
- **Applicable:** no
- **Technology implication:** No in-product deprecation-notice mechanism is planned; not applicable until a pruning pipeline exists.

### PRUNE-T-003: feature-flag-left-permanently-disabled

- **Type:** threat
- **Applicable:** no
- **Technology implication:** No feature-flag system is planned in the current Plan; threat is latent until flags exist.

### PRUNE-T-004: analytics-blind-spots

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** The Plan's Phase 1 "analytics/audit event taxonomy" and `commission_analytics` database are the correct place to guarantee no surface is untracked. Every role-gated action across the six roles (Finance Admin, Producer, Manager, Executive, HR, External Partner) and every API route must emit usage telemetry to avoid blind spots.
- **Risk:** If the analytics taxonomy omits role-gated or API surfaces, future pruning cannot distinguish "never used" from "untracked," which feeds the false-positive threat (PRUNE-T-001).

### PRUNE-T-005: rollback-unavailable-after-code-removal

- **Type:** threat
- **Applicable:** no
- **Technology implication:** Latent until a code-removal stage exists. When implemented, depends on the silence-period and DB-flag rollback path.

### PRUNE-P-001: evidence-before-action

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** Requires the `commission_analytics` DB to capture independent signal dimensions (UI interaction, API call frequency, role access, page views). The project's separate analytics database is the natural substrate; the audit DB (`commission_audit`) should not be conflated with usage analytics.
- **Risk:** Acting on a single zero-signal dimension would prematurely prune features that are accessed through an untracked path, undermining the governed-record promise.

### PRUNE-P-002: agents-annotate-dormant-by-design

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** This is the most immediately actionable PRUNE rule for the current Plan. Many Phase 1 components are explicitly built as foundations for later phases — the task queue is "foundation for guarantee-expiry, clawback, and event-driven recalculation jobs" (Phase 6), external-partner roles exist in RBAC before the partner portal ships (Phase 5/§5.10), team pools and tiers are configured before consumed. These dormant code paths must carry structured `DORMANT_BY_DESIGN` annotations naming the dependent phase/issue.
- **Risk:** Without annotations, foundational-but-not-yet-exercised code (e.g., clawback worker, external-partner guard) will look unused in analytics and become a false-positive pruning candidate.

### PRUNE-P-003: four-stage-pipeline

- **Type:** principle
- **Applicable:** no
- **Technology implication:** No pruning pipeline is in PRD or Plan scope. If introduced, it must follow exactly the four ordered stages; the project's PostgreSQL DB and task-queue worker can host the stage state machine.

### PRUNE-P-004: speak-now-or-forever-hold-your-peace

- **Type:** principle
- **Applicable:** no
- **Technology implication:** No deprecation-notice UI is planned. Not applicable until pruning exists.

### PRUNE-P-005: flags-are-database-rows-not-code

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** Strongly aligned with the project's architecture but **not yet planned**. If feature flags are introduced, they must live in PostgreSQL (`commission_app` DB) as audited rows, not in env vars or code constants — consistent with the PRD's hard audit constraint (§9) that nothing is silently overwritten. A flag-evaluation middleware with a short TTL cache fits the existing server (apps/server) middleware stack.
- **Risk:** Implementing flags as code constants/env vars would prevent scheduled disablement and instant re-enable, and would violate the append-only audit posture the product already mandates for all state changes.

### PRUNE-P-006: every-surface-is-instrumented

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Directly satisfiable via the Phase 1 `commission_analytics` DB and analytics event taxonomy. Every user-visible surface — UI buttons, page views (producer portal, exec dashboard, manager team view), API endpoints, and role-gated capabilities — must emit a usage event. Treat this as a deployment-blocking instrumentation requirement built into the taxonomy from the start.
- **Risk:** Surfaces shipped without instrumentation create permanent analytics blind spots (PRUNE-T-004) that no later pruning cycle can safely interpret.

### PRUNE-P-007: silence-period-before-code-removal

- **Type:** principle
- **Applicable:** no
- **Technology implication:** Latent; depends on a flag system and code-removal stage that are out of current scope. When implemented, `removal_eligible_at = disabled_at + silence_period` should be a computed DB field.

### PRUNE-D-001: usage-signal-collection-report

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** The collection step is a natural fit for the project's network-isolated worker (Phase 1 task queue), which can query `commission_analytics` over a configurable lookback (default 90 days) and emit a YAML candidate report. Given the product's long, cyclical commission/guarantee horizons, the default lookback should likely be extended beyond 90 days.
- **Risk:** A short lookback would misclassify quarterly/annual-cadence commission features as abandoned; this product's "long user cycles" caveat from the blueprint tradeoffs applies directly.

### PRUNE-D-002: deprecation-flag-rollout

- **Type:** design_pattern
- **Applicable:** no
- **Technology implication:** Requires a `feature_flags` table and flag middleware that are not in current scope. Not applicable until that infrastructure exists.

### PRUNE-D-003: database-driven-flag-schema

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Defines the `feature_flags` table (name, state enum, owner, created_at, scheduled_disable_at, disabled_at, removal_eligible_at, notes) plus a scheduled flip job. This maps cleanly onto the project's PostgreSQL 16 `commission_app` DB and the Phase 1 PostgreSQL claim-execute-submit task queue (which can run the scheduled flip job). Append-only audit rows align with the existing `commission_audit` DB pattern.
- **Risk:** Absent this schema, the project has no observable, reversible, deployment-free mechanism for any future feature disablement.

### PRUNE-D-004: dormant-by-design-annotation

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Adopt the standardized comment block (`DORMANT_BY_DESIGN`, `depends_on`, `reason`, `reviewed_at`) at the entry point of every cross-phase foundational feature — e.g., the clawback/guarantee worker handlers (Phase 1 foundation → Phase 6 consumers), external-partner route guards (RBAC in Phase 1 → portal in §5.10), and team-pool/tier plan config (Phase 3 → consumed later). `depends_on` should reference the Plan phase or GitHub issue.
- **Risk:** Unannotated dormant features become false-positive candidates; this is the concrete enforcement mechanism that protects the project's phased build order.

### PRUNE-A-001: pruning-by-intuition

- **Type:** antipattern
- **Applicable:** partial
- **Technology implication:** Any future feature removal must originate from the analytics signal report, not from agent/developer opinion. The `commission_analytics` DB is the required evidence source.
- **Risk:** Intuition-based removal is the primary driver of false positives (PRUNE-T-001), risking removal of critical low-frequency commission capabilities.

### PRUNE-A-002: bundling-notice-and-removal

- **Type:** antipattern
- **Applicable:** no
- **Technology implication:** Not applicable until a deprecation/disablement pipeline exists.

### PRUNE-A-003: code-flags-instead-of-database-flags

- **Type:** antipattern
- **Applicable:** partial
- **Technology implication:** Forbids env-var/constant/compile-time feature flags. If the team introduces any feature-toggling (likely, given `DEMO_MODE` already exists in Phase 1 sign-in UX), pruning-relevant flags must be DB rows. Note: `DEMO_MODE` is a deployment-mode switch, not a pruning flag, so it is reasonably exempt — but it should not become the template for feature-level flags.
- **Risk:** Code flags cannot be toggled, scheduled, or audited without deployment, defeating the pruning flag stage and conflicting with the product's audit constraints.

### PRUNE-A-004: skipping-silence-period

- **Type:** antipattern
- **Applicable:** no
- **Technology implication:** Latent until code-removal stage exists.

### PRUNE-AR-001: pruning-pipeline-stages

- **Type:** architecture
- **Applicable:** no
- **Technology implication:** The full four-stage state machine is out of current PRD/Plan scope. If built, it should be driven by the `feature_flags` table (PostgreSQL) and the analytics signal report, with the scheduled flip job running on the existing task-queue worker and stage transitions written to `commission_audit`.

### PRUNE-C-001: analytics-coverage-complete

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verifiable now: confirm the Phase 1 analytics event taxonomy covers all UI buttons, page views, API routes, and role-gated actions for all six roles. Build this coverage check into the CI quality-gate where feasible.
- **Risk:** Incomplete coverage permanently blinds any future pruning and weakens usage-driven product decisions generally.

### PRUNE-C-002: feature-flags-table-exists

- **Type:** checklist
- **Applicable:** no
- **Technology implication:** The `feature_flags` table and flag middleware are not in the current Plan. This checklist becomes a gate only once pruning is in scope.

### PRUNE-C-003: dormant-features-annotated

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verifiable per PR: any feature implemented ahead of its dependency (common across this phased Plan) must carry a `DORMANT_BY_DESIGN` annotation with valid `depends_on` and a `reviewed_at` within 6 months. Add to the code-review/post-implementation checklist.
- **Risk:** Missing annotations expose foundational early-phase code to false-positive pruning later.

### PRUNE-C-004: notice-period-elapsed-before-disable

- **Type:** checklist
- **Applicable:** no
- **Technology implication:** Depends on the deprecation-notice and flag infrastructure; not in scope.

### PRUNE-C-005: silence-period-elapsed-before-removal

- **Type:** checklist
- **Applicable:** no
- **Technology implication:** Depends on the flag/removal pipeline; not in scope.

### PRUNE-C-006: removal-pr-removes-all-artifacts

- **Type:** checklist
- **Applicable:** no
- **Technology implication:** Depends on the code-removal stage; not in scope.

## Recommended Technology Choices

- **Comprehensive usage instrumentation in the `commission_analytics` PostgreSQL database** — build the Phase 1 analytics/audit event taxonomy so every UI surface, page view, API route, and role-gated action emits a usage event; treat absent instrumentation as deployment-blocking. (PRUNE-P-006, PRUNE-C-001, PRUNE-T-004)
- **`DORMANT_BY_DESIGN` structured code annotations** for all features built ahead of their dependent phase — clawback/guarantee workers, external-partner route guards, team-pool/tier config — with `depends_on` referencing the Plan phase or issue, enforced via the code-review checklist. (PRUNE-P-002, PRUNE-D-004, PRUNE-C-003)
- **Database-backed feature flags in `commission_app` (PostgreSQL 16), never code/env-var flags**, if and when feature toggling for pruning is introduced — table schema with state enum, scheduled_disable_at, disabled_at, removal_eligible_at, and append-only audit rows mirroring the existing audit posture. (PRUNE-P-005, PRUNE-D-003, PRUNE-A-003)
- **Reuse the Phase 1 PostgreSQL claim-execute-submit task-queue worker** as the host for both the scheduled flag-flip job and the periodic usage-signal collection report, rather than introducing external scheduling tooling. (PRUNE-D-001, PRUNE-D-003, PRUNE-AR-001)
- **Extended analytics lookback window (longer than the 90-day default)** for any future candidate-report job, reflecting the product's long, cyclical commission and guarantee horizons. (PRUNE-D-001)
- **Route stage transitions and flag changes through the `commission_audit` database** to satisfy both this blueprint's audit-trail requirement and the PRD §9 "never silently overwritten" constraint, if a pruning pipeline is later built. (PRUNE-AR-001, PRUNE-D-003)

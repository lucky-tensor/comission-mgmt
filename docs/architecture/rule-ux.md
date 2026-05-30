# Blueprint: UX — Architecture Research

**Source:** blueprint/rules/blueprints/ux.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

The most load-bearing rules for this project are those governing **medium-appropriate interfaces per user type** (UX-P-003), the **unified service layer behind multiple surfaces** (UX-A-001), **single-path navigation** (UX-D-002/UX-X-007), **progressive disclosure** (UX-D-005), and **beauty as a functional requirement** (UX-P-004/UX-X-005). This product has six explicitly heterogeneous human roles (Finance Admin, Producer, Manager, Executive, HR/People Ops, External Partner) each with confidentiality-scoped, distinct goals, plus a worker that the plan describes writing "only via the API with delegated scoped credentials" — effectively an agent-class actor. The blueprint pushes the project toward a single service layer (the API in apps/server) from which the web client, an admin surface, and machine-readable worker/agent access all derive, never duplicating business logic per surface. The audit, explainability, and confidentiality constraints in the PRD (§9) map directly onto the blueprint's agent-presence/agent-action-record checklist family and the single-design-system requirement (one design system across all six role views including admin). Because this is a demo destined for management review, the beauty-from-the-first-screen rules (UX-P-004, UX-X-005, UX-C-009/UX-C-022) are gate conditions, and headless Playwright screenshot verification (UX-C-009/UX-C-017) is the prescribed validation channel given the distroless/k3s, no-GUI deployment model. The agent-specific rules (UX-T-004/005/009, UX-P-005, UX-A-003, agent presence/action-record checklists) are only *partially* applicable: the PRD does not declare an AI agent acting on an end-user account, but the plan's network-isolated worker that mutates state via scoped API credentials is the closest analogue and should be treated as the agent surface for these rules.

## Rule Analysis

### UX-T-001: interface-before-service-design

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The PRD defines workflows (§5) and entity lifecycles (§6) as state sequences before any screens; the plan front-loads a "Dev-scout: commission domain data model" task and the Foundation phase before any UI. Honour this by deriving every screen from a documented service flow (the lifecycle state machines in PRD §6).
- **Risk:** Commission close, dispute escalation, and guarantee/clawback flows are multi-state and gated (data-completeness, approval). Building screens first would expose service gaps as dead ends precisely where money and audit trails are at stake.

### UX-T-002: multiple-paths-same-action

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Approval-gated actions (split approval, commission run approval, exception approval, payroll export) must have one canonical route each. Avoid duplicate "approve" affordances across the manager view, finance review queue, and exception screen.
- **Risk:** Approval is the audit-critical action (PRD §9: no amount reaches payroll without an explicit approval). Non-deterministic approval paths break auditability and the worker's automated recalculation triggers.

### UX-T-003: admin-ui-afterthought

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Finance Admin operations (placement management, commission runs, exception handling, payroll export) are first-class purpose-built screens in apps/web, never psql/db tooling. The three-database design (commission_app/analytics/audit) must not leak into an "admin via DB" pattern.
- **Risk:** Finance config errors (plan versions, splits, clawback rules) are irreversible money events; without a guarded admin UI they require developer/DB intervention and lose the audit trail mandated by §9.

### UX-T-004: agent-no-specified-ux

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** No AI agent is declared in the PRD, but the plan's network-isolated worker (guarantee-expiry, clawback, event-driven recalculation) is an automated actor. Give it a typed JSON API contract (it already "writes only via the API with delegated scoped credentials"), never DOM/HTML access.
- **Risk:** If the worker were ever pointed at the web UI it would break on layout changes; a typed API keeps automated recalculation deterministic and testable.

### UX-T-005: agent-presence-invisible

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** The worker acts on producer/finance data (recalculation, clawback adjustments). Its actions should be surfaced via the existing audit DB and the PRD's "ledger adjustment + producer notification" mechanism (§5.6) so automated changes are visible, not silent.
- **Risk:** Producers must trust payout figures; silent automated adjustments to held/clawed-back amounts without a visible record violate the explainability constraint (§9).

### UX-T-006: beautiful-prototype-replaced

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** This is a demo for management review (DEMO_MODE personas, demo-seed script in the plan). The production UI must be the polished UI from the first demo; do not ship a throwaway prototype.
- **Risk:** The PRD's success depends on stakeholder/management trust; an ugly demo anchors low and is expensive to reverse.

### UX-T-007: design-coupled-to-framework

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Keep the design system (tokens, typography, spacing, components in packages/ui) and service-flow specs independent of any specific React/CSS detail; specs describe states and feedback, not components.
- **Risk:** Six role-specific surfaces sharing one design system; coupling specs to framework internals makes evolving any one role view costly across all.

### UX-T-008: complexity-exposed-by-default

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The domain is dense (tiers, desk-cost recovery, draw offset, team pools, holdbacks, clawbacks, retainer milestones). Default views show the primary task; advanced plan-config and exception controls sit behind explicit disclosure.
- **Risk:** First-use abandonment by producers/finance if the full plan-configuration surface is shown at once; obscures the core "see my payout" / "run the cycle" value.

### UX-T-009: agent-scope-undefined

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** The worker runs with "delegated scoped credentials" (plan). Define and enforce that scope explicitly (which capabilities/roles it may invoke) at the API layer, and record what it did in the audit DB.
- **Risk:** An unscoped automated recalculation/clawback job could mutate ledger entries beyond expectation with no audit limit, breaking the immutable-ledger constraint (§9).

### UX-P-001: service-delivery-precedes-surface-design

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Treat PRD §5 workflows and §6 lifecycles as the authoritative service spec; apps/server capabilities are designed from them, and apps/web renders them. The dev-scout data-model task precedes UI phases (2–7) in the plan.
- **Risk:** Screens that cannot be explained by a lifecycle state (e.g. a Commission in an undefined status) indicate a service-design gap that will surface as a payout/audit defect.

### UX-P-002: one-obvious-path-per-task

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Each user goal (run a cycle, approve a split, dispute a payout, export to payroll) gets exactly one primary path in apps/web; power-user shortcuts are explicit alternatives. Applies equally to the worker/agent API.
- **Risk:** Ambiguous routes to approval/dispute actions undermine the documented resolution trail the PRD requires for disputes (§5.4) and payouts (§5.8).

### UX-P-003: medium-appropriate-interface-per-user-type

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Most load-bearing rule. Human roles get visual surfaces in apps/web; Finance Admin gets a purpose-built operational surface (not DB tooling); the worker/automation gets the typed JSON API in apps/server. External Partner gets a scoped human surface, never raw API. No single interface serves all six roles.
- **Risk:** Confidentiality scoping (§9) and partner isolation (§5.10) demand distinct, role-shaped surfaces; collapsing them risks data leakage and unusable admin/automation paths.

### UX-P-004: beauty-is-functional-requirement

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Visual quality is a gate at every milestone (the plan's demo-seed and DEMO_MODE personas exist to show the product). Initialize the design system in packages/ui early (matches UX-C-002).
- **Risk:** Management/stakeholder review is the success condition for this demo; deferring polish forfeits the buying trigger.

### UX-P-005: agent-presence-explicit-and-bounded

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** Apply to the worker: declare its scope (delegated scoped credentials), surface its actions in the audit DB / commission_audit, and make automated adjustments reviewable (ledger entries, producer notifications). No formal end-user-account AI agent exists yet.
- **Risk:** Unbounded automated mutation of commission ledgers conflicts with the never-silently-overwritten audit constraint (§9).

### UX-P-006: designers-specify-needs-not-implementations

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** UX/service-flow specs (PRD §5/§6) reference states and feedback, not React components or CSS. Keep the spec layer technology-neutral; implementation lives in packages/ui and apps/web.
- **Risk:** Conflating spec with framework makes the six role views hard to evolve and port.

### UX-D-001: service-flow-mapping

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** The PRD §6 entity lifecycles (Placement, Commission, Invoice, Guarantee, Draw, Exception, Plan Version) are already state machines; formalize and version-control them (UX-C-018) as the authoritative UX spec from which apps/web and the worker API derive.
- **Risk:** The happy paths are stable and well-defined, so this is the right pattern (not the exploratory exception); skipping it risks inconsistent navigation across gated multi-state flows.

### UX-D-002: single-path-navigation

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Design one primary path per goal across visual UI and the worker API. Finance review queue is the single entry to approve a run; the producer portal is the single entry to dispute.
- **Risk:** Multiple prominent routes to approval/dispute degrade the deterministic, audit-recorded workflows the PRD mandates.

### UX-D-003: agent-native-interface

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** The worker already consumes a structured API ("writes only via the API"). Treat that capability API in apps/server as a first-class, versioned, typed JSON surface (UX-C-005/UX-C-020). Do not pre-build a broader agent SDK where there is no use case.
- **Risk:** If automation interacted with HTML it would break silently; the typed API keeps recalculation/clawback jobs testable and stable.

### UX-D-004: unified-design-system-across-user-types

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** One design system in packages/ui governs all visual surfaces — Finance Admin, Producer, Manager, Executive, HR, External Partner. Role-specific elements expressed within the system; admin is not exempt. Layout/navigation may diverge where workflows differ (finance ops vs. executive dashboard).
- **Risk:** Inconsistent per-role UIs erode the trust/"under control" signal and complicate confidentiality-scoped views.

### UX-D-005: progressive-disclosure

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Default views show the primary task (e.g. producer sees their payout; finance sees the review queue); advanced plan configuration, tier/desk-cost/team-pool controls, and exception parameters sit behind explicit, stable disclosure toggles.
- **Risk:** Plan-configuration complexity (PRD §5.3, Phase 3) exposed by default causes onboarding abandonment.

### UX-A-001: unified-service-layer-multiple-surfaces

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** Recommended baseline architecture. apps/server is the single service layer (capabilities, state, business logic, access control over commission_app/analytics/audit). apps/web (all six role views) and apps/worker are rendering/consuming surfaces derived from it. Matches the plan's monorepo (apps/server, apps/web, apps/worker, packages/core/db/ui).
- **Risk:** Heterogeneous user types accessing the same capabilities; duplicating business logic per surface would fracture access control and audit governance.

### UX-A-002: api-first-client-agnostic

- **Type:** architecture
- **Applicable:** partial
- **Technology implication:** The interface set is mostly known (first-party web + worker), and there is no third-party client mandate (client-facing portal is out of scope, no native payroll integration). Versioned typed API is still valuable for the worker, but full client-agnostic API-first is not required by the PRD. Prefer UX-A-001 as the primary architecture, with versioning discipline (UX-C-020) for the worker-facing capability surface.
- **Risk:** Over-investing in a fully external API contract is unwarranted; under-versioning the worker API risks breaking automated jobs.

### UX-A-003: agent-mediated-administration

- **Type:** architecture
- **Applicable:** partial
- **Technology implication:** The PRD's model is human-executed approval, not agent-initiated administration — Finance Admins explicitly approve runs and exports (§5.7, §9). The worker performs scheduled/event-driven calculations (guarantee expiry, clawback) but should *propose* ledger adjustments that humans approve, matching this pattern's "agents propose, humans execute" caveat.
- **Risk:** Letting the worker auto-execute clawbacks/recoveries without human approval violates the explicit-approval constraint (§9).

### UX-C-001: service-flow-maps-before-implementation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Write/review service-flow maps for all primary goals (from PRD §5/§6) before UI phases 2–7 begin.
- **Risk:** Implementing gated flows without maps reintroduces UX-T-001 dead ends.

### UX-C-002: design-system-initialized

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Initialize packages/ui with color tokens, typography scale, spacing scale, and at least a button primitive in Phase 1 Foundation.
- **Risk:** Late design-system start anchors stakeholders on unpolished screens (UX-X-005).

### UX-C-003: end-user-primary-paths-complete

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** apps/web implements every primary-path flow (Phases 2–7) with no dead ends, including held-payout explanations and dispute submission.
- **Risk:** Incomplete flows force users into spreadsheets/finance questions — the exact pain the product removes.

### UX-C-004: admin-interface-uses-shared-design-system

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Finance Admin surface is a distinct screen using packages/ui; no raw DB UI against the three databases.
- **Risk:** A DB-backed admin path is unaudited and inaccessible to non-developers (UX-X-002).

### UX-C-005: agent-api-routes-typed-json

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Worker-invoked capabilities in apps/server return typed JSON, not HTML. Applies to any capability the worker (or future agent) calls.
- **Risk:** HTML responses would force fragile parsing in automated jobs.

### UX-C-006: agent-presence-record-readable

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** No declared per-account AI agent today. If/when one exists, persist an AgentPresence record readable by the account holder. For now the worker's identity/scope should be recorded in commission_audit.
- **Risk:** Invisible automated actors violate trust (UX-X-004); low priority while only an internal worker exists.

### UX-C-007: agent-action-record-written

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Worker operations against the ledger should be written to commission_audit (the audit DB already exists in the plan) and surfaced to affected producers (§5.6 notifications).
- **Risk:** Unrecorded automated adjustments break the immutable-audit constraint (§9).

### UX-C-008: single-path-navigation-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify no flow has two equally prominent routes to the same destination, especially approval and export actions.
- **Risk:** Duplicate prominent approval routes (UX-X-007) break deterministic audit.

### UX-C-009: visual-quality-verified-headless

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify visual quality via headless Playwright screenshots reviewed by a vision-capable model or stakeholder — no live browser session. Aligns with the distroless/k3s, no-GUI deployment in Phase 1.
- **Risk:** Without headless verification, beauty (UX-P-004) cannot be confirmed in this server-only environment.

### UX-C-010: specs-no-framework-references

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Service-flow/UX specs must not name React, specific components, or CSS properties.
- **Risk:** Framework-coupled specs reintroduce UX-T-007.

### UX-C-011: progressive-disclosure-implemented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Advanced options (plan config, exception params) present but not in the default view; verified with a first-use walkthrough.
- **Risk:** Default-exposed complexity (UX-X-008) slows onboarding (a tracked success metric: time to first approved run).

### UX-C-012: agent-scope-displayed-in-settings

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** No end-user-facing AI agent today; if added, show its authorized scope and last-acted time in account settings. Currently N/A to the internal worker.
- **Risk:** Low while only an internal worker exists.

### UX-C-013: agent-action-log-accessible

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** The existing audit/ledger views (manager attribution timeline, producer payout derivation) should make automated adjustment history paginated, searchable, and accessible without dev tooling.
- **Risk:** Dev-tool-only logs violate the no-DB-access admin principle.

### UX-C-014: admin-no-database-access-required

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** The Finance Admin UI covers all operational tasks (placement mgmt, runs, exceptions, export) without psql/terminal/out-of-band API calls.
- **Risk:** Any task requiring DB access is an unspecified, unaudited admin path (UX-X-002).

### UX-C-015: agent-sdk-typed-signatures

- **Type:** checklist
- **Applicable:** no
- **Technology implication:** No published agent SDK is in scope; the worker consumes the internal API directly. Do not pre-build an SDK (UX-D-003 tradeoff).
- **Risk:** N/A.

### UX-C-016: usability-review-all-user-types

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Review with at least one human end-user and one administrator across the role surfaces; an "agent integration test" maps to a worker API integration test rather than an external agent.
- **Risk:** Skipping per-role review leaves confidentiality-scoped views (§9) unvalidated.

### UX-C-017: headless-chromium-testing

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** All apps/web surfaces tested in headless Chromium via Playwright; no GUI/display server/live window — consistent with distroless containers and CI (the plan's test-api/quality-gate workflows).
- **Risk:** GUI-dependent tests cannot run in the distroless/k3s CI environment.

### UX-C-018: service-flow-docs-version-controlled

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Publish and version-control the service-flow docs (the PRD §6 lifecycles formalized) alongside implementation in the repo.
- **Risk:** Drift between flows and code reintroduces service-design gaps.

### UX-C-019: design-system-documented-static

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Document the packages/ui design system as static HTML/markdown generated by the build pipeline — no dev server or browser-only tooling to read it, matching the no-GUI deployment posture.
- **Risk:** Browser-only catalogues are unreadable in the server-only CI/deploy environment.

### UX-C-020: agent-capability-surface-versioned

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Version the worker-facing capability API; breaking changes require a new version, not in-place modification, so scheduled recalculation/clawback jobs do not break silently.
- **Risk:** In-place API changes break automated jobs mid-cycle.

### UX-C-021: agent-data-exported-on-request

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Maps to the PRD's audit-evidence and document-export needs (§7 Document and File Storage); automated-action history in commission_audit should be includable in account data export.
- **Risk:** Incomplete export omits automated adjustment provenance.

### UX-C-022: ux-review-non-technical-signoff

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Each milestone gets explicit non-technical stakeholder sign-off — essential given this is a management-review demo.
- **Risk:** Without non-technical sign-off, the beauty gate (UX-P-004) is unverified for the actual reviewers.

### UX-X-001: screen-first-design

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden. Every screen must map to a PRD §6 lifecycle state; do not design screens before flows.
- **Risk:** Screens unexplained by a state expose service gaps as dead ends in money-critical flows.

### UX-X-002: developer-console-as-admin-ui

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden. No substituting psql/terminal/API clients for the Finance Admin or HR operational surfaces.
- **Risk:** Unspecified, untested, unaudited administration of commission data violates §9.

### UX-X-003: browser-automation-as-agent-integration

- **Type:** antipattern
- **Applicable:** partial
- **Technology implication:** The worker must never be pointed at the web UI / DOM; it uses the typed API. (No external agent exists, so partially applicable.)
- **Risk:** DOM-based automation breaks silently on layout change and is non-deterministic to test.

### UX-X-004: invisible-agent-participation

- **Type:** antipattern
- **Applicable:** partial
- **Technology implication:** Automated worker actions on producer/finance data must be visible via audit records and producer notifications, not silent.
- **Risk:** Silent automated ledger changes break producer trust and the explainability constraint (§9).

### UX-X-005: beauty-deferred

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden. The first demo (DEMO_MODE personas, demo-seed) ships at intended quality; no end-of-project polish pass.
- **Risk:** A low-quality first demo anchors management and forfeits the buying trigger.

### UX-X-006: one-interface-all-actor-types

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden. Do not build one screen serving Finance Admin, Producer, Executive, External Partner, and the worker together. Shared design-system foundations do not imply a shared surface.
- **Risk:** A single combined surface fails confidentiality scoping (§9) and partner isolation (§5.10) and serves no role well.

### UX-X-007: multiple-prominent-paths-same-action

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden. One canonical button/route/endpoint per action (approve run, approve split, export, dispute).
- **Risk:** Two equivalent approval routes create an unresolved design conflict in audit-critical actions.

### UX-X-008: complexity-surfaced-by-default

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden. Default views are designed for the primary task; tiers, desk-cost recovery, team pools, exception params require deliberate disclosure.
- **Risk:** First-use cognitive overload slows producers/finance and harms the time-to-first-approved-run metric.

## Recommended Technology Choices

- **Single unified service layer in apps/server** as the one home for capabilities, state, business logic, and access control over the three databases (commission_app/analytics/audit); apps/web and apps/worker derive from it. (UX-A-001, UX-P-001)
- **One design system in packages/ui** — color tokens, typography, spacing, primitives — governing all six role surfaces including Finance Admin, initialized in Phase 1. (UX-D-004, UX-C-002, UX-P-004)
- **Distinct purpose-built screens per actor type** in apps/web (Finance Admin ops, Producer portal, Manager, Executive dashboard, HR, scoped External Partner) — never one shared surface, never raw DB tooling for admins. (UX-P-003, UX-X-002, UX-X-006, UX-C-014)
- **Typed JSON capability API for the worker/automation surface**, versioned with no in-place breaking changes; the worker writes only via this API with scoped credentials. (UX-D-003, UX-C-005, UX-C-020, UX-T-009)
- **Worker proposes, humans approve** — automated guarantee-expiry/clawback/recalculation jobs post reviewable ledger adjustments rather than auto-executing money movements. (UX-A-003, constraint §9)
- **Automated-action visibility via commission_audit + producer notifications** so worker-driven changes are auditable and surfaced, not silent. (UX-P-005, UX-X-004, UX-C-007/UX-C-013/UX-C-021)
- **Service-flow state machines (formalized PRD §6) as version-controlled UX specs**, technology-neutral (no framework references), authored before UI phases. (UX-D-001, UX-C-001, UX-C-010, UX-C-018)
- **Single primary path per goal** across web and API, with verification that no flow has duplicate prominent routes. (UX-D-002, UX-C-008, UX-X-007)
- **Progressive disclosure** for dense plan-configuration and exception controls; primary task only in default views. (UX-D-005, UX-C-011, UX-X-008)
- **Headless Playwright screenshot + headless Chromium testing** as the visual-quality and surface-testing channel, with static (HTML/markdown) design-system docs generated by the build pipeline — matching the distroless/k3s no-GUI deployment. (UX-C-009, UX-C-017, UX-C-019)
- **Milestone UX reviews with non-technical stakeholder sign-off**, since the product is a management-review demo. (UX-P-004, UX-C-022, UX-X-005)

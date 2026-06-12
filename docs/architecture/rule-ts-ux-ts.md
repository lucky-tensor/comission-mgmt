# Blueprint: IMPL-UX (UX — TypeScript Implementation) — Architecture Research

**Source:** blueprint/rules/implementations/ts/ux-ts.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint governs how the project's user-facing surfaces are structured in TypeScript. The most load-bearing rules for this product are the package/app layout (IMPL-UX-001), the Capability and ActorType abstractions (IMPL-UX-002, IMPL-UX-003) that map directly to the PRD's six distinct user roles and their strictly scoped visibility (Finance Admin, Producer, Manager, Executive, HR, External Partner), and the service-flow modeling interfaces (IMPL-UX-006, IMPL-UX-007) that mirror the PRD's rich entity lifecycles (Placement, Commission, Invoice, Guarantee, Draw, Exception, Plan Version). Because the platform's defining requirement is governed, auditable, role-scoped visibility — a producer must see their own full derivation but not others' amounts, an external partner sees only their own deals — the Capability interface with `allowedActors` and `requiredScopes` is the central access-control unit and should drive every surface. The buy/DIY decisions (React, Tailwind buy; token generator, form state, HTTP client, component docs DIY) and the headless/no-GUI tooling constraints (IMPL-UX-015) directly shape the toolchain for the k3s/distroless/Bun environment described in the Plan. The agent-specific interfaces (IMPL-UX-004, IMPL-UX-005, agent ActorType, agent SDK) are only partially applicable: neither the PRD nor the Plan describes autonomous agents acting on accounts, so these are forward-looking scaffolding rather than current requirements.

## Rule Analysis

### IMPL-UX-001: monorepo-surface-layout

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Adopt a Bun monorepo with shared `packages/ui` (design-system, end-user, admin), `packages/services` (capability-api), and per-actor apps. The Plan already specifies a Bun workspace (`apps/server`, `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/ui`); the blueprint argues each actor type should map to a distinct app/surface consuming shared packages. With six PRD roles (Finance Admin, Producer, Manager, Executive, HR, External Partner) plus a confidentiality-isolated External Partner, the surfaces should at minimum separate the internal admin/finance experience, the producer/partner self-service experience, and the design-system package shared across both.
- **Risk:** If surfaces are not cleanly separated and built on a shared service layer, the strict visibility/confidentiality constraints (PRD §9 — producers must not see others' amounts; partners see only their own deals) become ad-hoc per-page checks that are easy to violate, exposing margin, draw balances, or co-producer payouts.

### IMPL-UX-002: capability-interface

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Define a TypeScript `Capability` interface (`id`, `allowedActors: ActorType[]`, `requiredScopes: string[]`) as the atomic unit of UX and access control across all surfaces. This is the natural home for the PRD's role-and-scope matrix and aligns with the Plan's "six application roles enforced in middleware" and RBAC. Every workflow action (create placement, approve run, export payroll, view payout derivation, submit dispute, view partner deals) becomes a Capability gated by actor type and scope.
- **Risk:** Without a single capability abstraction, access decisions scatter across the codebase. Given the audit/compliance mandate (no commission reaches payroll without explicit Finance Admin approval; scoped visibility per hierarchy), inconsistent gating risks both confidentiality breaches and unauthorized approvals reaching payroll.

### IMPL-UX-003: actor-type-enum

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Define an `ActorType` union. The blueprint's canonical form is `'end-user' | 'admin' | 'agent'`, but this project's PRD defines six human roles and no autonomous agent. The actor-type concept maps cleanly to surface selection (admin/finance vs. end-user producer/partner), while the finer six-role RBAC lives in the scope/role layer (Plan: "six application roles"). The `'agent'` member is currently unused — no PRD/Plan requirement describes an agent acting on accounts.
- **Risk:** If actor type is conflated with the six business roles, the surface-routing logic and the fine-grained RBAC become tangled. Keep actor type for medium/surface selection and use scopes for role-level gating.

### IMPL-UX-004: agent-presence-interface

- **Type:** implementation
- **Applicable:** no
- **Technology implication:** Defines an `AgentPresence` interface with the invariant `visibleToAccountHolder: true`. Neither the PRD nor the Plan describes an autonomous agent bound to an account; the platform's actors are human roles plus system/worker jobs (guarantee-expiry, clawback recalculation). The Plan's `apps/worker` is a network-isolated task runner, not an account-bound agent surface. This rule is forward-looking scaffolding only.

### IMPL-UX-005: agent-action-record-interface

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Defines `AgentActionRecord` (agentId, accountId, capabilityId, human-readable inputSummary, outcome, timestamp). There is no agent actor today, so the agent-specific form does not apply. However, the underlying pattern — a human-readable, outcome-stamped action record per operation — strongly aligns with the PRD's pervasive audit mandate (every change recorded with timestamp, actor, reason; nothing silently overwritten) and the Plan's `commission_audit` database. The action-record shape is a good model for the platform's general actor-action audit log even though the "agent" framing is not used.
- **Risk:** If the audit log lacks a plain-language `inputSummary` and explicit `outcome`, the PRD's explainability and dispute-resolution requirements (attribution timeline, documented escalation rationale) cannot be satisfied from the trail.

### IMPL-UX-006: service-flow-state-interface

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Model UX from `ServiceFlowState` (`id`, `label`, `availableTransitions`) before designing surfaces. The PRD §6 specifies explicit lifecycles for Placement, Commission, Invoice, Guarantee Period, Draw Balance, Exception, and Plan Version. These should be encoded as authoritative state-machine definitions driving the UI, not inferred per-screen. The Plan's phased delivery (Ledger → Rules Engine → Finance Close → Risk) maps onto these state machines.
- **Risk:** If surfaces are built without a canonical state model, the many alternate paths (Active→Refunded/Disputed, Guarantee Active→Clawback Triggered, Paid→Clawback Initiated→Recovered) get implemented inconsistently, producing states the UI cannot represent and breaking the audit/explainability guarantees.

### IMPL-UX-007: service-flow-transition-interface

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Model transitions with `ServiceFlowTransition` (`id`, `trigger: user-action | system-event | agent-action`, `targetStateId`, `requiredCapability`). The PRD has clear transition triggers: user actions (Finance Admin approves a run, Manager approves split), system events (invoice marked paid releases collection-gated commission, guarantee expiration). Each transition's `requiredCapability` ties back to IMPL-UX-002, enforcing that, e.g., only a Finance Admin capability can drive Approved→Payable. The `agent-action` trigger is unused given no agent actor; `system-event` covers the worker-driven recalculations.
- **Risk:** If transitions are not capability-gated, the constraint "no commission amount may reach payroll without an explicit approval action by an authorized Finance Admin" can be bypassed by direct state changes.

### IMPL-UX-008: react-buy-decision

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Use React for the UI component model in `apps/web` (and any admin surface). This is a buy decision — build no custom rendering layer. Consistent with the Plan's `packages/ui` and `apps/web`. The data-dense surfaces (review queues, executive dashboards, payout statements) justify a mature component model.
- **Risk:** Reinventing a rendering layer would waste effort and produce a fragile UI for the rich, stateful screens (review queues, dashboards) the PRD demands.

### IMPL-UX-009: tailwind-buy-decision

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Use Tailwind CSS for design tokens and utility classes, providing the token system for the shared design system in `packages/ui`. Buy, do not hand-roll CSS at scale. Supports the unified design system across the multiple PRD surfaces.
- **Risk:** Hand-rolled CSS across producer, finance, executive, and partner surfaces drifts visually and becomes unmaintainable, undermining the unified design system.

### IMPL-UX-010: design-token-generator-diy

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Implement design tokens as a DIY Tailwind v4 CSS `@theme` (in `apps/web/src/index.css`) consumed by the build; do not add an external token-generation package. The `@theme` is the single source of truth that feeds the utility classes used by the shared design system in `packages/ui` and every web surface.
- **Risk:** Adding an external token toolchain is unnecessary complexity for a single-product design system and adds dependency/maintenance burden with no benefit at this scale.

### IMPL-UX-011: agent-sdk-http-client-diy

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Any HTTP client (the blueprint frames this as an agent SDK) should be a thin (<50 line) typed wrapper over Bun-native `fetch`; do not add an HTTP client library. There is no agent SDK requirement in the PRD/Plan, but the same DIY-fetch principle applies to the web app's API calls and to the Plan's network-isolated worker, which "writes only via the API with delegated scoped credentials" — a thin typed fetch wrapper is the right tool there.
- **Risk:** Pulling in a heavy HTTP client library contradicts the distroless/minimal-dependency posture in the Plan and bloats the container.

### IMPL-UX-012: component-docs-static-build

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Component documentation must be a DIY static markdown or auto-generated HTML artifact produced by the build pipeline. Storybook or any runtime dev-server documentation tool is forbidden. Fits the Plan's CI pipeline (GitHub Actions) and distroless deployment.
- **Risk:** A runtime doc server cannot run in the headless k3s/distroless environment (see IMPL-UX-015) and would add an unsupported long-running process to the toolchain.

### IMPL-UX-013: form-state-react-native

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Manage form state with React `useState` and controlled inputs; add no external form library. The PRD has many forms (placement creation, contribution assignment, exception requests, dispute submission, invoice entry), all of which are tractable with native React at this scale.
- **Risk:** An external form library is unwarranted weight; the platform's forms are bounded and do not justify the added dependency or learning surface.

### IMPL-UX-014: no-technology-specific-specs

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Design/spec documents (PRD, plan, and any design docs) must describe user states and transitions, not implementation details ("use a React modal"). The PRD already complies — it describes lifecycles, workflows, and visibility rules without prescribing UI mechanics. Maintain this separation: specs map to IMPL-UX-006/007 state models, implementations satisfy them in React/Tailwind independently.
- **Risk:** Coupling design to framework specifics makes the UX brittle to refactors and conflates the product specification with the implementation, eroding the service-flow-first discipline.

### IMPL-UX-015: no-gui-dependent-tooling

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The deployment target is hosted Linux with no display server (Plan: distroless containers, k3s/k3d, GCP VM). Prohibit any tool needing a live browser window, native GUI, or local dev server (Storybook, Figma desktop agents, visual diff GUIs). Evaluate visual output via headless Playwright screenshots producing files/stdout. This shapes the entire UI-testing and component-docs toolchain in CI.
- **Risk:** A GUI-dependent tool cannot run in the headless CI/k3s environment described in the Plan, breaking the build/test pipeline and blocking the four-phase health-gated rollout.

## Recommended Technology Choices

- **Bun monorepo with per-actor app surfaces over a shared `packages/ui` and capability-API service layer** — separate internal finance/admin, producer/partner self-service, and external-partner-isolated surfaces (IMPL-UX-001).
- **`Capability { id, allowedActors, requiredScopes }` as the single access-control unit**, backing the six-role RBAC enforced in middleware and the strict per-role visibility/confidentiality rules (IMPL-UX-002, IMPL-UX-003).
- **`ActorType` union for surface/medium selection, with the six business roles modeled as scopes** rather than actor types (IMPL-UX-003).
- **Canonical `ServiceFlowState` / `ServiceFlowTransition` state machines** encoding the PRD §6 lifecycles (Placement, Commission, Invoice, Guarantee, Draw, Exception, Plan Version), with each transition gated by a `requiredCapability` so payroll-affecting state changes require Finance Admin authority (IMPL-UX-006, IMPL-UX-007).
- **React** for the UI component model in `apps/web` (IMPL-UX-008).
- **Tailwind CSS** for design tokens/utilities feeding the shared design system (IMPL-UX-009).
- **DIY JSON design-token file** consumed at build time — no external token package (IMPL-UX-010).
- **Thin (<50 line) typed wrapper over Bun-native `fetch`** for all HTTP/API access (web app and worker), no HTTP client library (IMPL-UX-011).
- **DIY static markdown / auto-generated HTML component docs** from the CI pipeline — no Storybook (IMPL-UX-012).
- **Native React `useState` + controlled inputs** for all forms — no form library (IMPL-UX-013).
- **Spec discipline:** keep PRD/design docs free of framework-specific UI mechanics (IMPL-UX-014).
- **Headless Playwright screenshots** as the only visual-evaluation mechanism; ban all GUI/display-server-dependent tooling to fit distroless/k3s CI (IMPL-UX-015).
- **Action-record-shaped audit entries** (human-readable input summary + explicit outcome) feeding the `commission_audit` database, adapting the IMPL-UX-005 pattern to the PRD's audit/explainability mandate (IMPL-UX-005).

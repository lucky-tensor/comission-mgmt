# Blueprint: IMPL-ENV (Environment — TypeScript Implementation) — Architecture Research

**Source:** blueprint/rules/implementations/ts/env-ts.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint fixes the TypeScript host toolchain and runtime environment that every later phase of the commission platform depends on. The most load-bearing rules for this project are IMPL-ENV-004/010 (Bun as the single runtime, bundler, test runner, and package manager) and IMPL-ENV-006/012 (Playwright host dependencies for headless Chromium), because the Plan's Phase 1 Foundation explicitly commits to a Bun workspace monorepo (apps/server, apps/web, apps/worker, packages/*) and a CI pipeline that must run unit, API, migration, and browser-level checks. IMPL-ENV-001/002/011 (git + gh) underpin the GitHub Actions CI workflows and branch protection the Plan mandates. IMPL-ENV-008 (Calypso dev server on port 31415) and the agent/tmux host rules (003/005/009) govern the demo and deployment story (local-demo k3d + cloudflared tunnel, hot-reload preview) rather than the product domain itself. Net effect: this blueprint forecloses Node/npm/webpack/jest and a DIY GitHub or browser-automation layer, standardizing the build and verification substrate that the three-database, passkey-authenticated, distroless-deployed application is built on.

## Rule Analysis

### IMPL-ENV-001: host-dep-git

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** git is a required host dependency for version control. The Plan's Phase 1 CI pipeline (GitHub Actions workflows, branch protection requiring all checks green) is built on a git/GitHub repository, so git is mandatory.
- **Risk:** Without git there is no version control, no GitHub Actions trigger surface, and no branch protection — the entire Foundation CI workflow cannot exist.

### IMPL-ENV-002: host-dep-gh-https

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The GitHub CLI (`gh`) is required, authenticated via `gh auth login -p https -w`. Supports the Plan's GitHub Actions per-suite workflows, branch protection setup, and the issue/PR-driven development loop this repo uses.
- **Risk:** Without authenticated `gh`, programmatic GitHub operations (PRs, branch protection, CI orchestration) become manual and fragile, slowing the issue-per-feature delivery the Plan assumes.

### IMPL-ENV-003: host-dep-tmux

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** tmux is required for persistent terminal sessions that survive SSH disconnects on the cloud host. Relevant to the Plan's deployment scripts (local-demo watch loop, GCP VM provisioning/deploy) where long-running sessions run on a remote host, but it governs the operating environment rather than the commission product.
- **Risk:** Long-running deploy or hot-reload sessions die on SSH disconnect, interrupting the demo/deployment workflows described in Phase 1.

### IMPL-ENV-004: host-dep-bun

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Bun is the JavaScript/TypeScript runtime and package manager, replacing Node, npm, webpack, and jest in one binary. Directly mandated by the Plan's stated stack ("TypeScript + Bun") and the Bun workspace monorepo (apps/server, apps/web, apps/worker, packages/core, packages/db, packages/ui) with multi-stage distroless Dockerfile.
- **Risk:** Using Node/npm/webpack/jest instead would contradict the committed stack, fragment the toolchain, and break the single-binary distroless build assumption the Foundation depends on.

### IMPL-ENV-005: host-dep-agent-cli

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** An agent CLI (Claude Code, Cursor server, Gemini CLI, or equivalent) must run on the cloud host, not locally. Governs the agent-driven development environment this repo uses; not a product runtime dependency of the commission platform.
- **Risk:** A locally-run agent loses access to the cloud host's toolchain, ports (31415), and persistent sessions, undermining the remote development model.

### IMPL-ENV-006: host-dep-playwright

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Playwright OS dependencies for headless Chromium are required on the host, installed via `bunx playwright install-deps`. Supports the Plan's CI pipeline browser-level testing of the web app (apps/web, packages/ui) — producer payout portal, finance review queues, executive dashboards all need end-to-end verification.
- **Risk:** Without Playwright host deps, headless Chromium fails to launch, so browser/E2E checks in CI cannot run and UI regressions in the multi-role web surfaces ship unverified.

### IMPL-ENV-007: session-start-read-context

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** At session start the agent reads all files in `agent-context/` before any development or documentation work. A process rule for the agent development workflow; no direct product-technology choice, but it conditions how Foundation and later phases are executed.
- **Risk:** Skipping agent-context leads to work that ignores established project conventions and decisions, producing rework.

### IMPL-ENV-008: preview-server-port-31415

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** The Calypso dev server binds to port 31415, a project-wide convention that must be exposed on the host firewall. Maps to the Plan's `scripts/local-demo.ts` (k3d + cloudflared tunnel + hot-reload) and the web preview used to demo the producer portal and dashboards.
- **Risk:** A non-standard or unexposed port breaks the cloudflared-tunneled demo preview and any agent/browser verification that expects the convention.

### IMPL-ENV-009: justified-tmux

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** tmux is a buy decision — decades-stable session persistence; a DIY multiplexer is unjustifiable. Confirms tmux as the standard for persistent host sessions used by the deployment/demo scripts.
- **Risk:** N/A (justification rule; reinforces IMPL-ENV-003).

### IMPL-ENV-010: justified-bun

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Bun is a buy decision — runtime, bundler, test runner, and package manager in one binary, replacing Node + npm + webpack + jest. Justifies the Plan's single-toolchain Bun workspace and the per-suite test split (test-unit, test-api, test-migration) running on Bun's test runner.
- **Risk:** Adopting separate Node/npm/webpack/jest tools reintroduces multi-tool maintenance and dependency surface the single-binary decision is meant to eliminate, complicating the distroless container build.

### IMPL-ENV-011: justified-gh

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** `gh` is a buy decision — GitHub API integration with auth management; DIY is fragile and under-tested. Justifies relying on `gh` for the Plan's CI workflows, branch protection, and PR automation rather than hand-rolled GitHub API calls.
- **Risk:** A DIY GitHub integration is fragile and under-tested, jeopardizing the branch-protection-gated, all-checks-green delivery model the Foundation requires.

### IMPL-ENV-012: justified-playwright

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Playwright is a buy decision — headless browser automation with cross-browser support; no viable DIY alternative. Justifies Playwright as the standard for the Plan's browser-level CI verification of the multi-role web application.
- **Risk:** Building a DIY browser-automation layer is infeasible and would leave the producer/finance/executive UI surfaces without reliable automated end-to-end coverage.

## Recommended Technology Choices

- **Bun** as the sole JavaScript/TypeScript runtime, bundler, test runner, and package manager — no Node/npm/webpack/jest (IMPL-ENV-004, IMPL-ENV-010). Drives the Plan's Bun-workspace monorepo and per-suite test pipeline.
- **git** as the version control host dependency (IMPL-ENV-001) — substrate for the GitHub Actions CI pipeline and branch protection.
- **GitHub CLI (`gh`)**, authenticated via `gh auth login -p https -w`, for all GitHub API/PR/branch-protection operations rather than custom API code (IMPL-ENV-002, IMPL-ENV-011).
- **Playwright** with host OS deps installed via `bunx playwright install-deps` for headless Chromium browser/E2E testing of the multi-role web surfaces (IMPL-ENV-006, IMPL-ENV-012).
- **tmux** for persistent SSH-resilient host sessions used by deployment and hot-reload demo scripts (IMPL-ENV-003, IMPL-ENV-009).
- **Agent CLI on the cloud host** (Claude Code / Cursor server / Gemini CLI equivalent), run remotely not locally (IMPL-ENV-005).
- **Calypso dev/preview server on port 31415**, exposed on the host firewall, as the project-wide preview convention for the local-demo cloudflared tunnel (IMPL-ENV-008).
- **`agent-context/` read-at-session-start** as a mandatory pre-development process step (IMPL-ENV-007).

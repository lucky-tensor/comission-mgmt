# Blueprint: ENV (Environment) — Architecture Research

**Source:** blueprint/rules/blueprints/env.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

The ENV blueprint is highly load-bearing for this project because the Plan's Phase 1 Foundation explicitly commits to the exact topology the blueprint prescribes: distroless containers, k3s (k3d locally), GCP-hosted production, three databases, a network-isolated worker that writes only via the API, and health-gated rolling deployment. The most consequential rules are the three-container separation (ENV-D-002), the immutable release artifact and orchestrator-driven rolling release (ENV-D-001/ENV-D-006) which align with the planned GitHub Actions CI and four-phase health-gated rollout, the ephemeral isolated test database pattern (ENV-P-005/ENV-D-003) needed for the migration and API test suites, the agent-provisioned cluster (ENV-P-006/ENV-D-004) realized by `scripts/gcp/` and `scripts/local-demo.ts`, and the prototype-is-production / no-environment-config-branches principles (ENV-P-001/ENV-X-005) which directly conflict with the Plan's `DEMO_MODE` flag and three separate environment manifests and therefore demand careful design. The audit-and-compliance and explainability requirements in PRD §9 (never silently overwrite; full derivation) reinforce ENV-T-002/ENV-X-004 (no direct agent database access — all mutation through the audited data layer). These rules collectively fix the technology stack: k3s/k3d, distroless images, GCP (Cloud KMS, AlloyDB, VM), GitHub Actions, Docker on host for ephemeral test DBs, tmux, and remote-SSH IDE attachment.

## Rule Analysis

### ENV-T-001: frontend-runtime-build-compromise

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The web app (apps/web) must be built on the host/CI into a release bundle; the frontend container serves only that pre-built artifact. No `bun install`/`tsc`/bundling in the frontend image (planned multi-stage distroless Dockerfile supports this).
- **Risk:** Untested commission UI could be served at a demo or to a customer, undermining the governed-record trust that is the product's core value (PRD §1).

### ENV-T-002: direct-database-access-by-agent

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Agents and workers must reach the three PostgreSQL databases (commission_app, commission_analytics, commission_audit) only through the application data layer/API, never via shell or admin client. The planned worker writes "only via the API with delegated scoped credentials."
- **Risk:** Direct mutation bypasses the immutable audit trail required by PRD §9 ("never silently overwritten — with timestamp, actor, and reason"), breaking the auditability guarantee the platform sells.

### ENV-T-003: container-immutability-violation

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Frontend and database containers must be immutable distroless images with no package manager. The Plan's distroless containers and "Database Container distroless, no shell" align.
- **Risk:** Drift between the demoed and production images reintroduces the environment delta the blueprint exists to eliminate; mutations indicate compromise.

### ENV-T-004: topology-parity-divergence

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The k8s manifests must not behave differently across the three planned environments. The Plan's "k8s/ manifests for three environments" and `DEMO_MODE` flag are precisely the surface where divergence can creep in and must be limited to credentials/scale, not behavior.
- **Risk:** A demo cluster that behaves differently from production means a commission run validated in demo could fail in production — fatal for a finance-grade product.

### ENV-T-005: agent-on-local-laptop

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Claude Code / agent CLIs run on the cloud (GCP VM) host, not the developer laptop. Reinforces the planned GCP VM provisioning.
- **Risk:** Local toolchain assumptions (line endings, Bun version, OS) silently encoded into the commission engine code.

### ENV-T-006: state-durability-loss

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** All durable state lives in version control or the database volume (AlloyDB / Postgres volume). No commission data, audit log, or config on the host filesystem. Demo seed is a script (scripts/demo-seed.ts), i.e. reproducible, not hand-loaded state.
- **Risk:** Loss of the immutable commission ledger/audit trail — the system of record the product promises — on cluster reprovision.

### ENV-T-007: release-gate-bypass

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Frontend pulls only tagged/digest-pinned artifacts via CI. The planned GitHub Actions pipeline with branch protection and "CI patches deployment with immutable digest" satisfies this.
- **Risk:** Unreleased commission-calculation logic reaching users yields incorrect payouts with no test gate — direct financial and trust harm.

### ENV-T-008: session-continuity-loss

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Run agent sessions inside tmux on the GCP host (tmux is listed in the blueprint host toolchain).
- **Risk:** Lost in-flight work during long Foundation/engine build tasks; partial changes left in an inconsistent state.

### ENV-T-009: test-hits-live-database

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The planned test-api and test-migration suites must target an ephemeral Postgres 16 container, never commission_app/analytics/audit cluster databases. Network policy must make the cluster DB unreachable from the host.
- **Risk:** Tests could corrupt or read real/demo commission and payout data, violating the non-destructive guarantee and confidentiality (PRD §9).

### ENV-T-010: leaked-ephemeral-test-containers

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Test runner must tear down ephemeral Postgres containers in a `finally` block. Relevant to the per-suite GitHub Actions test jobs.
- **Risk:** Zombie containers exhaust host disk/ports, breaking the CI pipeline that gates all releases.

### ENV-P-001: prototype-is-production

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** The k3d local demo, the GCP deployment, and any customer demo share one container topology and one build. The Plan's local-demo (k3d) and gcp deploy paths must be the same artifacts, differing only in provisioning.
- **Risk:** A "demo build" of the commission platform that diverges from production reintroduces exactly the fragmented, untrusted-record problem the product solves.

### ENV-P-002: role-specialized-capability-constrained-containers

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Frontend (serve only), worker (AI/scheduled task daemon, API-only writes), database (binary only) — each minimal-capability. Matches the planned apps/server, apps/web, apps/worker split and network-isolated worker.
- **Risk:** An over-capable worker or frontend could mutate commission data outside the audited path.

### ENV-P-003: building-from-source-host-only

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Bun build/transpile/bundle of apps/web and apps/server happens on host/CI; release images contain only runtime artifacts. Multi-stage distroless Dockerfile (Plan) is the mechanism.
- **Risk:** Build-on-deploy in the frontend would serve unvetted commission logic.

### ENV-P-004: coding-assistants-on-host-workers-in-container

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Claude/Gemini CLIs run on the GCP host; the long-running worker (guarantee-expiry, clawback, recalculation daemons from the Plan's task-queue issue) runs in the worker container. Do not conflate.
- **Risk:** Misplacing the worker on the host or the assistant in a container breaks capability isolation and the API-only write contract.

### ENV-P-005: ephemeral-isolated-test-databases

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Each DB-dependent test (notably the commission engine and migration suites) spins up a fresh disposable Postgres 16 container with migrations applied from scratch; no link to cluster DBs.
- **Risk:** Tests touching real commission/audit data destroy the non-destructive and confidentiality guarantees (PRD §9).

### ENV-P-006: agent-provisioned-environment

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** A versioned, re-runnable provisioning script (Plan's `scripts/gcp/` provision VPC/AlloyDB/VM and `scripts/local-demo.ts`) installs k3s/k3d and applies manifests. No manual server config.
- **Risk:** Undocumented cluster state makes the finance-grade system non-reproducible and unauditable.

### ENV-D-001: immutable-release-artifact

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Host/CI builds a bundle, passes the per-suite GitHub Actions gates, tags/digests a version, and the frontend fetches by tag/digest. Frontend image holds no VCS credentials or build tooling.
- **Risk:** Without the gate, incorrect commission calculations or UI ship unvetted.

### ENV-D-002: three-container-separation

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Frontend (serve apps/web bundle, no build/no persistent writes), Worker (apps/worker, no shell, read-only queue views, API-only writes), Database (distroless Postgres 16, volume-mounted, no shell, no direct agent access), orchestrated by k3s. apps/server is the API mediating worker/frontend writes. This is the central architectural mapping for the whole project.
- **Risk:** Collapsing roles makes the capability and audit constraints (PRD §9) unenforceable.

### ENV-D-003: ephemeral-test-containers

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Host runs Docker directly; test runner starts a fresh Postgres 16 container on a randomized port, applies migrations from scratch (validating them — matches the planned test-migration suite), runs tests, removes the container in a `finally` block. Cluster DB unreachable via k8s NetworkPolicy.
- **Risk:** Either contaminated production data or leaked containers breaking CI.

### ENV-D-004: agent-provisioned-cluster

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** `scripts/gcp/` (provision + deploy with four-phase health-gated rollout + doctor) and `deploy.sh` realize a version-controlled, idempotent provisioning of k3s, three container types, networking, and ingress on GCP. Provisioning API key should be revocable post-provision.
- **Risk:** Non-reproducible infrastructure under a product that promises auditability.

### ENV-D-005: remote-first-ide-attachment

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Developer IDE (VS Code / Cursor Remote SSH or JetBrains Gateway) attaches to the GCP host; language server, linter, formatter, and Bun run on the host.
- **Risk:** Local-file editing reintroduces platform-specific behavior into the codebase.

### ENV-D-006: orchestrator-driven-rolling-release

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** k3s owns the release lifecycle; CI pushes an image with immutable digest and patches the Deployment/StatefulSet via a narrow-scoped service account; rolling update with readiness probes, auto-rollback on failed probe. Directly matches the Plan's "four-phase health-gated rollout" and `/healthz` + `/readyz` endpoints.
- **Risk:** A bad commission-engine deploy without auto-rollback could disrupt active commission cycles.

### ENV-A-001: single-node-kubernetes-cluster

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** The default deployment for this solo/demo project: one GCP host running k3s with the three container types; durable state in version control and the database volume backup. This is the MVP target topology.
- **Risk:** Node failure takes everything down; acceptable for MVP/demo only because durable state is backed up (mind PRD §9 audit ledger durability).

### ENV-A-002: multi-node-kubernetes-cluster

- **Type:** architecture
- **Applicable:** partial
- **Technology implication:** The scale-out path (replicated frontend, per-type workers, DB primary+replica). Not required for the MVP/demo but the topology is designed so moving here is scaling, not redesign. AlloyDB (planned) provides the managed primary/replica path when real customer traffic arrives.
- **Risk:** N/A for current scope; only relevant once serving real end users.

### ENV-C-001: host-provisioned-and-accessible

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** GCP host reachable via SSH with the agent running on it. Verified by `scripts/gcp/` provisioning and `doctor`.
- **Risk:** No host parity, blueprint topology unattainable.

### ENV-C-002: provision-script-executed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `scripts/provision-cluster.sh` equivalent (the planned `scripts/gcp/` provision step) executed; cluster reachable via kubectl.
- **Risk:** Manual cluster state; non-reproducible.

### ENV-C-003: all-containers-running-healthy

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Frontend, worker, database pods healthy per `kubectl get pods`; backed by `/healthz`+`/readyz`.
- **Risk:** Silent partial topology.

### ENV-C-004: agent-cli-on-host

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `claude` CLI runs on the GCP host, not the laptop.
- **Risk:** Local-assumption leakage into code.

### ENV-C-005: frontend-serving-release-bundle

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Frontend serves the bundle at the external port; `RELEASE_TAG` in `/health`/`/healthz` matches deployed git SHA. Add release-tag reporting to the planned health endpoints.
- **Risk:** Untracked version serving; release-gate verification impossible.

### ENV-C-006: worker-claiming-tasks

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Worker claims from the PostgreSQL claim-execute-submit queue (Plan) and submits via API. Directly verifies the guarantee-expiry/clawback/recalculation daemons.
- **Risk:** Post-placement risk jobs (Phase 6) silently stall.

### ENV-C-007: database-internal-only

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Postgres accepts connections from frontend/worker (via apps/server) only; not externally exposed.
- **Risk:** Exposed commission/audit data — confidentiality breach (PRD §9).

### ENV-C-008: tmux-session-active

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** tmux session on host; SSH disconnect/reattach tested.
- **Risk:** Lost long-running build/migration work.

### ENV-C-009: agent-read-context-before-coding

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Agent reads `agent-context/` before coding. The repo uses `.agents/`/blueprint context; the equivalent context-read discipline applies before commission-engine work.
- **Risk:** Code written against stale assumptions.

### ENV-C-010: release-pipeline-configured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Push to main triggers GitHub Actions, builds the release image, patches the deployment with immutable digest, rollout completes within timeout. Matches the Plan's CI pipeline issue.
- **Risk:** No automated, gated path to production for commission logic.

### ENV-C-011: rollback-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Deploy a bad image, confirm CI runs `kubectl rollout undo`. Tied to the four-phase health-gated rollout.
- **Risk:** A bad deploy could leave the commission platform down with no recovery.

### ENV-C-012: database-backup-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Database volume backup scheduled and restore tested (AlloyDB backup / Postgres volume backup). Critical given the immutable audit ledger.
- **Risk:** Permanent loss of the system-of-record commission and audit data.

### ENV-C-013: firewall-rules-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Only the frontend port and host SSH port reachable externally on the GCP host.
- **Risk:** Exposed database or internal APIs holding financial PII.

### ENV-C-014: frontend-no-build-tooling

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Frontend image verified free of git/npm/bun install/tsc (multi-stage distroless build).
- **Risk:** Shadow build environment serving untested code.

### ENV-C-015: database-no-shell-access

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `kubectl exec` into the distroless Postgres container fails as expected.
- **Risk:** Unaudited direct data mutation (violates PRD §9).

### ENV-C-016: ephemeral-test-db-lifecycle

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Integration/test suites spin up an ephemeral Postgres container via `docker run`, run, and tear down; `docker ps` shows no residue. Applies to test-api and test-migration GitHub Actions jobs.
- **Risk:** Leaked containers break CI; the release gate fails.

### ENV-C-017: network-policy-isolates-cluster-db

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** k8s NetworkPolicy prevents the host from reaching the cluster database by hostname or IP.
- **Risk:** Tests or ad-hoc host access could touch real commission data.

### ENV-C-018: test-connection-string-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test connection string points at the ephemeral container port, never commission_app/analytics/audit cluster services.
- **Risk:** Destructive tests against production data.

### ENV-C-019: provisioning-idempotent

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Running `scripts/gcp/` provisioning twice yields a clean cluster without manual cleanup.
- **Risk:** Drifted, non-reproducible infrastructure.

### ENV-C-020: cluster-reprovisioned-from-scratch

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Cluster reprovisioned from scratch reaches ready state without manual steps.
- **Risk:** Recovery depends on undocumented manual actions.

### ENV-C-021: multi-node-frontend-replicated

- **Type:** checklist
- **Applicable:** no
- **Technology implication:** Frontend replicated across ≥2 nodes — only when scaling to ENV-A-002, beyond MVP/demo scope.

### ENV-C-022: database-replica-failover-tested

- **Type:** checklist
- **Applicable:** no
- **Technology implication:** DB replica + failover (AlloyDB read replica) — multi-node scale-out only, beyond current scope.

### ENV-C-023: cluster-monitoring-active

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Container restarts, disk/memory pressure alerting. The Plan's structured JSON logging and trace IDs are a foundation; full alerting is desirable but not an explicit MVP Plan item.
- **Risk:** Silent worker crashes stall guarantee/clawback processing unnoticed.

### ENV-C-024: automatic-rollback-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `progressDeadlineSeconds` exceeded triggers CI failure and `kubectl rollout undo` without human intervention. Part of the health-gated rollout.
- **Risk:** A stuck bad deploy disrupts active commission cycles.

### ENV-C-025: recovery-drill-completed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Destroy cluster, reprovision, restore the database volume, measure end-to-end time vs SLA. Validates durability of the commission/audit ledger.
- **Risk:** Unproven recovery for the system of record.

### ENV-X-001: agent-running-locally

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids running the agent on the laptop — the agent runs on the GCP host. Avoid.
- **Risk:** Local assumptions encoded into the commission codebase.

### ENV-X-002: ide-against-local-files

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids local-file IDE mode; use Remote SSH attachment to the host. Avoid.
- **Risk:** Line-ending/symlink/import-resolution drift.

### ENV-X-003: frontend-with-build-tools

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids build tools in the frontend image; multi-stage distroless keeps them out. Avoid.
- **Risk:** Untested commission UI/logic served with no CI gate.

### ENV-X-004: agent-direct-database-access

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids agent shell/admin/root access to the database; all interaction through the application data layer. Directly enforces PRD §9 audit integrity. Avoid.
- **Risk:** Schema/data changes with no audit trail or review — destroys the governed, auditable record the product sells.

### ENV-X-005: environment-specific-config-branches

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids config/code paths that behave differently in dev vs prod. The Plan's `DEMO_MODE` flag and three-environment manifests are a real risk surface: keep `DEMO_MODE` limited to seeding/persona convenience and identical runtime behavior, and limit per-environment manifests to credentials/scale, not logic.
- **Risk:** A commission run validated under one mode behaves differently under another — unacceptable for finance-grade output.

### ENV-X-006: manual-cluster-provisioning

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids console/ad-hoc/runbook provisioning; provisioning is code (`scripts/gcp/`). Avoid.
- **Risk:** Undocumented, non-reproducible state.

### ENV-X-007: serving-from-main-branch

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids configuring the frontend to serve latest main; serve tagged/digest releases only. Avoid.
- **Risk:** Release-gate elimination; unvetted commission logic live.

### ENV-X-008: skipping-pipeline-for-demo

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** The customer-facing demos central to this product (PRD success metrics around first approved run) must go through the full CI pipeline. The k3d local-demo path must still use released artifacts. Avoid shortcuts.
- **Risk:** Code failing live during a customer demo — directly harms adoption.

### ENV-X-009: tests-against-cluster-database

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids pointing tests at commission_app/analytics/audit cluster databases; ephemeral containers only. Avoid.
- **Risk:** Destructive/confidentiality-breaking test runs against real data.

### ENV-X-010: ephemeral-containers-not-torn-down

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids teardown-only-on-success; teardown in a `finally` block unconditionally. Avoid.
- **Risk:** Zombie containers exhaust host resources and break CI.

### ENV-X-011: local-port-forwarding-as-frontend

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids SSH tunnel/ngrok as a frontend substitute. The Plan's `cloudflared tunnel` in `scripts/local-demo.ts` must expose the actual frontend container (released artifact in k3d), not a raw local dev server, to stay compliant.
- **Risk:** A "preview" with no release gate or parity misrepresents the production commission platform.

## Recommended Technology Choices

- **Container orchestrator: k3s in production (GCP VM), k3d locally** — single-node topology identical to production (ENV-A-001, ENV-D-002, ENV-P-006).
- **Distroless container images, multi-stage Dockerfile** — frontend serves only the built bundle; database is distroless Postgres with no shell/package manager (ENV-T-003, ENV-P-003, ENV-D-002, ENV-C-014, ENV-C-015, ENV-X-003).
- **Three role-specialized containers (frontend / worker / database) mediated by apps/server API** — worker writes via API only with scoped delegated credentials (ENV-D-002, ENV-P-002, ENV-P-004, ENV-T-002, ENV-X-004).
- **GitHub Actions per-suite CI with immutable image digests and branch protection** — host/CI builds and tags; frontend fetches by digest (ENV-D-001, ENV-T-001, ENV-T-007, ENV-C-010).
- **k8s orchestrator-driven rolling release with readiness probes + automatic rollback** — realized by the four-phase health-gated rollout and `/healthz`+`/readyz` endpoints; surface `RELEASE_TAG` in the health response (ENV-D-006, ENV-C-005, ENV-C-011, ENV-C-024).
- **Docker-on-host ephemeral Postgres 16 test containers** — randomized port, migrations from scratch, unconditional `finally` teardown, for the test-api and test-migration suites (ENV-P-005, ENV-D-003, ENV-T-009, ENV-T-010, ENV-C-016/017/018, ENV-X-009/010).
- **Agent-coded GCP provisioning (`scripts/gcp/` provision VPC/AlloyDB/VM, deploy, doctor; `deploy.sh`; `scripts/local-demo.ts`)** — versioned, idempotent, re-runnable (ENV-P-006, ENV-D-004, ENV-C-002/019/020, ENV-X-006).
- **k8s NetworkPolicy isolating the cluster databases + host firewall (frontend port + SSH only)** — protects financial/PII data and enforces test isolation (ENV-C-007, ENV-C-013, ENV-C-017).
- **AlloyDB / Postgres volume backups with tested restore and a recovery drill** — durability for the immutable commission/audit ledger (ENV-T-006, ENV-C-012, ENV-C-025).
- **Remote-SSH IDE attachment (VS Code/Cursor Remote SSH or JetBrains Gateway) + agent CLIs and tmux on the GCP host** — no local development (ENV-T-005, ENV-T-008, ENV-D-005, ENV-C-004/008, ENV-X-001/002).
- **Single-mode runtime: constrain `DEMO_MODE` and three-environment manifests to credentials/scale/seeding only** — never behavioral branches, and route the `cloudflared` tunnel to the released frontend container (ENV-P-001, ENV-T-004, ENV-X-005, ENV-X-008, ENV-X-011).
- **AlloyDB primary+replica as the documented multi-node scale-out path** — deferred beyond MVP (ENV-A-002, ENV-C-021/022).

# Blueprint: IMPL-DEPLOY — Architecture Research

**Source:** blueprint/rules/implementations/ts/deploy-ts.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint pins the entire deployment, packaging, logging, and observability stack for the commission platform. The most load-bearing rules are the container-packaging set (IMPL-DEPLOY-001 through 004), the Kubernetes/k3s orchestration and declarative-deploy rules (IMPL-DEPLOY-020, 021), the Kubernetes-Secrets-with-KMS rule (IMPL-DEPLOY-005), and the full trace-ID propagation chain (IMPL-DEPLOY-014 through 017). These directly constrain the Phase 1 Foundation deliverables already named in the Plan — multi-stage distroless Dockerfile, k3s, trace-ID middleware, structured JSON logging, field-level encryption with GCP Cloud KMS, and deployment manifests. Because this is an audit-and-compliance product where every commission figure must be traceable to a triggering event and no payout may reach payroll unreviewed, the trace-ID and dual-log observability rules are not merely operational hygiene: they are the substrate for the explainability and audit guarantees the PRD makes legally binding. The blueprint also forbids hot-reload dev servers and host process managers, forcing environment parity through the containerized build for all environments. Note one tension: the Plan's Foundation deliverable mentions a "hot-reload watch loop" in local-demo.ts, which sits in friction with IMPL-DEPLOY-024.

## Rule Analysis

### IMPL-DEPLOY-001: multistage-distroless-container

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Use a multi-stage Dockerfile with `oven/bun:1` as builder and `oven/bun:1-distroless` as the production image; copy only compiled output forward. The Plan's Phase 1 explicitly lists "multi-stage distroless Dockerfile" and "distroless containers" as the stack, so this is the mandated packaging for apps/server (and the worker).
- **Risk:** A fat image with shell and package manager widens the attack surface on a system holding encrypted financial PII and payroll data; a compromised container would offer an attacker tooling for lateral movement.

### IMPL-DEPLOY-002: frozen-lockfile-install

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Builder stage must run `bun install --frozen-lockfile` against the committed `bun.lock`. Reinforces the Bun workspace monorepo named in Phase 1.
- **Risk:** Non-deterministic dependency resolution could pull a different transitive version between build and audit, undermining the reproducibility needed to defend an auditable commission ledger.

### IMPL-DEPLOY-003: explicit-bun-build

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Compile the server with `bun build apps/server/index.ts --target bun --outfile dist/server.js` and copy the single-file artifact into the distroless image. Matches the apps/server entrypoint convention in the Plan's monorepo scaffold.
- **Risk:** Building inconsistently (e.g. running uncompiled source) breaks the immutable-artifact guarantee and reproducibility of deployed code.

### IMPL-DEPLOY-004: no-process-managers

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** No systemd, PM2, or restart scripts. The k3s orchestrator (Phase 1 stack) owns process lifecycle for server and worker workloads. The task-queue worker's dead-worker lease recovery handles application-level liveness, while k3s handles process restart.
- **Risk:** Competing restart mechanisms cause split-brain process control and undermine the orchestrator's declarative guarantees, risking duplicate workers double-processing guarantee-expiry or clawback jobs.

### IMPL-DEPLOY-005: production-env-gitignored

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** No `.env` files in production. Store secrets as scoped Kubernetes Secrets encrypted at rest by KMS; each workload (db, api, worker) mounts only its own Secret. Aligns directly with the Plan's three DB roles (app_rw, analytics_w, audit_w) and GCP Cloud KMS field encryption — each role's credentials become a separately scoped Secret, and the network-isolated worker mounts only its delegated scoped credentials.
- **Risk:** A leaked or over-broad `.env` would expose database and KMS credentials guarding encrypted financial fields, directly breaching the PRD's audit/confidentiality constraints.

### IMPL-DEPLOY-006: test-env-committed

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** CI test credentials are inline environment variables inside the GitHub Actions workflow definitions (Phase 1 lists per-suite workflows: quality-gate, test-unit, test-api, test-migration, container build). No `.env.test` file.
- **Risk:** A separate test env file drifts from CI configuration and can accidentally carry real secrets into the repo.

### IMPL-DEPLOY-007: stdout-log-to-orchestrator

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Emit chronological structured JSON logs to stdout for k3s to capture and aggregate at cluster level. Matches the Plan's "structured JSON logging" Foundation deliverable.
- **Risk:** Writing logs to files inside the container loses them on restart and breaks cluster-level aggregation needed to reconstruct deal/commission history for audit.

### IMPL-DEPLOY-008: unique-error-log

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Deduplicated error categories written to `/var/log/calypso/uniques.log` with count and last-seen timestamp, persisted via volume mount or dedicated service. The Plan does not yet name a uniques log, but the dual-log architecture would surface recurring calculation/import failures (e.g. reconciliation-queue parse errors) without flooding operators.
- **Risk:** Without deduplicated error tracking, recurring failures in the commission engine or AR import drown in chronological noise and go unnoticed until a producer disputes a payout.

### IMPL-DEPLOY-009: log-rotation-via-cluster

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Rotation handled by a cluster log-aggregation facility (Fluentd or Promtail), not application code. Adds a log-shipping sidecar/daemonset to the k3s deployment design.
- **Risk:** Application-level rotation conflicts with the orchestrator's stdout capture and risks unbounded disk growth on the single-node cluster.

### IMPL-DEPLOY-010: window-onerror-capture

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** apps/web installs a `window.onerror` handler to capture synchronous browser errors. Applies to the producer portal, finance review queue, and executive dashboard React surfaces.
- **Risk:** Uncaptured front-end errors in the payout portal or review queue go invisible to operators, so producers hit broken explainability views with no server-side signal.

### IMPL-DEPLOY-011: unhandled-rejection-capture

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Install a `window.onunhandledrejection` handler in apps/web to forward promise rejections (e.g. failed fetches of payout or dashboard data).
- **Risk:** Silent async failures in data-heavy dashboards leave stale or blank financial figures with no diagnostic trail.

### IMPL-DEPLOY-012: react-error-boundary

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** React error boundaries wrap the component tree and forward crashes to the server log endpoint. The Plan's stack is React (packages/ui, apps/web), so boundaries are a direct fit for the portal and dashboard.
- **Risk:** A component crash in a commission-explanation or executive-margin view blanks the screen with no recovery and no captured cause.

### IMPL-DEPLOY-013: error-post-to-api-logs

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** All captured browser errors POST to `/api/logs` with `{ traceId, error, stack, url, timestamp }`. apps/server exposes this endpoint alongside the /healthz and /readyz endpoints named in Phase 1.
- **Risk:** Without a server sink, browser errors never reach cluster log aggregation and front-end failures cannot be correlated with the server request that triggered them.

### IMPL-DEPLOY-014: trace-id-uuid-v4-in-browser

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Generate a UUID v4 trace ID in the browser at the start of each user action. Combined with IMPL-DEPLOY-022, this UUID is generated by an internal function, no library.
- **Risk:** Without a per-action trace ID, a producer's dispute about a specific payout calculation cannot be tied to the exact request and log lines that produced it — eroding the PRD's explainability guarantee.

### IMPL-DEPLOY-015: trace-id-request-header

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Browser sends the trace ID as `X-Trace-Id` request header on every API call.
- **Risk:** Missing propagation breaks end-to-end correlation between a finance action (e.g. approving a commission run) and its server-side audit trail.

### IMPL-DEPLOY-016: trace-id-server-middleware

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Server middleware extracts `X-Trace-Id` and attaches it to every log entry in the request lifecycle. Directly matches the "trace ID middleware" Foundation deliverable and is the join key that makes trace-ID search work across the structured logs.
- **Risk:** Without middleware binding, the audit and explainability constraints (every payout traceable to its triggering event) cannot be satisfied from logs — a compliance failure for an audit-centric product.

### IMPL-DEPLOY-017: trace-id-response-header

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Server echoes the trace ID as `X-Trace-Id` response header so the browser can surface or log it.
- **Risk:** Support and dispute resolution lose the ability to quote a trace ID back from a user-reported failure, slowing investigation of contested calculations.

### IMPL-DEPLOY-018: browser-build-command

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Build browser assets with `bun build apps/web/index.tsx --outdir dist/web`. Confirms apps/web is the React entrypoint and Bun is the bundler, consistent with the Plan's monorepo layout.
- **Risk:** A divergent bundler toolchain breaks the single-toolchain reproducibility the blueprint assumes.

### IMPL-DEPLOY-019: server-docker-build

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Build the server image with `docker build -f apps/server/Dockerfile -t calypso-server:latest`, producing the immutable artifact. The project will substitute its own image name (commission server) but the pattern — Dockerfile under apps/server, tagged immutable image — holds.
- **Risk:** Ad-hoc or unbuilt deploys break the immutable-artifact and rollback guarantees.

### IMPL-DEPLOY-020: kubectl-apply-deploy

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Deploy declaratively via `kubectl apply -f k8s/deployments/server.yaml` (or `helm upgrade`); idempotent, non-interactive, zero manual SSH. Matches the Plan's "k8s/ manifests for three environments," deploy.sh, and the GCP four-phase health-gated rollout deliverable.
- **Risk:** Imperative or manual SSH-based deploys defeat repeatability and auditability of what code is running against financial data.

### IMPL-DEPLOY-021: k3s-self-hosted

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Adopt k3s as the CNCF-certified, single-binary Kubernetes distribution with built-in containerd, CNI, and KMS support, self-hosted on single-node clusters. Named verbatim in the Plan's Phase 1 stack; the local-demo path uses k3d (k3s-in-Docker), and the production path runs on a GCP VM.
- **Risk:** Choosing a heavier orchestrator or none at all contradicts the committed stack and the single-node, KMS-integrated deployment model the field-encryption design depends on.

### IMPL-DEPLOY-022: uuid-generation-diy

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Implement UUID v4 generation as a single internal function (in packages/core), no external dependency. Supplies the trace IDs of IMPL-DEPLOY-014.
- **Risk:** Pulling a UUID library for a trivial function adds needless supply-chain surface to a security-sensitive product; low risk but counter to the minimal-dependency stance.

### IMPL-DEPLOY-023: error-forwarding-diy

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Implement the browser error-forwarding client as a thin `fetch` wrapper (packages/core or apps/web), no external library. Feeds the `/api/logs` POST of IMPL-DEPLOY-013.
- **Risk:** Adopting a heavyweight client-telemetry SDK adds dependency and data-egress surface in a confidentiality-constrained product for what is a few lines of fetch code.

### IMPL-DEPLOY-024: no-hot-reload-dev-servers

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Do not use `vite dev` or similar hot-reloading dev servers; deploy the containerized build in all environments for parity. This is in tension with the Plan's Phase 1 "scripts/local-demo.ts (k3d + cloudflared tunnel + hot-reload watch loop)" — the local-demo loop should rebuild and redeploy the container image rather than run a long-lived hot-reload dev server, or the deliverable should be reconciled against this rule.
- **Risk:** A hot-reload dev path that diverges from the containerized build can mask environment-specific bugs (KMS access, distroless runtime, k3s networking) until production, where they affect real commission data.

## Recommended Technology Choices

- Multi-stage Dockerfile: `oven/bun:1` builder + `oven/bun:1-distroless` production image, single-file `bun build` output only (IMPL-DEPLOY-001, 003).
- Deterministic builds via `bun install --frozen-lockfile` against committed lockfile (IMPL-DEPLOY-002).
- k3s self-hosted single-node Kubernetes (k3d locally, GCP VM in production) as the sole process orchestrator; no systemd/PM2 (IMPL-DEPLOY-021, 004).
- Declarative deploys via `kubectl apply` / `helm upgrade` against versioned k8s/ manifests; immutable, named server image; zero manual SSH (IMPL-DEPLOY-019, 020).
- Secrets as per-workload scoped Kubernetes Secrets encrypted at rest by KMS (GCP Cloud KMS), one Secret per workload/DB role; no `.env` files (IMPL-DEPLOY-005).
- CI test credentials inline in GitHub Actions workflows; no `.env.test` (IMPL-DEPLOY-006).
- Structured JSON logging to stdout, captured and aggregated by k3s; cluster-level rotation via Fluentd or Promtail; deduplicated uniques error log persisted via volume/service (IMPL-DEPLOY-007, 008, 009).
- Trace-ID observability chain: internal UUID v4 generator (no library) in the browser, `X-Trace-Id` request and response headers, server middleware binding the ID to every log entry — the substrate for PRD explainability/audit (IMPL-DEPLOY-014, 015, 016, 017, 022).
- Browser error capture via `window.onerror`, `window.onunhandledrejection`, and React error boundaries, all POSTed to `/api/logs` through a DIY fetch wrapper (IMPL-DEPLOY-010, 011, 012, 013, 023).
- Bun as the browser bundler: `bun build apps/web/index.tsx --outdir dist/web` (IMPL-DEPLOY-018).
- Containerized-build parity across all environments; reconcile the local-demo "hot-reload watch loop" to rebuild/redeploy the image rather than run a hot-reload dev server (IMPL-DEPLOY-024).

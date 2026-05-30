# Blueprint: DEPLOY — Architecture Research

**Source:** blueprint/rules/blueprints/deploy.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

For this commission-management platform, the most load-bearing DEPLOY rules are those governing immutable distroless containers (DEPLOY-P-001, DEPLOY-D-001), the three-environment k3s orchestration model with KMS-backed secrets (DEPLOY-P-011/012/013, DEPLOY-A-002), forward-only health-gated rollouts with eager rollback (DEPLOY-P-007/008/010/016, DEPLOY-P-015), disaster-recovery snapshots before migrations (DEPLOY-P-017), and the deployment audit record (DEPLOY-D-006). These are decisive because the product is an auditable financial ledger: §9 mandates that placement, calculation, split, and approval history is *never silently overwritten*, money never reaches payroll without an explicit human approval, and the Plan's three-database design (commission_app / commission_analytics / commission_audit) plus field-level encryption (GCP Cloud KMS) directly intersect with the blueprint's KMS-secrets, schema-forward-compatibility, DR-snapshot, and human-triggered-production requirements. The Plan already names TypeScript+Bun, PostgreSQL 16, distroless containers, k3s, and a four-phase health-gated rollout — so the blueprint primarily constrains *how* those pieces must be wired (signed images, environment-scoped namespaces, deduplicated logs, full-stack trace IDs, browser error forwarding) rather than introducing new vendors. Observability rules (DEPLOY-P-003/004, DEPLOY-D-002/003/004) are heightened in importance because every commission figure must carry an explainable, trace-linked derivation.

## Rule Analysis

### DEPLOY-T-001: container-crash-no-restart

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Run all workloads (server, worker, web) under k3s with `restartPolicy: Always`; locally use Docker/Podman with restart policy rather than `bun run` in a terminal.
- **Risk:** A crashed commission-calculation server or guarantee/clawback worker silently stops processing; finance close stalls and producers see stale payouts with no alert.

### DEPLOY-T-002: disk-exhaustion-from-unrotated-logs

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Log to stdout/stderr captured by the container engine with cluster log rotation and 14-day retention (DEPLOY-C-011); do not write unbounded log files inside the container.
- **Risk:** Audit-heavy workloads (every ledger change is logged) fill disk; the host or DB node degrades, threatening the authoritative audit record.

### DEPLOY-T-003: invisible-browser-errors

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The apps/web React frontend (producer portal, finance review queue, executive dashboard) must POST unhandled errors to a server endpoint.
- **Risk:** A producer cannot load their payout derivation or a finance admin's approval action fails client-side; the server log looks healthy while users are blocked, undermining trust in the "source of truth."

### DEPLOY-T-004: context-window-filled-by-duplicate-errors

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Implement a deduplicated `uniques.log` alongside the chronological log (DEPLOY-C-010).
- **Risk:** A repeating calculation-engine error floods logs; agent diagnosis during a commission cycle becomes slow and expensive.

### DEPLOY-T-005: manual-deploy-steps-block-agent

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** All deploys via `deploy.sh` / `scripts/gcp/` and the k3s control API — the Plan's Foundation phase already specifies these scripts.
- **Risk:** A release requiring manual steps cannot be executed autonomously, slowing fixes to the financial pipeline.

### DEPLOY-T-006: secrets-committed-to-repo

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** No `.env` files anywhere; DB connection strings, KMS material, session secrets, and registry credentials live only as k8s Secrets. CI test creds are inline in workflow YAML.
- **Risk:** Leaking a commission_app DB credential or the field-encryption KMS key exposes encrypted financial PII and payout data — a direct breach of §9 confidentiality.

### DEPLOY-T-007: deploy-with-failing-tests

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** GitHub Actions branch protection gates deploy on quality-gate, test-unit, test-api, test-migration, and container build (Plan Foundation CI pipeline).
- **Risk:** A miscalculation or migration defect reaches an environment, corrupting payout amounts that downstream payroll relies on.

### DEPLOY-T-008: unreachable-server-no-diagnosis

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** k3s with TLS-terminating ingress plus `/healthz` and `/readyz` endpoints (Plan Foundation); deep-health endpoint checks the three PostgreSQL databases and the task queue.
- **Risk:** Producers and finance lose access during a close cycle with no way to localize the fault.

### DEPLOY-T-009: previous-version-unavailable-for-rollback

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Retain previous image digests per environment in the registry; releases are tagged commits on main.
- **Risk:** A bad commission-engine release cannot be reverted, leaving incorrect payouts live.

### DEPLOY-T-010: migration-applied-rollback-destroys-data

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Treat the packages/db migration runner as forward-only; verify prior code is schema-forward-compatible before promotion; never auto-run destructive down-migrations.
- **Risk:** An image rollback against the immutable audit/ledger schema either breaks the app or, via a down-migration, destroys append-only ledger history — catastrophic for an audit system.

### DEPLOY-P-001: containers-are-the-great-unifier

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** All processes (apps/server, apps/web, apps/worker) packaged as immutable distroless images; k3s as orchestrator with automatic restart, health-gated rollout, isolated rollback, declarative config. Matches Plan's stated stack.
- **Risk:** Environment drift between dev and the GCP production cluster yields "works-on-my-machine" defects in financial calculations that are undiagnosable in production.

### DEPLOY-P-002: no-incremental-hot-reloading-dev-servers

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** Build and run the container for previews rather than `vite dev`. Note: the Plan's `scripts/local-demo.ts` mentions a "hot-reload watch loop" — this must be reconciled to rebuild/redeploy the container on change rather than run an in-process hot-reload dev server, or it violates this principle.
- **Risk:** Frontend/portal behavior diverges between local hot-reload and the containerized production build.

### DEPLOY-P-003: logs-are-for-machines-first

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Structured JSON logging with timestamp and trace ID (Plan Foundation), plus a deduplicated summary file.
- **Risk:** Reconstructing why a specific producer's payout was held/clawed back becomes manual log archaeology instead of a trace-ID filter.

### DEPLOY-P-004: traces-span-the-full-stack

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Trace ID middleware in apps/server and the browser HTTP client (Plan Foundation), propagated to PostgreSQL query tags across all three DBs.
- **Risk:** A commission run touching app, analytics, and audit DBs cannot be reconstructed as one workflow, weakening explainability mandated by §9.

### DEPLOY-P-005: deployment-is-a-build-not-a-ceremony

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Idempotent, non-interactive `deploy.sh` and scripts/gcp; build → stop old → start new → verify health.
- **Risk:** Inconsistent releases of the financial pipeline; non-reproducible deploys.

### DEPLOY-P-006: releases-from-tagged-main-commits-only

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Release tags = semver + six-digit PR hash on green main commits; feeds the stage/RC promotion path.
- **Risk:** Untested code ships to stage/prod, risking incorrect payouts.

### DEPLOY-P-007: schema-upgrades-forward-compatible

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** A schema-upgrade compatibility check with plausible fixtures gates releases; the packages/db migration runner and three-DB schema must support N-1/N compatibility during rollout.
- **Risk:** During a rolling update, old and new server pods hit the same evolved commission/audit schema; an incompatible change corrupts or rejects ledger writes.

### DEPLOY-P-008: rollouts-are-ordered-and-health-gated

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Strict order — DB migrations → frontend → worker → static web — each health-proven before the next; failed phase triggers eager rollback. Plan's "four-phase health-gated rollout" maps directly here.
- **Risk:** An unhealthy worker (guarantee/clawback jobs) goes live while the system sits degraded, posting wrong ledger adjustments.

### DEPLOY-P-010: migrations-are-forward-only

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** No automated down-migrations; correct forward with a new migration. Especially binding for the append-only commission_audit DB.
- **Risk:** Reverting a migration destroys immutable audit/ledger rows that §9 forbids overwriting.

### DEPLOY-P-011: three-environment-promotion-model

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** demo / stage / production with identical container topology; only secrets, config, and trigger differ. Plan Foundation already specifies k8s manifests for three environments.
- **Risk:** Divergent environments make stage validation meaningless before a production financial release.

### DEPLOY-P-012: production-deployments-are-human-triggered

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** CI may auto-roll demo/stage only; production requires a human-authenticated patch to the k3s control API. CI service account scoped to demo+stage namespaces.
- **Risk:** Aligns with §9 "no commission amount reaches payroll without explicit approval" — an automated prod deploy could push an unreviewed calculation change into the live payout system.

### DEPLOY-P-013: orchestration-service-has-kms

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** k3s EncryptionConfiguration seeded from a per-environment offline mnemonic during the one SSH bootstrap step; registry org credential and image-verification key provisioned then. Note this is the *cluster* KMS for k8s Secrets; the Plan's GCP Cloud KMS for field-level encryption is a distinct, complementary layer.
- **Risk:** Unencrypted k8s Secrets at rest expose DB credentials and the field-encryption keys protecting financial PII.

### DEPLOY-P-014: rollbacks-are-environment-isolated

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Environment-scoped namespaces; per-environment image-digest retention so each environment's rollback target survives registry pruning.
- **Risk:** A stage rollback during testing inadvertently disturbs production payout processing.

### DEPLOY-P-015: health-check-taxonomy

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Implement four checks per workload: liveness (event loop), readiness (`/readyz`, no deps), deep health (three PostgreSQL DBs + task queue + GCP KMS reachability), and smoke (HTTP→handler→DB→response, e.g. load a placement / run a trivial calc).
- **Risk:** A single combined check restarts the server when only the DB is down, or routes traffic to a deadlocked pod — either way commission processing is disrupted.

### DEPLOY-P-016: eager-rollback-is-default

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** k3s rollout automatically restores the prior revision on any health-check failure before alerting; blocked state only after restoration.
- **Risk:** Producers/finance experience prolonged outage of the payout system while awaiting a human decision.

### DEPLOY-P-017: disaster-recovery-snapshot-at-release

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Take a labeled (release tag + environment) snapshot of each PostgreSQL database before any migration, independent of AlloyDB/managed continuous backup; verify accessibility before proceeding.
- **Risk:** A migration corrupts the commission_audit or commission_app ledger with no quick discrete restore point — irrecoverable financial history loss.

### DEPLOY-P-018: image-signing-and-verification

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Sign every image at build (signing key in CI secrets); k3s admission policy rejects unsigned/tampered images; verification key provisioned at init.
- **Risk:** A compromised registry serves a malicious image into the financial pipeline, exfiltrating payout/PII data.

### DEPLOY-P-009: secrets-are-runtime-configuration

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** k8s Secrets injected as env vars at pod start, scoped per workload — DB containers get encryption/connection material, API containers get API keys/connection strings, no cross-mounting. No `.env` in any environment; CI test creds inline.
- **Risk:** Over-broad secret mounts let the worker or web pod read the audit-DB credential, breaking least-privilege around financial data.

### DEPLOY-D-001: immutable-distroless-container-builds

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Multi-stage Bun build copying compiled output into a distroless base with no shell/package manager (Plan Foundation "multi-stage distroless Dockerfile").
- **Risk:** A shell-bearing image enlarges attack surface around a system holding compensation PII; drift reintroduces environment bugs.

### DEPLOY-D-002: dual-log-architecture

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Chronological JSON log plus a deduplicated `uniques.log` keyed by hashed error signature with count + last timestamp.
- **Risk:** Diagnosing recurring calculation/import errors during a close cycle is slow and token-expensive.

### DEPLOY-D-003: browser-to-server-error-forwarding

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** apps/web posts unhandled errors (message, stack, user context, trace ID) to a rate-limited, payload-capped server endpoint.
- **Risk:** Client-side failures in the producer portal / finance review queue stay invisible, eroding the trust the product is built to create.

### DEPLOY-D-004: trace-id-propagation

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Generate trace ID at action start; propagate browser → request header → server handler → PostgreSQL query tag → response header. Implemented once in server framework and HTTP client.
- **Risk:** Multi-DB commission workflows can't be reconstructed by trace ID, undermining §9 explainability/auditability.

### DEPLOY-D-006: deployment-audit-record

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Each deploy event appends JSON to `deployments.jsonl` (authoritative), dual-written to a `deployment_audit` table once the DB exists — naturally landing in the commission_audit DB given this project's audit emphasis.
- **Risk:** Enterprise/finance compliance can't answer who deployed which version when — gaps in the chain of custody for a financial system.

### DEPLOY-D-005: automated-ci-rollouts-to-non-production

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** CI auto-rolls demo on dev-branch push and stage on RC tag; CI credential scoped to demo+stage namespaces only and explicitly excludes production.
- **Risk:** A misconfigured trigger pushes unreviewed code to the live payout environment.

### DEPLOY-A-001: single-app-container-on-host

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** Local dev/preview runs the immutable app container (serving API + built static assets) via Docker/Podman with stdout/stderr logging — consistent with `scripts/local-demo.ts` (k3d).
- **Risk:** Local-only iteration shortcuts reintroduce environment parity gaps.

### DEPLOY-A-002: multi-environment-container-orchestration

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** k3s managing demo/stage/production namespaces with TLS ingress, replication, auto-restart, health-gated updates, per-env rollback, and cluster KMS. Plan names k3s + scripts/gcp provisioning (VPC/AlloyDB/VM).
- **Risk:** Without isolated namespaces a fault or rollback in one environment bleeds into the production financial system.

### DEPLOY-A-003: ci-driven-container-deploy-pipeline

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** CI builds the Bun bundle, layers onto base image, pushes with immutable digest, patches workload spec via k3s control API (narrow-scoped kubeconfig), polls health, auto-restores on failure; production is human-patched only.
- **Risk:** Mutable-tag deploys or broad CI credentials let unverified images reach production payout processing.

### DEPLOY-C-001: dockerfile-created

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Dockerfile/manifest exists and the app starts via container runtime (Plan Foundation).
- **Risk:** No reproducible artifact for the financial app.

### DEPLOY-C-002: orchestrator-auto-restart

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** k3s (or local Docker) auto-restarts crashed containers.
- **Risk:** Silent downtime of commission processing.

### DEPLOY-C-003: secrets-injected-securely

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Scoped k8s Secrets, not baked into image, no `.env`; each workload mounts only its own Secret.
- **Risk:** Credential sprawl exposing financial-data access.

### DEPLOY-C-004: test-env-committed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** No `.env`; KMS-encrypted k8s Secrets; CI test creds inline in workflow YAML.
- **Risk:** Committed secrets / drifted test env.

### DEPLOY-C-005: stdout-stderr-captured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Container engine captures stdout/stderr; logs reachable via standard tooling/`kubectl`.
- **Risk:** Logs inaccessible to agents diagnosing payout issues.

### DEPLOY-C-006: structured-log-entries

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Structured JSON log lines (Plan Foundation).
- **Risk:** Unparseable logs defeat machine-first diagnosis.

### DEPLOY-C-007: trace-id-propagated

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Trace ID flows browser → server → response header.
- **Risk:** Broken trace chain undermines explainability.

### DEPLOY-C-008: browser-error-forwarding-implemented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Unhandled browser errors appear in server logs.
- **Risk:** Invisible portal/dashboard failures.

### DEPLOY-C-009: health-endpoint-returns-200

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `/healthz` returns 200 when running (Plan Foundation).
- **Risk:** Orchestrator can't gate rollouts or detect outages.

### DEPLOY-C-010: uniques-log-implemented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `uniques.log` with deduplicated error categories and counts.
- **Risk:** Context-window flooding during diagnosis.

### DEPLOY-C-011: log-rotation-configured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Log rotation with verified 14-day retention.
- **Risk:** Disk exhaustion on audit-heavy workloads.

### DEPLOY-C-012: deploy-script-idempotent

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `deploy.sh` idempotent (re-running has no side effects).
- **Risk:** Non-deterministic deploys of the financial pipeline.

### DEPLOY-C-013: ci-deploy-workflow-gated

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Deploy only after all test suites pass (Plan Foundation CI).
- **Risk:** Untested commission logic ships.

### DEPLOY-C-014: rollback-procedure-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Tested revert-restart-verify-health procedure (scripts/gcp doctor + rollout).
- **Risk:** Unproven rollback fails when a bad payout release is live.

### DEPLOY-C-015: ci-service-account-kubeconfig

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Scoped `KUBE_CONFIG` in GitHub Secrets via `scripts/setup-ci-deployer.sh`.
- **Risk:** Over-privileged or missing CI credential.

### DEPLOY-C-016: immutable-image-digest-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Deployments reference image digests, not mutable tags.
- **Risk:** Tag drift deploys unintended code to the payout system.

### DEPLOY-C-017: disk-usage-monitoring

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Disk-usage monitoring with threshold alerts (CLI/log-fetchable, not dashboard-only).
- **Risk:** Undetected disk growth crashes audit-logging workloads.

### DEPLOY-C-018: env-vars-documented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Document all env vars in docs/ (descriptions, not values).
- **Risk:** Undocumented config blocks reproducible/agent deploys.

### DEPLOY-C-019: zero-manual-ssh-steps-post-init

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** SSH only for one-time k3s init (KMS seed + registry cred); all else via control API.
- **Risk:** Hidden SSH steps block autonomous operation.

### DEPLOY-C-020: health-check-includes-dependencies

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Deep health verifies the three PostgreSQL DBs, task queue, and GCP KMS reachability.
- **Risk:** Pods serve traffic while a backing DB is down, producing wrong/blocked payouts.

### DEPLOY-C-021: trace-id-search-works

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** All log entries for a trace ID retrievable in one query.
- **Risk:** Cannot reconstruct a commission workflow on demand.

### DEPLOY-C-022: browser-error-rate-tracked

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Track browser error rate; alert on spikes.
- **Risk:** Portal regressions go unnoticed.

### DEPLOY-C-023: backup-strategy-exists

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** DB dumps and uploaded-file (plan docs, exception attachments per §7) backups; AlloyDB managed backups + explicit snapshots.
- **Risk:** Loss of authoritative financial/audit data.

### DEPLOY-C-024: disaster-recovery-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Provision a fresh host and deploy from scratch (scripts/gcp provision + deploy).
- **Risk:** Unrecoverable from a node loss carrying live commission data.

### DEPLOY-C-025: orchestration-kms-initialized

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** k3s KMS root key seeded at bootstrap; later secret ops via control API only.
- **Risk:** Unencrypted secrets at rest.

### DEPLOY-C-026: registry-auth-key-provisioned-at-init

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** GitHub org pull credential provisioned as a k8s Secret at init; workloads don't embed it.
- **Risk:** Embedded registry creds leak / image pulls fail.

### DEPLOY-C-027: prod-deployment-requires-human-action

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify no CI/automation can roll production; CI scoped to demo+stage.
- **Risk:** Automated prod deploy bypasses the human gate §9 requires for amounts reaching payroll.

### DEPLOY-C-028: rollback-verified-environment-isolated

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify stage rollback doesn't alter production and vice versa.
- **Risk:** Cross-environment contamination of the live payout system.

### DEPLOY-C-029: migration-rollback-strategy-documented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Per migration, document forward-compatibility or mark irreversible with a fix-forward path; central for the audit/ledger schema.
- **Risk:** Undocumented migration causes data loss or breakage on rollback.

### DEPLOY-C-030: liveness-check-configured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Per-workload liveness check (event-loop responsive, no dependency checks).
- **Risk:** Crashed/deadlocked processes go unrestarted.

### DEPLOY-C-031: readiness-check-configured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `/readyz` readiness check; failure removes from rotation without restart.
- **Risk:** Traffic hits not-yet-ready pods, failing payout requests.

### DEPLOY-C-032: deep-health-check-implemented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Deep-health endpoint over the three DBs, queue, and KMS; gates rollout health and triggers eager rollback.
- **Risk:** Dependency outages slip through rollout gating.

### DEPLOY-C-033: smoke-test-suite-exists

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Smoke suite exercising HTTP→handler→DB→response (e.g. load placement, run a sample calc) after each rollout phase.
- **Risk:** A broken commission flow ships despite healthy low-level checks.

### DEPLOY-C-034: dr-snapshot-taken-before-migration

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Labeled DB snapshot (release tag + env) before every migration in every environment; accessibility confirmed first.
- **Risk:** No discrete recovery point if a migration corrupts ledger/audit data.

### DEPLOY-C-035: deployment-audit-record-written

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Append each deploy event to `deployments.jsonl`; dual-write to `deployment_audit` (commission_audit DB) once present.
- **Risk:** No deployment chain-of-custody for compliance.

### DEPLOY-C-036: image-signing-configured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Sign images at build (CI secret key); k3s admission policy rejects unsigned/tampered images.
- **Risk:** Supply-chain substitution into the financial pipeline.

### DEPLOY-C-037: eager-rollback-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Deliberately fail a health check in non-prod and confirm automatic restoration before blocked state.
- **Risk:** Rollback automation untested; degraded state persists during real failure.

### DEPLOY-X-001: hybrid-environments

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids `vite dev` locally + containers in prod; reconcile `local-demo.ts` hot-reload to rebuild the container.
- **Risk:** Works-on-my-machine defects in commission UI/logic.

### DEPLOY-X-002: process-babysitting

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids `bun run` in tmux; use the orchestrator.
- **Risk:** Unnoticed downtime of payout processing.

### DEPLOY-X-003: log-and-pray

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids unrotated file logging; use stdout + cluster aggregation + rotation.
- **Risk:** Disk fill crashes audit-logging workloads.

### DEPLOY-X-004: dashboard-only-observability

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Observability must be CLI/log-fetchable over the namespace, not a human-watched dashboard. Note: the executive *dashboard* (Plan Phase 7) is a product feature, not operational observability — distinct concern.
- **Risk:** Agents can't diagnose operational failures of the financial system.

### DEPLOY-X-005: manual-deploy-rituals

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids memorized command sequences; scripted builds + declarative k8s applies.
- **Risk:** Non-repeatable, non-auditable deploys.

### DEPLOY-X-006: silent-browser-errors

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids `console.error`-only handling; forward to server.
- **Risk:** Portal failures invisible to the system.

### DEPLOY-X-007: delayed-rollback

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Rollback must be automatic/immediate on health failure; human investigates after.
- **Risk:** Prolonged outage of producer/finance payout access.

### DEPLOY-X-008: single-health-check

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids one combined `/health`; require separate liveness/readiness/deep checks.
- **Risk:** Wrong remediation (restart vs. drain) during partial outages of the multi-DB commission system.

## Recommended Technology Choices

- **k3s as the container orchestrator** across demo/stage/production with environment-scoped namespaces — DEPLOY-P-001, DEPLOY-P-011, DEPLOY-P-014, DEPLOY-A-002 (already named in Plan Foundation).
- **Multi-stage distroless container images for Bun (server, web, worker)**, built and run identically in dev — DEPLOY-D-001, DEPLOY-P-001, DEPLOY-P-002, DEPLOY-A-001 (Plan's "multi-stage distroless Dockerfile").
- **k3s EncryptionConfiguration KMS seeded from a per-environment offline mnemonic at one-time SSH bootstrap**, distinct from and complementary to the Plan's **GCP Cloud KMS field-level encryption** — DEPLOY-P-013, DEPLOY-P-009, DEPLOY-C-025.
- **k8s Secrets injected per-workload as env vars; zero `.env` files; CI test creds inline in GitHub Actions YAML** — DEPLOY-P-009, DEPLOY-T-006, DEPLOY-C-003/004.
- **GitHub Actions CI** building → pushing immutable digests to a private registry → patching workload specs via the k3s control API with a narrow-scoped kubeconfig; auto-roll demo/stage, human-only production — DEPLOY-A-003, DEPLOY-D-005, DEPLOY-P-012, DEPLOY-C-015/027.
- **Cosign-style image signing in CI with a k3s admission policy verifying signatures** — DEPLOY-P-018, DEPLOY-C-036.
- **Four-type health checks per workload** — liveness, `/readyz` readiness, deep health (three PostgreSQL DBs + task queue + GCP KMS), and an end-to-end smoke suite — DEPLOY-P-015, DEPLOY-C-009/020/030/031/032/033 (Plan's "/healthz + /readyz").
- **Health-gated, ordered rollout (migrate → frontend → worker → static web) with automatic eager rollback** — DEPLOY-P-008, DEPLOY-P-016, DEPLOY-X-007, DEPLOY-C-037 (Plan's "four-phase health-gated rollout").
- **Forward-only PostgreSQL 16 migrations via the packages/db runner**, with documented N-1 forward-compatibility and labeled pre-migration snapshots (atop AlloyDB managed backups) — DEPLOY-P-007, DEPLOY-P-010, DEPLOY-P-017, DEPLOY-C-029/034.
- **Structured JSON logging to stdout** with full-stack trace-ID middleware (server + browser HTTP client), a deduplicated `uniques.log`, browser-to-server error forwarding, and 14-day rotated retention — DEPLOY-P-003/004, DEPLOY-D-002/003/004, DEPLOY-T-002/003/004, DEPLOY-C-006/007/010/011.
- **Deployment audit trail**: append-only `deployments.jsonl` dual-written to a `deployment_audit` table in the commission_audit database — DEPLOY-D-006, DEPLOY-C-035.
- **Idempotent, non-interactive deploy scripting** (`deploy.sh`, `scripts/gcp/`, `scripts/setup-ci-deployer.sh`) with zero post-init SSH — DEPLOY-P-005, DEPLOY-T-005, DEPLOY-X-005, DEPLOY-C-012/019.

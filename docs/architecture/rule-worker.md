# Blueprint: WORKER — Architecture Research

**Source:** blueprint/rules/blueprints/worker.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint governs how autonomous agents/workers participate in the platform without becoming a hole in its security and audit model. For the commission-management product, the load-bearing rules are the ones that enforce the worker as a read-only, write-through-API participant (WORKER-P-001, WORKER-P-002, WORKER-X-001) and the task-queue execution model (WORKER-D-001, WORKER-D-002). Plan Phase 1 explicitly commits to "Task queue and worker execution model — PostgreSQL claim-execute-submit queue, network-isolated worker that writes only via the API with delegated scoped credentials, dead-worker lease recovery," which is a near-verbatim instantiation of this blueprint and seeds later guarantee-expiry, clawback, and event-driven recalculation jobs (PRD §5.6, §5.3). Because every commission mutation must be permanently recorded with timestamp/actor/reason and no amount may reach payroll without explicit Finance Admin approval (PRD §9), the write-through-API, delegated-token, signed-intent, and audit-log rules are not optional hardening — they are the mechanism by which agent-initiated recalculations stay inside the platform's audit and approval boundary. Concretely this blueprint pushes the project toward: a PostgreSQL 16 task queue with atomic claim, distroless Bun worker container (no shell), per-agent-type SELECT-only DB roles with row-level security, single-use task-scoped delegated tokens, K8s/k3s network policy blocking direct DB access, and structured hash-based audit logging. Digital-twin simulation (WORKER-P-007/D-006) is now applicable and shipped: the Producer Deal Simulator runs each forecast inside an isolated digital twin (`apps/worker/src/agents/simulation.ts`, #262/#267), spawning the local `claude` CLI via `runClaudeCli` (`packages/db/src/claude-cli-engine.ts`, `Bun.spawn`) and also reaching AI-vendor APIs over HTTP via `callClaudeAPI` (`packages/db/src/claude-api-client.ts`, #188) — so the AI-vendor (WORKER-T-009), vendor-CLI-spawn (WORKER-D-004/C-007), and digital-twin (WORKER-P-007/D-006) rules and their now-active `vendor-api-key-leak` / `vendor-cli-data-exfiltration` threats are live, not theoretical.

## Rule Analysis

### WORKER-T-001: direct-db-write-bypasses-validation

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The worker must never hold DB write grants; all worker output (guarantee-expiry adjustments, clawback postings, recalculations) routes through the application API which enforces commission business rules and the immutable ledger. Implemented via SELECT-only DB role + API write endpoints.
- **Risk:** A worker writing directly to `commission_app` could post ledger adjustments or payout amounts that bypass approval gating (PRD §9) and explainability derivation, silently corrupting payroll-bound financial records.

### WORKER-T-002: compromised-credential-grants-db-write

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The worker's PostgreSQL role must be structurally read-only so a leaked connection string cannot write, regardless of token scope. Maps to plan's `app_rw` being unavailable to the worker; worker uses a SELECT-only role.
- **Risk:** A stolen worker DB credential could mutate financial fields (encrypted BYTEA commission values) without audit attribution, defeating PRD §9 audit/compliance constraints.

### WORKER-T-003: agent-reads-unauthorized-data

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** Worker DB role restricted to task-queue views and the data slice it needs, enforced by row-level security and `org_id` tenancy (plan Phase 1 tenancy column). For a single agent type the cross-type concern is light, but tenant isolation still applies.
- **Risk:** A worker reading across `org_id` boundaries would breach the confidentiality constraints (PRD §9) protecting producer payouts, draws, and firm-wide financials.

### WORKER-T-004: stale-task-claim

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Task queue must use atomic claim (`UPDATE ... WHERE status='pending' RETURNING`); acting on a stale/cancelled task yields a rejected API response. Plan's "claim-execute-submit queue" and "dead-worker lease recovery" require this.
- **Risk:** A recalculation or clawback job acting on a stale task could post a duplicate or superseded ledger adjustment, corrupting commission accruals.

### WORKER-T-005: delegated-token-outlives-task

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Delegated tokens must be single-use and task-scoped with short TTL; plan commits to "delegated scoped credentials." Server-side used-token tracking (or task-status check) required.
- **Risk:** A reusable token could be replayed to submit unauthorized ledger writes attributed to a user, undermining audit integrity (PRD §9).

### WORKER-T-006: agent-impersonates-different-user

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** API must verify the delegated token's user identity matches the task owner before committing a write. Ties to the six RBAC roles enforced in middleware (plan Phase 1).
- **Risk:** A worker submitting under the wrong identity would produce false actor attribution on financial records, violating the timestamp/actor/reason audit requirement.

### WORKER-T-007: container-shell-access

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Worker container must be distroless (no shell, no package manager, no runtime install path). Plan Phase 1 already mandates "distroless containers" and a "multi-stage distroless Dockerfile."
- **Risk:** A worker with shell access becomes an RCE foothold inside the cluster with read access to financial data.

### WORKER-T-008: cross-agent-type-access

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** Each agent type gets its own DB role + task-queue view + credentials. The MVP appears single-type (guarantee/clawback/recalculation jobs may share one worker), so this is forward-looking; the per-type role pattern should be designed in even if only one type ships first.
- **Risk:** If multiple job types later share one over-broad role, one job type could read another's tasks/data, breaking isolation.

### WORKER-T-009: vendor-api-key-leak

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The worker now reaches an external AI vendor API over HTTP via `callClaudeAPI` (`packages/db/src/claude-api-client.ts`, #188), shared by the arbitration and simulation workers for short structured prompts. The Anthropic API key must be injected as a K8s Secret, scoped minimally, never logged, and rotated; egress is restricted to the declared vendor host.
- **Risk:** A leaked vendor API key lets an attacker run AI requests on the firm's account and is a billing/abuse vector; it is now a live key surface, not a hypothetical one.

### WORKER-T-010: vendor-cli-data-exfiltration

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The Producer Deal Simulator spawns the local `claude` CLI via `runClaudeCli` (`packages/db/src/claude-cli-engine.ts`, `Bun.spawn`, #267), so a vendor CLI binary now runs inside the worker. Egress must be restricted to declared hosts and the subprocess bounded — the engine passes no tool/permission flags and enforces a hard subprocess timeout (default 60s) so a malicious or runaway invocation cannot exfiltrate the digital-twin payload it was handed.
- **Risk:** A vendor CLI with unrestricted egress could exfiltrate the producer financial data in its prompt; this is a now-active exfiltration vector for the simulation worker (see docs/architecture.md line 239, docs/arbitration-simulation.md).

### WORKER-P-001: read-only-database-access

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Worker's PostgreSQL 16 role grants SELECT on curated views only, zero write grants. A direct write returns a DB permission error before any app logic. This is the foundational worker stance for the recalculation/clawback jobs.
- **Risk:** Any write capability lets the worker bypass commission validation, approval gating, and the immutable ledger.

### WORKER-P-002: writes-through-authenticated-api

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Every worker state change is an authenticated API request using a delegated credential; the DB is network-unreachable from the worker. Plan states the worker "writes only via the API with delegated scoped credentials." Consequential commission postings should use signed transaction intent (WORKER-D-003).
- **Risk:** Direct mutation would skip the validator that enforces commission plan rules and the approval-before-payroll constraint (PRD §9).

### WORKER-P-003: deployment-time-capability-declaration

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Worker task-type subscription, DB role, and network egress are declared in the k3s/K8s deployment manifest, not chosen at runtime. Aligns with plan's k8s/ manifests and Phase 1 deployment scripts.
- **Risk:** Runtime capability selection would move the security boundary into application code that could be buggy or compromised.

### WORKER-P-004: distroless-with-explicit-allowances

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Distroless worker may still need a writable temp dir, mounted CA bundle, and config home — declared explicitly and minimally. No shell/package manager/self-mutation. Matches the multi-stage distroless Dockerfile in plan Phase 1.
- **Risk:** Unbounded runtime allowances erode the distroless guarantee and reopen the shell/RCE threat.

### WORKER-P-005: deterministic-policy-gates

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** CI should enforce machine-checkable gates: write prohibition, image composition (no shell), allowed writable paths, and network egress. Plan's CI pipeline (quality-gate, container build) is the natural home; with the digital-twin simulator now shipped (WORKER-P-007), the digital-twin/vendor-CLI gates (sandbox isolation, array-form spawn, audit-on-invocation) also apply.
- **Risk:** Without deterministic gates the worker constraints become convention and silently regress.

### WORKER-P-006: single-use-task-scoped-tokens

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** API issues a short-lived task-scoped token at task creation, invalidated on first use, expiring by TTL on failure. Requires server-side used-token state. Pairs with plan's JTI revocation infrastructure (session JTI store can back token invalidation).
- **Risk:** Long-lived or reusable tokens become interceptable credentials that can post unauthorized financial writes.

### WORKER-P-007: simulation-in-digital-twins

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** The Producer Deal Simulator (#262, shipped in #267) runs each what-if forecast inside an isolated digital twin: the worker (`apps/worker/src/agents/simulation.ts`) builds a prompt from the digital-twin payload (scenario + the producer's own plan version + fee rate) and runs it through `runClaudeCli` (`packages/db/src/claude-cli-engine.ts`), so simulation now happens against a clone, never live data.
- **Risk:** A forecast that touched live commission state instead of a twin could mutate or leak producer payout data; the twin boundary keeps simulation read-only and isolated (see docs/arbitration-simulation.md).

### WORKER-P-008: agent-type-isolation

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** Per-type DB roles, task-queue views, and credentials with isolation at network policy, DB role, and API validation. Design the per-type role pattern now; full multi-type isolation is needed only when distinct job types (e.g., recalculation vs. import) become separate deployments.
- **Risk:** A shared over-broad worker identity across job types would let one job type read or act on another's tasks.

### WORKER-D-001: task-queue-read-only-view

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** PostgreSQL per-type view over the task-queue table filtered by type/status; claim via API atomic `UPDATE ... WHERE status='pending' RETURNING`; worker role can read the view but not write the claim. This is exactly plan Phase 1's "PostgreSQL claim-execute-submit queue."
- **Risk:** Without atomic claim, concurrent workers race and the same guarantee/clawback job runs twice, double-posting ledger adjustments.

### WORKER-D-002: delegated-user-token

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** At task creation the API mints a single-use, task-scoped capability token encoding task ID, user ID, allowed endpoints, and expiry; the worker presents it on result submission; API executes on behalf of the user, records the worker as executor, invalidates the token. Provides the dual attribution PRD §9 audit needs.
- **Risk:** Generic service tokens would lose user attribution, breaking the actor field requirement for ledger changes.

### WORKER-D-003: signed-transaction-intent

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** For consequential commission actions (clawback postings, recalculated payouts), the worker submits a signed transaction intent; the API validator checks policy/business rules/current state, then appends through the standard write path, preserving both principal authority and worker execution provenance. Directly supports the approval-gated, immutable ledger.
- **Risk:** Skipping the validator boundary lets worker output mutate payout state without the business-rule and approval checks PRD §9 mandates.

### WORKER-D-004: vendor-binary-process-spawn

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** The simulation worker spawns the `claude` CLI binary via `runClaudeCli` (`packages/db/src/claude-cli-engine.ts`, #267) using array-form `Bun.spawn([bin, '-p'], …)` — never a shell string — feeding the prompt over stdin and bounding the run with a hard timeout. The binary is supplied by the operator's local toolchain (overridable via `CLAUDE_CLI_BIN`); the subprocess launcher is injectable so hermetic tests never invoke the real binary.
- **Risk:** Shell-form or unbounded spawning would reopen shell-injection and runaway-subprocess vectors; the array-form, timeout-bounded engine contains them.

### WORKER-D-005: structured-execution-audit-log

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Every worker execution (task claim, result submission, recalculation event) is logged to a structured audit table via the API into the `commission_audit` database (plan's third DB with `audit_w` role). Log entries carry task ID, type, operation, input/output hashes, token used, timestamp, status. Content stays in the task record under field encryption.
- **Risk:** Without structured audit, agent-initiated ledger changes are not attributable/inspectable, violating the permanent-record audit constraint.

### WORKER-D-006: sandboxed-digital-twin-execution

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** The Producer Deal Simulator executes each forecast in an isolated digital twin: the worker requests a twin, runs the `runClaudeCli` forecast against the twin payload, and never promotes simulated results into live commission state (`apps/worker/src/agents/simulation.ts`, docs/arbitration-simulation.md). The CLI subprocess is itself sandboxed by a bounded timeout and no tool/permission flags.
- **Risk:** Running simulation against live data, or promoting twin output without the validator boundary, would corrupt or leak producer payout records.

### WORKER-D-007: per-agent-type-database-role

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Dedicated PostgreSQL role per agent type with SELECT on type-specific views only, row-level security on the task-queue table, credential injected via K8s Secret per deployment. Adding a type requires a DB init-script change + review. Build the pattern now; instantiate per type as job types diverge.
- **Risk:** A single shared worker role across job types defeats isolation and lets one job type read another's queue/reference data.

### WORKER-A-001: single-agent-single-replica

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** Recommended starting architecture: one worker type, one replica, claim+result via API, SELECT-only on its task-queue view, network policy blocking direct DB. Fits the MVP's low-volume background jobs (guarantee expiry, clawback, recalculation) where the queue provides natural buffering.
- **Risk:** No redundancy — if the worker dies, jobs queue until restart; acceptable at MVP volume but requires the dead-worker lease recovery the plan calls for.

### WORKER-A-002: multi-agent-concurrent-replicas

- **Type:** architecture
- **Applicable:** partial
- **Technology implication:** Target architecture once multiple job types or higher volume arrive: per-type K8s deployments, DB roles, and credentials behind a single API write surface, scaling replicas independently. Requires atomic claim to avoid duplicate execution under horizontal scaling.
- **Risk:** Without per-type isolation and atomic claim, concurrent replicas duplicate financial postings or cross-read task types.

### WORKER-C-001: no-shell-binary-in-image

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Worker image builds with no `/bin/sh`; verify `docker run ... which sh` returns non-zero. Enforce in the CI container-build job.
- **Risk:** A shell in the image reintroduces the RCE/exfiltration threat.

### WORKER-C-002: select-only-db-role

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Worker DB role has SELECT-only grants on the task-queue view; INSERT/UPDATE/DELETE must error. Add a test in the migration/test suite.
- **Risk:** Any write grant lets the worker bypass validation and approval gating.

### WORKER-C-003: atomic-task-claim

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Claim endpoint performs an atomic update; concurrent claim by two workers yields exactly one success. Load-test with two replicas.
- **Risk:** Non-atomic claim causes duplicate clawback/recalculation postings.

### WORKER-C-004: delegated-token-wrong-task-rejected

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Token presented with wrong task ID returns 403. Add API test.
- **Risk:** Cross-task token use enables unauthorized writes attributed to the wrong placement.

### WORKER-C-005: delegated-token-single-use-enforced

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Second submission with the same token returns 403; requires server-side used-token state (reuse the JTI revocation store).
- **Risk:** Replayable tokens allow duplicate ledger writes.

### WORKER-C-006: network-policy-blocks-direct-db

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** k3s/K8s NetworkPolicy blocks the worker from the DB port; verify via `kubectl exec` attempt. Belongs in the k8s/ manifests.
- **Risk:** Network reachability to the DB makes the SELECT-only role the only barrier; defense-in-depth requires the network block too.

### WORKER-C-007: vendor-cli-array-form-spawn

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** The simulation engine spawns the vendor CLI in array form — `Bun.spawn([bin, '-p'], …)` in `defaultClaudeCliSpawn` (`packages/db/src/claude-cli-engine.ts`) — never a shell string. Test that the spawn path uses array-form and feeds the prompt over stdin, not interpolated into a command line.
- **Risk:** Any regression to shell-form invocation would expose the worker to shell injection from prompt/business data.

### WORKER-C-008: audit-log-on-vendor-invocation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Now that the simulation worker invokes the `claude` CLI (and `callClaudeAPI`), each vendor invocation must produce a structured audit entry — correlated by `taskId` to its `simulation_run` / `task_queue` row — into `commission_audit`, alongside the existing task-claim and result-submission entries.
- **Risk:** Missing audit entries on vendor invocation break the permanent-record requirement for agent-driven, AI-assisted changes.

### WORKER-C-009: signed-intent-through-validator

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test that worker proposals (clawback/recalculation) are accepted only through the validator, never by direct mutation.
- **Risk:** A bypass path lets worker output skip commission business-rule validation.

### WORKER-C-010: dual-attribution-on-writes

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Consequential writes record both principal authority (user) and executing worker. Directly satisfies PRD §9 actor attribution.
- **Risk:** Single-attribution writes cannot distinguish who authorized vs. who executed a financial change.

### WORKER-C-011: digital-twin-sandbox-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test that the Producer Deal Simulator forecast runs against an isolated digital twin and cannot reach live commission state — covering the `runClaudeCli` path in `apps/worker/src/agents/simulation.ts`.
- **Risk:** An untested twin boundary could silently regress and let simulation touch live producer data.

### WORKER-C-012: twin-promotion-boundary

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify simulated forecast output is never promoted into live commission records except through the standard validated write path; the simulator surfaces `{ payout_estimate, dispute_risk, reasoning }` as a forecast, not a ledger mutation.
- **Risk:** A promotion path that bypasses the validator would let simulated numbers reach payroll-bound state.

### WORKER-C-013: agent-service-token-isolation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** The worker's service token must be distinct from user tokens and frontend tokens, with non-overlapping scope claims, layered on the Phase 1 session/JTI design.
- **Risk:** Overlapping scopes let a worker token act as a user session or vice versa.

### WORKER-C-014: per-type-db-role-isolation

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Verify each agent type's role cannot SELECT another type's task-queue view. Relevant once a second job type ships; design the role layout to make this test meaningful.
- **Risk:** Cross-type SELECT leaks one job type's tasks/data to another.

### WORKER-C-015: delegated-token-ttl-enforced

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Token presented after TTL returns 401 regardless of use count. Short TTL such that expiry-before-use is the expected crash outcome.
- **Risk:** Long TTLs make leaked tokens usable long after the task.

### WORKER-C-016: task-retry-after-crash

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test that a crashed worker's task re-enters the queue after lease timeout and a new claim succeeds — exactly plan's "dead-worker lease recovery."
- **Risk:** Without lease recovery, a crashed recalculation/clawback job is silently lost.

### WORKER-C-017: vendor-api-key-rotation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** The Anthropic API key used by `callClaudeAPI` (`packages/db/src/claude-api-client.ts`) is injected as a K8s Secret and must be rotatable without a code change and never written to logs. Verify rotation swaps the Secret cleanly and old keys stop working.
- **Risk:** A non-rotatable or logged vendor key becomes a durable, leakable credential (WORKER-T-009).

### WORKER-C-018: audit-log-hashes-not-plaintext

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Audit log entries store input/output hashes, not plaintext financial content; content lives in the task record under field-level encryption (Phase 1 FieldEncryptor + KMS). Audit logs are often less protected than app data.
- **Risk:** Plaintext financial data in audit logs would leak regulated/sensitive compensation data outside the encryption boundary.

### WORKER-C-019: ci-rebuilds-agent-image

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** CI rebuilds and redeploys the worker image on changes to the worker app (`apps/worker`) with no manual steps. Fits the Phase 1 GitHub Actions container-build workflow.
- **Risk:** Manual image updates drift and bypass the no-runtime-update guarantee.

### WORKER-C-020: agent-type-penetration-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Use the worker DB credential to attempt a direct write and confirm DB-layer permission denied. Add to security tests.
- **Risk:** Untested write prohibition may regress silently.

### WORKER-C-021: delegated-token-replay-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Intercept-and-replay a delegated token; confirm 403 on second use.
- **Risk:** Replay enables duplicate financial writes.

### WORKER-C-022: horizontal-scaling-no-duplicates

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** When N replicas run, confirm zero duplicate task execution under sustained load. Relevant once the worker scales beyond one replica (WORKER-A-002).
- **Risk:** Duplicate execution double-posts clawback/recalculation adjustments.

### WORKER-C-023: vendor-cli-version-pinned

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** The `claude` CLI invoked by `runClaudeCli` (`packages/db/src/claude-cli-engine.ts`) is provided by the operator's local toolchain (binary overridable via `CLAUDE_CLI_BIN`); its version should be pinned/declared for the simulation worker so forecast behaviour is reproducible and not silently changed by an out-of-band CLI upgrade.
- **Risk:** An unpinned vendor CLI lets a host-level upgrade change forecast output or introduce a vulnerable binary unnoticed.

### WORKER-C-024: egress-restricted-to-vendor-hosts

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** The worker now reaches the Anthropic vendor host over HTTP (`callClaudeAPI`); egress must be restricted to the API, KMS, and the declared vendor host(s), with all other egress blocked and logged via k3s NetworkPolicy. The CLI-spawn path (`runClaudeCli`) shares this egress boundary.
- **Risk:** Unrestricted egress is an exfiltration path for the financial data the worker reads — now also via the vendor API/CLI invocation (WORKER-T-010).

### WORKER-X-001: direct-database-writes

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden: any worker DB write path. The worker must have zero write grants and route all mutations through the API. No exceptions.
- **Risk:** Direct writes simultaneously bypass schema validation, commission business logic, approval gating, and audit logging — catastrophic for a payroll-bound financial ledger.

### WORKER-X-002: shared-service-token

- **Type:** antipattern
- **Applicable:** partial
- **Technology implication:** Forbidden once multiple job types exist: a single shared service token. Each agent type needs its own service identity so access can be revoked and audited per type.
- **Risk:** A shared token makes per-type revocation impossible and audit logs unintelligible.

### WORKER-X-003: broad-scope-delegated-token

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden: a delegated token granting general user write access. Scope must be exactly "submit a result for this task," nothing more.
- **Risk:** A broad token is a user session token in disguise, enabling arbitrary writes attributed to the user.

### WORKER-X-004: long-lived-delegated-tokens

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden: hour/day-lived tokens. TTL must be short enough that expiry-before-use is the expected outcome of a crashed worker.
- **Risk:** Long-lived tokens become interceptable, cacheable, leakable credentials.

### WORKER-X-005: runtime-capability-selection

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden: worker reading runtime config to decide its task types, DB views, or APIs. Capability is enforced at the DB role, network policy, and K8s manifest layers only.
- **Risk:** Application-layer capability selection can be overridden by buggy or adversarial worker code.

### WORKER-X-006: shell-form-cli-invocation

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** The simulation worker spawns the `claude` CLI today, and it does so correctly: array-form `Bun.spawn([bin, '-p'], …)` in `claude-cli-engine.ts`, never `sh -c "..."`, even for trusted input. The prompt is fed over stdin, not interpolated into a command string.
- **Risk:** Any regression to shell-form invocation exposes the worker to shell injection from prompt/business data.

### WORKER-X-007: runtime-vendor-cli-update

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden: any runtime download/execute path (`npm install`, `pip install`, `curl|bash`) in the worker. Versions fixed at image build; updates require a new image + rolling deploy. Reinforced by the distroless image.
- **Risk:** A runtime-update path is a remote-code-execution vulnerability inside the cluster.

### WORKER-X-008: prompt-content-in-audit-log

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** The simulation/arbitration workers now build Claude prompts from financial context, so the rule is concrete: the audit log stores hashes and metadata, never the full prompt or financial content; sensitive content lives in the task record under field-level encryption and access control.
- **Risk:** Storing prompt/compensation content in less-protected audit logs leaks regulated data.

## Recommended Technology Choices

- PostgreSQL 16 task queue with atomic claim (`UPDATE ... WHERE status='pending' RETURNING`) and dead-worker lease recovery — WORKER-D-001, WORKER-T-004, WORKER-C-003, WORKER-C-016.
- SELECT-only per-agent-type PostgreSQL role with row-level security and `org_id` tenancy; worker never holds `app_rw` — WORKER-P-001, WORKER-D-007, WORKER-C-002, WORKER-X-001.
- Write-through-API model: the application API (not the DB) is the only worker write surface, with a validator enforcing commission business rules and approval gating — WORKER-P-002, WORKER-D-003, WORKER-C-009.
- Distroless multi-stage Bun worker image (no shell, no package manager, no runtime install), CI-rebuilt on `apps/worker` changes — WORKER-P-004, WORKER-T-007, WORKER-C-001, WORKER-C-019, WORKER-X-007.
- Single-use, task-scoped, short-TTL delegated capability tokens issued at task creation and invalidated on first use, backed by the Phase 1 JTI revocation store; distinct from user and frontend tokens — WORKER-P-006, WORKER-D-002, WORKER-C-005, WORKER-C-013, WORKER-C-015, WORKER-X-003, WORKER-X-004.
- Dual-attribution writes (principal user + executing worker) satisfying PRD §9 actor/timestamp/reason audit — WORKER-D-002, WORKER-C-010.
- Structured, hash-based execution audit log written via the API into the `commission_audit` database (`audit_w` role); plaintext financial content stays in encrypted task records, never in logs — WORKER-D-005, WORKER-C-018, WORKER-X-008.
- k3s/K8s NetworkPolicy blocking worker→DB port and restricting egress to the API (and KMS), with capability declared in deployment manifests — WORKER-P-003, WORKER-C-006, WORKER-C-024, WORKER-X-005.
- Start with single-agent/single-replica architecture; design per-type DB roles and credentials so the multi-agent/concurrent-replicas architecture (with horizontal-scaling duplicate-free claim) is a later configuration step, not a rewrite — WORKER-A-001, WORKER-A-002, WORKER-P-008, WORKER-C-022.
- Digital-twin simulation and AI-vendor integration are shipped, not deferred: the Producer Deal Simulator (#262/#267) runs forecasts in an isolated digital twin (`apps/worker/src/agents/simulation.ts`) by spawning the local `claude` CLI via `runClaudeCli` (`packages/db/src/claude-cli-engine.ts`, array-form `Bun.spawn`, hard timeout, no tool/permission flags) and reaching the AI vendor over HTTP via `callClaudeAPI` (`packages/db/src/claude-api-client.ts`, #188). Govern the now-active `vendor-api-key-leak` and `vendor-cli-data-exfiltration` threats with K8s-Secret key injection + rotation, egress restricted to the API/KMS/declared vendor hosts, hash-only audit logging of every vendor invocation, and the twin-isolation boundary — WORKER-P-007, WORKER-D-004, WORKER-D-006, WORKER-T-009, WORKER-T-010, WORKER-C-007, WORKER-C-008, WORKER-C-017, WORKER-C-024.

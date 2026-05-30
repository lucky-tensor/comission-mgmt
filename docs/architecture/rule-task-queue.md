# Blueprint: TASK-QUEUE — Architecture Research

**Source:** blueprint/rules/blueprints/task-queue.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This project is a commission-management ledger, not an AI-agent orchestration platform, so the task queue serves a narrower role than the blueprint's primary user stories: it is the durable backbone for deferred, event-driven background work — guarantee-expiry monitoring, clawback/holdback application, collection-gated commission release, and event-driven recalculation. The Plan (Phase 1) explicitly commits to "a PostgreSQL claim-execute-submit queue, network-isolated worker that writes only via the API with delegated scoped credentials, dead-worker lease recovery." That single sentence maps directly onto the most load-bearing blueprint rules: TQ-A-001 / TQ-D-001 (single-table Postgres queue, no external broker), TQ-P-001 (atomic claim), TQ-D-003 (stale-claim recovery), and TQ-P-002/TQ-C-004 (opaque-reference payloads — critical because this system handles encrypted financial PII and is under strict audit/confidentiality constraints in PRD §9). TQ-P-004 (bounded retry with dead-letter) is essential because guarantee/clawback jobs touch money and must never silently vanish or retry forever. The chief technology implication is decisive: reuse the existing PostgreSQL 16 instance as the queue backend rather than introducing Redis/RabbitMQ/SQS, keeping one consistency domain, one credential surface, and one audited store. Note the blueprint's Rust/tokio references (TQ-D-003) are illustrative; this project's stack is TypeScript/Bun, so equivalents (a Bun scheduled task or pg_cron) apply.

## Rule Analysis

### TQ-T-001: stale-claim-allows-duplicate-execution

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Claims must set a `claim_expires_at` and recovery must use a bounded timeout; the delegated scoped credential (Plan Phase 1) must be single-use so a recovered task and a slow original worker cannot both submit results.
- **Risk:** A worker crashing mid clawback-application or commission-recalculation either strands the money-affecting task forever or, with naive recovery, applies the same ledger adjustment twice — directly violating PRD §9 audit integrity ("never silently overwritten").

### TQ-T-002: payload-leaks-business-data

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Queue payloads must carry only opaque IDs (placement_id, commission_id, org_id, correlation_id, job_type). Names, fee amounts, draw balances, and producer compensation must be fetched by the worker through authenticated API reads at execution time.
- **Risk:** This system encrypts financial fields at rest (Plan: FieldEncryptor, KMS, encrypted BYTEA) precisely because the data is sensitive. Embedding amounts or PII in a JSONB payload re-exposes it through DB logs, monitoring, and dead-letter inspection — defeating the encryption investment and breaching PRD §9 confidentiality.

### TQ-T-003: unbounded-retry-amplifies-failure

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Every background job type needs a configurable `max_attempts` with exponential backoff and a terminal `dead` status.
- **Risk:** A guarantee-expiry or recalculation job that fails every attempt (e.g., bad plan-version reference) would consume worker capacity indefinitely and bury the real failure, delaying commission close — the opposite of the PRD goal "reduce time to close a commission cycle."

### TQ-T-004: notification-missed-causes-stuck-task

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** If LISTEN/NOTIFY is used to reduce latency, the polling loop must remain authoritative. Given this project's tasks are mostly time-driven (guarantee expiry, collection events) rather than interactive, polling alone may suffice and NOTIFY is an optional latency optimization.
- **Risk:** Treating a missed notification as fatal would strand a clawback or recalculation task; a bounded poll interval prevents starvation regardless of notification loss.

### TQ-T-005: priority-inversion-starves-tasks

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** A `priority` column with FIFO-within-band ordering is adequate. Age-based escalation is explicitly deferrable to a future scheduled job with no schema change.
- **Risk:** Low for this workload — task volume is firm-scale (tens to low hundreds per minute at most), so starvation is unlikely, but a runaway recalculation burst could delay a guarantee-expiry job past its meaningful window if priority bands were misused.

### TQ-T-006: duplicate-task-execution

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Every task carries a caller-supplied `idempotency_key` with a UNIQUE constraint; duplicate creation returns the existing task.
- **Risk:** Collection events imported from AR systems (PRD §7) and Finance Admin actions can be redelivered or double-clicked. Without idempotent creation, a single invoice-paid event could trigger two commission-release tasks, paying out twice — a direct overpayment risk the PRD lists as a strategic metric to reduce.

### TQ-P-001: atomic-claim-exactly-one-winner

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Claims use atomic `UPDATE ... WHERE status = 'pending' RETURNING` arbitrated by Postgres row-level locks. No Redis lock, no distributed lock service, no app-level mutex. This is the foundation of the Plan's "claim-execute-submit queue."
- **Risk:** Without DB-arbitrated claims, two worker replicas could both apply the same clawback or run the same recalculation, corrupting the audited ledger.

### TQ-P-002: opaque-reference-payloads

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Payload JSONB restricted to opaque resource IDs and routing metadata; workers resolve to business data via authenticated API read endpoints (consistent with the Plan's network-isolated worker that talks only to the API).
- **Risk:** See TQ-T-002 — leaking encrypted-at-rest financial data into an unencrypted, log-visible payload breaks the confidentiality model.

### TQ-P-003: idempotent-task-creation

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** `idempotency_key` column with a database-level UNIQUE constraint; creation conflicts return the existing row (HTTP 200).
- **Risk:** See TQ-T-006 — duplicate money-affecting tasks from redelivered AR/ATS events.

### TQ-P-004: bounded-retry-with-dead-letter

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Exponential backoff up to configurable `max_attempts`, then a terminal `dead` status; dead rows are retained, never deleted. Business-rule rejections (HTTP 422 — e.g., a clawback violating a configured policy) are terminal on first attempt.
- **Risk:** A silently dropped dead task means a guarantee clawback or collection release never happens and no operator is alerted — an unrecorded financial miss that contradicts PRD §9 ("permanently recorded — never silently overwritten").

### TQ-P-005: notification-assists-polling-not-replaces

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** If LISTEN/NOTIFY is adopted, the bounded polling loop stays the source of truth. For this mostly time-driven workload, polling may be the only mechanism needed initially.
- **Risk:** Relying solely on notifications would let restart/disconnect windows drop financial tasks.

### TQ-D-001: postgres-queue-table

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** A single `task_queue` table in the existing `commission_app` PostgreSQL 16 database, with partial indexes on `(agent_type, status, priority, created_at) WHERE status='pending'` and `(status, claim_expires_at) WHERE status='claimed'`, plus a UNIQUE index on `idempotency_key`. No separate broker.
- **Risk:** Introducing Redis/RabbitMQ/SQS adds a second consistency domain and credential surface that the audit/confidentiality model would also have to cover — unjustified at this firm-scale volume.

### TQ-D-002: status-lifecycle-machine

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** A `status` TEXT column with a CHECK constraint over `pending → claimed → running → submitting → completed | failed | dead`. The API server (the Plan's sole write path) enforces valid transitions; workers read via views and never write status directly. Cancellation states are deferred.
- **Risk:** Unenforced transitions let tasks stall or double-run, stalling commission close.

### TQ-D-003: stale-claim-recovery

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** A scheduled recovery sweep (default ~60s) in the API server resets expired claims: `UPDATE task_queue SET status = CASE WHEN attempt >= max_attempts THEN 'dead' ELSE 'pending' END ... WHERE status='claimed' AND claim_expires_at < now()`. The blueprint names tokio-cron/pg_cron; for this TypeScript/Bun stack the equivalent is a Bun scheduled task in the server or `pg_cron`. Each recovery is written to the audit DB (`commission_audit`). This realizes the Plan's "dead-worker lease recovery."
- **Risk:** Without it, a crashed worker permanently strands guarantee/clawback tasks.

### TQ-D-004: per-type-filtered-views

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Per-agent-type Postgres views (`task_queue_view_<type>`) projecting only non-sensitive columns and excluding `delegated_token`, `created_by`, `result`, `error_message`. Useful if multiple distinct worker types emerge (e.g., guarantee-monitor vs. recalculation); with a single worker type at MVP this can be a single view. Pairs with per-type DB roles and RLS — consistent with the Plan's three DB roles and tenancy model.
- **Risk:** Over-broad views could expose the delegated token or other workers' rows; low immediate risk given one worker type, but the projection discipline should be set up from the start.

### TQ-D-005: listen-notify-wake

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Optional AFTER INSERT trigger calling `pg_notify('task_queue_<agent_type>', task_id)` to wake workers below the poll interval. Justified only where latency matters; this project's jobs are largely scheduled/time-driven, so NOTIFY is a nice-to-have, not required for MVP.
- **Risk:** None if omitted (polling covers it); if added, must remain supplementary (see TQ-X-004).

### TQ-D-006: priority-ordered-fifo

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** `priority` column; poll uses `ORDER BY priority ASC, created_at ASC LIMIT N`, covered by the pending partial index. Lets, e.g., time-sensitive guarantee-expiry jobs outrank bulk recalculations.
- **Risk:** Minimal; age escalation deferrable.

### TQ-A-001: single-table-postgres-queue

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** The definitive architecture for this project: one `task_queue` table in the application PostgreSQL instance, API server as sole writer, workers polling views and claiming via API, no external broker. Volumes (firm-scale, tens-to-low-hundreds/min) are well within Postgres capacity, and the transport-agnostic schema leaves a broker swap open if ever needed.
- **Risk:** Adopting a broker prematurely adds operational and security surface for no throughput benefit.

### TQ-C-001: claim-atomicity-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Add a concurrency test: two workers claim the same task → exactly one 2xx success, one 409, under multiple replicas. Fits the Plan's `test-api` CI suite.
- **Risk:** Untested atomicity risks double-applied ledger adjustments going undetected.

### TQ-C-002: stale-recovery-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test: claim → kill worker → task returns to `pending` after `claim_expires_at` → new worker completes. Belongs in the integration/test-api suite.
- **Risk:** Unverified recovery is a silent single point of stuck financial work.

### TQ-C-003: dead-letter-threshold-alerted

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Emit a `task_queue_dead_total` metric per `agent_type`/`job_type` and alert above a threshold (ties to the Plan's structured JSON logging / observability foundation).
- **Risk:** Without alerting, a batch of dead clawback/recalc tasks fails unnoticed, corrupting close-cycle correctness.

### TQ-C-004: payload-contains-no-pii

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Task-creation validation rejects payloads containing denylisted keys (email, name, address, phone, ssn, content, body, message). Implement in the API write path. Extend the denylist for this domain (e.g., amount, fee, salary, draw).
- **Risk:** This is the enforcement mechanism that keeps encrypted financial PII out of the queue; skipping it undermines PRD §9 confidentiality and the field-encryption design.

### TQ-C-005: idempotency-key-enforced

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test that duplicate creation with the same `idempotency_key` returns the existing task (200) and the UNIQUE violation is handled gracefully.
- **Risk:** See TQ-T-006 — double payouts from redelivered events.

### TQ-C-006: notification-channel-per-type

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Only relevant if TQ-D-005 NOTIFY is adopted; then verify channels are per-agent-type and the trigger uses `NEW.agent_type`.
- **Risk:** None if NOTIFY is not used.

### TQ-C-007: priority-ordering-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test mixed-priority insertions return in `priority ASC, created_at ASC` order.
- **Risk:** Low; ensures urgent time-bound jobs are not delayed behind bulk work.

### TQ-C-008: startup-role-verification-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** The worker must verify at startup that its DB role is read-only on `task_queue` and refuse to start (exit non-zero, logged) if it holds write/INSERT capability. This directly enforces the Plan's "writes only via the API with delegated scoped credentials." The blueprint's IMPL reference (`IMPL-TQ-RS-006`) is Rust-named; implement the equivalent check in the TypeScript/Bun worker.
- **Risk:** A misprovisioned write-capable worker could bypass the API's audit and status-machine enforcement, breaking the sole-writer guarantee and PRD §9 audit integrity.

### TQ-X-001: polling-without-backoff

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** The worker poll loop must sleep a configurable interval (seconds, not milliseconds) when the queue is empty.
- **Risk:** Tight polling wastes DB connections/CPU against the shared `commission_app` instance that also serves the live app.

### TQ-X-002: business-data-in-payload

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbidden to embed amounts, producer names, or any business content in the payload — references only. Enforced by TQ-C-004 validation.
- **Risk:** See TQ-T-002 — re-exposes encrypted financial PII via infrastructure tooling.

### TQ-X-003: retry-without-limit

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** No unbounded retries; bounded attempts + dead-letter required (TQ-P-004).
- **Risk:** Permanent worker-capacity drain hiding a real failure during commission close.

### TQ-X-004: notification-as-sole-trigger

- **Type:** antipattern
- **Applicable:** partial
- **Technology implication:** If NOTIFY is added, it must never be the sole discovery mechanism; polling stays mandatory.
- **Risk:** Dropped notifications during restarts would strand financial tasks; moot if polling-only.

## Recommended Technology Choices

- **PostgreSQL 16 as the queue backend — a single `task_queue` table in the existing `commission_app` database; no Redis/RabbitMQ/SQS.** (TQ-A-001, TQ-D-001) Keeps one consistency domain and one credential/audit surface, matching the Plan's three-DB design and firm-scale volumes.
- **Atomic `UPDATE ... WHERE status='pending' RETURNING` claims arbitrated by Postgres row locks; no external lock service.** (TQ-P-001)
- **Status CHECK-constraint state machine (`pending → claimed → running → submitting → completed | failed | dead`) enforced by the API server as sole writer; workers read-only.** (TQ-D-002, TQ-C-008)
- **Opaque-reference JSONB payloads (IDs + routing metadata only) with a creation-time PII/financial denylist validator.** (TQ-P-002, TQ-C-004, TQ-X-002) Protects the encrypted-at-rest financial data and PRD §9 confidentiality.
- **`idempotency_key` column with a UNIQUE constraint; duplicate creation returns the existing task.** (TQ-P-003, TQ-C-005) Prevents double payouts from redelivered ATS/AR events.
- **Bounded exponential-backoff retry with configurable `max_attempts` and a terminal, never-deleted `dead` status; 422 business-rule rejections terminal on first attempt.** (TQ-P-004, TQ-X-003)
- **Scheduled stale-claim recovery sweep (~60s) via a Bun scheduled task or `pg_cron` — not tokio — writing each recovery to the `commission_audit` DB.** (TQ-D-003) Implements the Plan's "dead-worker lease recovery."
- **Partial indexes: `(agent_type, status, priority, created_at) WHERE status='pending'`, `(status, claim_expires_at) WHERE status='claimed'`, and UNIQUE on `idempotency_key`.** (TQ-D-001, TQ-D-006)
- **Priority-ASC, created_at-ASC FIFO poll ordering; age-escalation deferred.** (TQ-D-006, TQ-T-005)
- **Polling loop with a configurable seconds-scale backoff as the authoritative discovery mechanism; LISTEN/NOTIFY only as an optional latency optimization, never the sole trigger.** (TQ-P-005, TQ-D-005, TQ-X-001, TQ-X-004)
- **Network-isolated worker holding a read-only DB role plus a delegated scoped API credential, with startup role verification that aborts if write capability is detected.** (TQ-C-008, TQ-D-004)
- **Dead-letter depth metric (`task_queue_dead_total`) per agent/job type with threshold alerting, plus CI tests for claim atomicity, stale recovery, idempotency, and priority ordering.** (TQ-C-001, TQ-C-002, TQ-C-003, TQ-C-005, TQ-C-007)

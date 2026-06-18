# Arbitration & Simulation Worker Infrastructure

> Shared worker infrastructure for Dispute Arbitration Engine (#186) and the Producer Deal Simulator.
> Establishes task queue views, database roles, the Claude HTTP client, and worker entrypoints.
> **Status:** the Producer Deal Simulator half is SHIPPED (issue #262, delivered in #267) — the
> simulation worker spawns the local `claude` CLI via `runClaudeCli`; see the "Implemented pipeline
> (issue #262)" table below. The Dispute Arbitration Engine (#186) remains a scout stub.

## Phase

Arbitration & Simulation

## Scope

This document describes the **worker infrastructure** for two planned AI-driven features:
- **Dispute Arbitration Engine (#186)**: Workers process disputes using Claude, recommending resolutions
- **Producer Deal Simulation (#187)**: Workers simulate deal outcomes in digital twins using Claude

This scout prepares shared infrastructure that both features depend on. See the respective feature issues for detailed behavior and acceptance criteria.

## Architecture Overview

### Three-Layer Execution Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Application API Layer (server/src)                                         │
│  - Task creation, authentication, delegated token issuance                  │
│  - Result submission, dispute/deal updates, audit logging                   │
│  - Exposes: POST /tasks (claim), GET /tasks (poll), POST /results (submit)  │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                  ┌────────────┴────────────┐
                  │  Task Queue (shared)    │
                  │  PostgreSQL task_queue  │
                  │  Views per agent type   │
                  │  Read-only to workers   │
                  └────────────┬────────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        │                                              │
┌───────▼──────────────────┐          ┌───────────────▼────────┐
│  Arbitration Worker      │          │  Simulation Worker     │
│  (agent_type=...)        │          │  (agent_type=...)      │
│  - Claims arbitration    │          │  - Claims simulation   │
│    tasks                 │          │    tasks               │
│  - Calls Claude API      │          │  - Executes in twin    │
│  - Returns resolution    │          │  - Calls Claude API    │
│  - Submits via delegated │          │  - Returns predictions │
│    token                 │          │  - Submits via token   │
└──────────────────────────┘          └────────────────────────┘
```

### Delegated Token Write Path

Workers **cannot write directly to the database**. Instead:

1. API creates a task with a **delegated single-use token** scoped to that task
2. Worker fetches task payload via read-only view
3. Worker **executes work** (Claude calls, calculations, etc.)
4. Worker **submits result via API** using the delegated token:
   - `POST /disputes/:id/arbitration-result` (arbitration feature)
   - `POST /producer/simulations/:id/result` (simulation feature)
5. API validates result, updates ledger, invalidates token

Per **WORKER-P-002** (writes-through-authenticated-api), this ensures every agent write is subject to the same validation, authorization, and audit logging as human-initiated requests.

## Database Schema

### Task Queue Views

Two read-only views filter the shared `task_queue` table by agent type:

#### `task_queue_view_arbitration`

Filters `agent_type = 'arbitration_agent'`. Exposes columns:
- `id` — Task UUID
- `job_type` — Always `'arbitration_dispute'` (stub: placeholder for feature #186)
- `status` — `'pending' | 'claimed' | 'running' | ...`
- `payload` — JSONB with opaque references: `{ dispute_id, commission_record_id, ... }`
- `correlation_id` — For audit trail
- `priority` — Task urgency (lower number = higher priority)
- `created_at` — Task creation timestamp
- `attempt` — Attempt count (0 for initial)
- `max_attempts` — Maximum retries before dead-letter

**Excluded columns** (sensitive, not visible to worker):
- `delegated_token` (received only in claim API response)
- `created_by` (audit only)
- `result` (written by API after submission)
- `error_message` (audit only)

#### `task_queue_view_simulation`

Filters `agent_type = 'simulation_agent'`. Identical structure to arbitration view.

### Database Roles

#### `arbitration_agent`

- **Privileges**: `SELECT` on `task_queue_view_arbitration` only
- **Creates**: Certificates, environment setup per worker pod
- **Startup Guard**: If role has INSERT/UPDATE/DELETE/TRUNCATE, worker panics before main loop (IMPL-TQ-RS-006)

#### `simulation_agent`

- **Privileges**: `SELECT` on `task_queue_view_simulation` only
- **Creates**: Certificates, environment setup per worker pod
- **Startup Guard**: If role has INSERT/UPDATE/DELETE/TRUNCATE, worker panics before main loop (IMPL-TQ-RS-006)

### Role Assignment Matrix

| Agent Type | Job Type(s) | Reads View | Reads Tables |
|---|---|---|---|
| `arbitration_agent` | `arbitration_dispute` | `task_queue_view_arbitration` | None (via view only) |
| `simulation_agent` | `producer_simulation` | `task_queue_view_simulation` | None (via view only) |

## Shared Infrastructure: Claude API Client

### Location

`packages/db/src/claude-api-client.ts`

Exported from `packages/db/index.ts` as:
```typescript
export { callClaudeAPI };
export type { ClaudeApiResponse, ClaudeApiContext };
```

### Usage

```typescript
import { callClaudeAPI, type ClaudeApiContext } from 'db';

const context: ClaudeApiContext = {
  taskId: '<task-uuid>',
  jobType: 'dispute_arbitration', // or 'producer_simulation'
  correlationId: '<dispute-or-deal-id>',
  userId: '<user-who-triggered>',
};

const result = await callClaudeAPI(
  context,
  '<prompt>',
  30000, // timeout in ms (default: 30s)
  3,     // max attempts (default: 3)
);

if (result.status === 'success') {
  console.log(result.result);
} else {
  console.log(result.error.code, result.error.retriable);
}
```

### Behavior

**Timeout**: 30 seconds per request (configurable).

**Retry Strategy**: Exponential backoff (2^N seconds) up to 3 attempts (configurable).

**Error Handling**:
- **Transient** (timeout, 5xx, rate limit): Logged to audit DB, `retriable=true`
- **Permanent** (4xx except rate limit, auth): Logged to audit DB, `retriable=false`

**Audit Logging**: Errors logged to `commission_audit` DB with:
- `task_id`
- `job_type`
- `error_code` (`'timeout'`, `'auth_error'`, `'network_error'`, `'rate_limit'`, `'unknown'`)
- `message`
- `retriable` flag
- `attempt` number

**STUB NOTE**: Current implementation is a compile-safe placeholder. Real implementation will:
1. Invoke the Anthropic SDK or direct HTTP client
2. Set timeouts via `AbortController`
3. Parse response structure
4. Implement actual audit logging to `commission_audit`

## Worker Stubs

### Arbitration Agent (`apps/worker/src/agents/arbitration.ts`)

**Entrypoint**: `executeArbitrationTask(taskId, payload, delegatedToken)`

**Payload Shape**:
```typescript
{
  "dispute_id": "<uuid>",
  "commission_record_id": "<uuid>",
  "contested_amount"?: number,        // Optional context
  "reason"?: string,                  // Optional context
  "attachments"?: string[]            // GCS paths
}
```

**Return Shape**:
```typescript
{
  "status": "success" | "error",
  "result_or_error": {
    "dispute_resolution"?: string,  // Recommended resolution
    "confidence"?: number,           // 0–1 confidence score
    "reasoning"?: string,            // Explanation from Claude
    "error"?: string                 // Error if status='error'
  }
}
```

**Validation**: `validateArbitrationPayload(payload)` — returns `true` if payload is valid.

**STUB NOTE**: Current implementation accepts valid payloads and returns a structured response. Real implementation (#186) will:
1. Fetch full dispute and commission record via API
2. Build Claude prompt from dispute details
3. Call `callClaudeAPI()` with prompt
4. Parse Claude response into structured result

### Simulation Agent (`apps/worker/src/agents/simulation.ts`)

**Entrypoint**: `executeSimulationTask(taskId, payload, delegatedToken)`

**Payload Shape**:
```typescript
{
  "deal_id": "<uuid>",
  "bonus_season_flag": boolean,
  "producer_id"?: string,  // Optional context
  "client_id"?: string     // Optional context
}
```

**Return Shape**:
```typescript
{
  "status": "success" | "error",
  "result_or_error": {
    "predicted_commission"?: number,                      // Projected amount
    "predicted_payout_schedule"?: Array<{                // Payment schedule
      "date": string,
      "amount": number
    }>,
    "risk_factors"?: string[],                            // Identified risks
    "error"?: string                                      // Error if status='error'
  }
}
```

**Validation**: `validateSimulationPayload(payload)` — returns `true` if payload is valid.

**Digital Twin Execution** (WORKER-P-007):
- Simulation **never mutates production state**
- Worker requests an isolated digital twin for the deal
- All operations happen inside the twin
- Returns predictions and diffs, not mutations
- Twin is discarded after simulation
- Promotion to live submission is a separate, explicit step

**SHIPPED** (issue #262, delivered in #267 — see the "Implemented pipeline (issue #262)" table below): the simulation agent is no longer a stub. `executeSimulationTask()` (`apps/worker/src/agents/simulation.ts`):
1. Runs inside an isolated digital twin (WORKER-P-007)
2. Builds a Claude prompt from the digital-twin payload (scenario + the producer's own plan version + fee rate)
3. Spawns the local `claude` CLI via `runClaudeCli` (`packages/db/src/claude-cli-engine.ts`) — **not** `callClaudeAPI`; the simulator uses the CLI-spawn engine
4. Parses the structured forecast `{ payout_estimate, dispute_risk, reasoning }` from stdout
5. Submits the forecast via the delegated single-use token to `POST /producer/simulations/:id/result` (no mutations to production state). On CLI timeout/error the run fails gracefully — no partial forecast is submitted

## Integration Handoff

This scout prepares infrastructure for two features:

### Dispute Arbitration Engine (#186)

**Depends on**:
- `task_queue_view_arbitration` (read task data)
- `arbitration_agent` role (DB access scoped)
- `callClaudeAPI()` (Claude integration)
- `executeArbitrationTask()` stub (entrypoint signature)
- Delegated token write path at `POST /disputes/:id/arbitration-result`

**Must implement**:
- Dispute resolution logic (Claude prompting, parsing)
- Actual call to `callClaudeAPI()` inside `executeArbitrationTask()`
- API endpoint to accept results and update dispute records
- Integration tests for dispute-specific behavior

### Producer Deal Simulation — SHIPPED (issue #262, delivered in #267)

> The simulator phase (#262) reused this scout's shared infrastructure and is now
> fully implemented. The seams below are live; see the **"Implemented pipeline
> (issue #262)"** table for exact locations and contracts. This section is kept
> for the integration history but no longer describes pending work.

**Built on**:
- `task_queue_view_simulation` (read task data)
- `simulation_agent` role (DB access scoped)
- `runClaudeCli()` (`packages/db/src/claude-cli-engine.ts`) — the CLI-spawn engine
  the simulation worker uses; **not** `callClaudeAPI` (the HTTP path is reserved
  for the arbitration worker)
- `executeSimulationTask()` (`apps/worker/src/agents/simulation.ts`) — real entrypoint
- Digital twin infrastructure (existing WORKER-P-007)
- Delegated token write path at `POST /producer/simulations/:id/result`

**Shipped behaviour**:
- `apps/server/src/api/simulations.ts` implements the producer-facing routes
  (`POST /producer/simulations/{actual,hypothetical}` enqueue a `producer_simulation`
  task, insert a `simulation_run`, mint a single-use delegated token, and return
  `202 { status: 'pending', simulation_id, job_id, result_token }`;
  `GET /producer/simulations` returns the caller's own TTL-bounded history). The
  prior 501 stubs are gone.
- `packages/core/producer-simulation.ts` defines the shared request/response types
  for the producer simulation history payloads.
- The worker/queue contract is `simulation_agent` + `producer_simulation`. The
  issue body's user-facing wording (`simulate_deal`, `role_agent_simulator`) is
  product naming over this contract.
- `executeSimulationTask()` builds a plan-context prompt, spawns the local `claude`
  CLI via `runClaudeCli`, parses `{ payout_estimate, dispute_risk, reasoning }`, and
  submits the forecast through the delegated single-use token. `simulation_run`
  rows carry a 30-day TTL and are reaped by `reapExpiredSimulationRuns`
  (`packages/db/src/simulation-run.ts`).

## Verification Checklist

### Database Views and Roles

- [ ] `task_queue_view_arbitration` selects only by `agent_type='arbitration_agent'`
- [ ] `task_queue_view_simulation` selects only by `agent_type='simulation_agent'`
- [ ] `arbitration_agent` role has SELECT on `task_queue_view_arbitration` only
- [ ] `simulation_agent` role has SELECT on `task_queue_view_simulation` only
- [ ] Both roles have no INSERT/UPDATE/DELETE/TRUNCATE (verified at startup via guard)
- [ ] Other tables are not accessible to either role

### Claude API Client

- [ ] `callClaudeAPI()` accepts `context`, `prompt`, `timeoutMs`, `maxAttempts`
- [ ] Returns `ClaudeApiResponse<T>` with `status`, `result?`, `error?`
- [ ] Timeout: 30s default, configurable
- [ ] Retry: exponential backoff (2^N), max 3 attempts
- [ ] Error codes: `'timeout'`, `'auth_error'`, `'network_error'`, `'rate_limit'`, `'unknown'`
- [ ] Errors logged to audit DB (stub: console.log for now)
- [ ] Compiles without errors

### Worker Stubs

- [ ] `executeArbitrationTask()` accepts `taskId`, `payload`, `delegatedToken`
- [ ] Returns `{ status, result_or_error }` matching schema
- [ ] `validateArbitrationPayload()` validates required fields
- [ ] `executeSimulationTask()` accepts `taskId`, `payload`, `delegatedToken`
- [ ] Returns `{ status, result_or_error }` matching schema
- [ ] `validateSimulationPayload()` validates required fields
- [ ] Both stubs compile and run without errors

### Documentation

- [ ] This file documents worker execution flow
- [ ] Payload examples provided for each job type
- [ ] Error cases documented
- [ ] Database role assignment table present
- [ ] Startup guard requirements documented

### Integration Tests

- [ ] Connect with `arbitration_agent` → can SELECT from `task_queue_view_arbitration`
- [ ] Connect with `arbitration_agent` → cannot SELECT from other views or tables
- [ ] Connect with `simulation_agent` → can SELECT from `task_queue_view_simulation`
- [ ] Connect with `simulation_agent` → cannot SELECT from other views or tables
- [ ] `callClaudeAPI()` with 100ms timeout returns `{ error: 'timeout', retriable: true }`
- [ ] `callClaudeAPI()` with invalid API key returns `{ error: 'auth_error', retriable: false }`
- [ ] `callClaudeAPI()` transient error → retries with backoff → succeeds on 2nd attempt
- [ ] `callClaudeAPI()` permanent error → logged to audit → returns `{ error, retriable: false }`
- [ ] `executeArbitrationTask()` with valid payload → returns `{ status: 'success', ... }`
- [ ] `executeSimulationTask()` with valid payload → returns `{ status: 'success', ... }`
- [ ] Worker startup with write-capable DB role → panics before main loop

## Risk / Unknowns

### Claude API Pricing & Cost

**Risk**: Arbitration and simulation may generate high volumes of Claude API calls. Costs could exceed budget without monitoring.

**Mitigation**:
- Set up CloudWatch alarms for API call volume and cost
- Implement rate limiting on task creation if needed
- Monitor actual cost during beta phase

### Context Window Fit

**Risk**: Full dispute or deal data + artifacts may exceed Claude's context window. Truncation/summarization needed.

**Mitigation**:
- Features #186 and #187 should include context-size estimation and truncation strategy
- Test with representative disputes and deals during feature development
- Document context limits and fallback behavior

### Rate Limiting & Retry Backoff

**Risk**: Claude API rate limits may cause worker retries to fail or timeout.

**Mitigation**:
- Current backoff (2^N seconds) may be too aggressive; tune in feature development
- Monitor rate-limit errors in audit logs
- Consider per-agent-type rate limiting at the API layer if needed

### Digital Twin Infrastructure

**Risk**: Simulation feature (WORKER-P-007) requires isolated digital twins that do not yet exist.

**Mitigation**:
- Digital twin infrastructure is assumed to exist or be built in #187
- If not present, feature #187 must scope it explicitly

## Producer Deal Simulator Phase Seams (dev-scout #263)

The original Arbitration & Simulation scout (#188) is frozen. The Producer Deal
Simulator phase reuses that infrastructure (task queue views, `simulation_agent`
role, delegated-token write path) and added the phase-specific seams below. These
seams are now **live** — real forecasting, `claude` CLI subprocess execution, and
result persistence were delivered by the feature pipeline (#262, shipped in #267);
see the "Implemented pipeline (issue #262)" table for the exact contracts.

### Simulation worker execution flow

```
Producer (UI)                Server API                 Task Queue            Simulation Worker
     │                            │                          │                        │
     │  POST /producer/           │                          │                        │
     │  simulations/{actual|      │                          │                        │
     │  hypothetical}             │                          │                        │
     ├───────────────────────────▶  insert simulation_run    │                        │
     │                            │  (input_params,           │                        │
     │                            │   ttl_expires_at)         │                        │
     │                            ├──────────────────────────▶ enqueue producer_       │
     │                            │  + mint single-use         simulation task          │
     │                            │    delegated token         (simulation_agent)       │
     │                            │                          ◀────────── claim ─────────┤
     │                            │                          │  read via                │
     │                            │                          │  task_queue_view_        │
     │                            │                          │  simulation              │
     │                            │                          │                          │
     │                            │             executeSimulationTask(taskId, payload,  │
     │                            │             delegatedToken) — runs inside a digital │
     │                            │             twin (WORKER-P-007); calls the engine    │
     │                            │                          │   ┌──────────────────┐   │
     │                            │                          │   │ runClaudeCli     │   │
     │                            │                          │   │ (spawns `claude` │   │
     │                            │                          │   │  CLI, Bun.spawn) │   │
     │                            │                          │   └──────────────────┘   │
     │                            │  POST /producer/          │                          │
     │                            │  simulations/:id/result  ◀──── submit forecast ──────┤
     │                            │  (delegated token, no     │   via delegated token     │
     │                            │   session cookie)         │                          │
     │                            │  validate + persist        │                          │
     │                            │  result_json + invalidate  │                          │
     │                            │  token                     │                          │
     │  GET /producer/simulations │                          │                          │
     ◀────────────────────────────  read own simulation_run   │                          │
     │  history (result_json)     │  rows (TTL-bounded)        │                          │
```

The TTL reaper (`reapExpiredSimulationRuns`, `packages/db/src/simulation-run.ts`)
deletes `simulation_run` rows past `ttl_expires_at` on a recurring tick;
forecasts are ephemeral by design.

### Implemented pipeline (issue #262)

The seams reserved by the scout (#263) are now live:

| Component | Location | Contract |
|---|---|---|
| `simulation_run` table | `packages/db/schema.sql` | `id, producer_id, org_id, job_id, input_params, result_json, created_at, ttl_expires_at` |
| Persistence + TTL | `packages/db/src/simulation-run.ts` | `insertSimulationRun` (30-day TTL), `setSimulationRunResult` (org-scoped), `listSimulationRunsByProducer`, `reapExpiredSimulationRuns` (idempotent DELETE keyed on `ttl_expires_at`) |
| Claude CLI engine | `packages/db/src/claude-cli-engine.ts` → `runClaudeCli()` | Spawns the local `claude` CLI (`-p` print mode) via `Bun.spawn`, bounded by `timeoutMs` (default 60s); `parse(stdout)→T`. Maps every outcome to a structured error (`timeout`/`spawn_error`/`nonzero_exit`/`parse_error`); never throws. Subprocess is injectable (`request.spawn`) for hermetic tests |
| Worker entrypoint | `apps/worker/src/agents/simulation.ts` → `executeSimulationTask()` | Builds a prompt from the digital-twin payload (scenario + the producer's own plan version + fee rate), runs `runClaudeCli`, parses `{ payout_estimate, dispute_risk, reasoning }`. Graceful failure on CLI timeout/error → no partial forecast submitted |
| Worker dispatch | `apps/worker/src/index.ts` | For `agent_type = 'simulation_agent'`, submits the forecast to `POST /producer/simulations/:id/result` using the per-simulation single-use token embedded in the task payload |
| Producer RBAC | `packages/core/auth.ts` | `GET` + `POST /producer/simulations` so the Producer role is no longer 403 |
| Request routes | `apps/server/src/api/simulations.ts` | `POST /producer/simulations/{actual,hypothetical}` enqueue a `producer_simulation` task (producer-scope: 403 on another producer's `deal_id`), insert a `simulation_run`, mint a single-use delegated token, return a `202 { status: 'pending', simulation_id, job_id, result_token }`. `GET /producer/simulations` returns the caller's own history |
| Delegated-result route | `apps/server/src/api/simulations.ts` → `handleSubmitSimulationResult()` | `POST /producer/simulations/:id/result` — worker write path (Bearer delegated token, no session cookie), wired before `requireAuth` in `apps/server/src/index.ts`. Validates the single-use token bound to the `simulation_run`, persists `result_json`, and writes an `AuditLogEntry` (action `simulation.completed`, correlation id in `after_json`) |

### Claude-CLI engine seam vs. callClaudeAPI

Two engine seams exist; the simulator (#262) selected the CLI-spawn engine:

- **`callClaudeAPI`** (`claude-api-client.ts`, #188) — HTTP/SDK path for short
  structured prompts, reserved for the arbitration worker. Timeout via
  `AbortController`, exponential-backoff retry.
- **`runClaudeCli`** (`claude-cli-engine.ts`, #263; shipped in #267) — the
  simulation engine. It spawns the local `claude` CLI (`-p` print mode) as a
  subprocess via `Bun.spawn`, so the digital-twin forecasting step reuses the
  operator's local agent toolchain. The subprocess **is** executed in production;
  spawn is injectable (`request.spawn`) only so unit tests stay hermetic. Contract:
  `timeoutMs` (default 60s) aborts the subprocess (→ `error.code 'timeout'`), and
  `parse(stdout)` failures surface as `error.code 'parse_error'` (every outcome maps
  to a structured error — `timeout`/`spawn_error`/`nonzero_exit`/`parse_error` — never a throw).

### Resolved decisions / operational notes (Producer Deal Simulator)

- **Engine selection (resolved)** — #262 chose `runClaudeCli` (CLI subprocess) over
  `callClaudeAPI` (HTTP) so the simulation worker reuses the operator's local
  toolchain/MCP. This makes `vendor-cli-data-exfiltration` an active threat for the
  simulation worker (mitigated by the bounded subprocess timeout, no tool/permission
  flags passed to the CLI, and the delegated single-use result token).
- **`simulation_run` retention / TTL** — `insertSimulationRun` sets a 30-day TTL;
  high-volume what-if usage may warrant a shorter TTL or a per-producer cap. The
  reaper `reapExpiredSimulationRuns` is an idempotent DELETE keyed on `ttl_expires_at`.
- **Delegated-token result path** — `POST /producer/simulations/:id/result` is wired
  before `requireAuth`/CSRF like the worker `/tasks/:id/result` route;
  `handleSubmitSimulationResult` validates the single-use token bound to the
  originating `simulation_run` row, persists `result_json`, and invalidates the
  token on first use.
- **Digital-twin isolation** — `executeSimulationTask` runs in an isolated twin
  (WORKER-P-007); the twin substrate is the existing #188 infrastructure.

## See Also

- `docs/architecture.md` — Overall system architecture, WORKER-P-007 digital twins
- `blueprint/rules/blueprints/worker.yaml` — Worker constraints and threat model
- `blueprint/rules/blueprints/task-queue.yaml` — Task queue design patterns
- Issue #186 — Dispute Arbitration Engine (feature implementation)
- Issue #187 — Producer Deal Simulation (feature implementation)

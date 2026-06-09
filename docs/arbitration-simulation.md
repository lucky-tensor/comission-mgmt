# Arbitration & Simulation Worker Infrastructure

> Scout implementation for Dispute Arbitration Engine (#186) and Producer Deal Simulation (#187).
> Establishes shared infrastructure: task queue views, database roles, Claude API client, and worker stubs.

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

**STUB NOTE**: Current implementation accepts valid payloads and returns a structured response. Real implementation (#187) will:
1. Request a digital twin environment
2. Fetch deal and producer data via API
3. Build Claude prompt from deal context
4. Call `callClaudeAPI()` with prompt
5. Parse Claude response into predicted outcomes
6. Return predictions (no mutations)

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

### Producer Deal Simulation (#187)

**Depends on**:
- `task_queue_view_simulation` (read task data)
- `simulation_agent` role (DB access scoped)
- `callClaudeAPI()` (Claude integration)
- `executeSimulationTask()` stub (entrypoint signature)
- Digital twin infrastructure (existing WORKER-P-007)
- Delegated token write path at `POST /producer/simulations/:id/result`

**Must implement**:
- Deal simulation logic (Claude prompting, parsing, digital twin interaction)
- Actual call to `callClaudeAPI()` inside `executeSimulationTask()`
- API endpoint to accept predictions and create simulation records
- Integration tests for simulation-specific behavior

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

## See Also

- `docs/architecture.md` — Overall system architecture, WORKER-P-007 digital twins
- `blueprint/rules/blueprints/worker.yaml` — Worker constraints and threat model
- `blueprint/rules/blueprints/task-queue.yaml` — Task queue design patterns
- Issue #186 — Dispute Arbitration Engine (feature implementation)
- Issue #187 — Producer Deal Simulation (feature implementation)

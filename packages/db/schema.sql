-- Commission Management PostgreSQL Schema
-- Phase 1 Foundation — bootstrapped from template + smart-crm
-- Three-DB posture: app / audit / analytics (this file covers app DB)

-- Revoked tokens (JWT invalidation on logout)
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Task queue: single-table queue for commission management agent types.
-- delegated_token stores the single-use JWT issued at task creation.
-- Agent types: commission-calculator, invoice-generator, partner-notifier, dispute-escalator
-- Canonical: docs/architecture.md — Phase 1 task-queue foundation
CREATE TABLE IF NOT EXISTS task_queue (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    idempotency_key TEXT UNIQUE NOT NULL,
    agent_type TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','claimed','running','submitting','completed','failed','dead')),
    payload JSONB NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    correlation_id TEXT,
    claimed_by TEXT,
    claimed_at TIMESTAMP WITH TIME ZONE,
    claim_expires_at TIMESTAMP WITH TIME ZONE,
    delegated_token TEXT,
    result JSONB,
    error_message TEXT,
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    priority INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_queue_poll
    ON task_queue (agent_type, status, priority, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_task_queue_stale
    ON task_queue (status, claim_expires_at)
    WHERE status = 'claimed';

CREATE INDEX IF NOT EXISTS idx_task_queue_idempotency
    ON task_queue (idempotency_key);

-- Worker tokens: scoped single-use tokens for commission task workers.
-- task_id references the task_queue.id this token was issued for.
-- Canonical: docs/architecture.md — Phase 1 worker token security
CREATE TABLE IF NOT EXISTS worker_tokens (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    pod_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    task_id TEXT NOT NULL,
    jti TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_tokens_jti ON worker_tokens (jti);
CREATE INDEX IF NOT EXISTS idx_worker_tokens_pod ON worker_tokens (pod_id) WHERE consumed_at IS NULL AND invalidated_at IS NULL;

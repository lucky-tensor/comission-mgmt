-- Commission Management PostgreSQL Schema
-- Phase 1 Foundation — bootstrapped from template + smart-crm
-- Three-DB posture: app / audit / analytics (this file covers app DB)

-- Revoked tokens (JWT invalidation on logout)
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- =============================================================================
-- Authentication: Users, Org Memberships, and Passkey Credentials
-- WebAuthn/FIDO2 passkey-first authentication (no passwords).
-- Canonical: docs/architecture.md — Phase 1 Foundation, WebAuthn Auth
-- =============================================================================

-- Organisations: top-level multi-tenant isolation boundary.
CREATE TABLE IF NOT EXISTS orgs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users: platform-level user accounts (cross-org identity).
CREATE TABLE IF NOT EXISTS users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL UNIQUE,
  display_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Org memberships: maps users to orgs with a role assignment.
-- A user may belong to multiple orgs with different roles.
CREATE TABLE IF NOT EXISTS org_memberships (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON org_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON org_memberships (org_id);

-- Passkey credentials: WebAuthn/FIDO2 credential storage per user.
-- credential_id is the base64url-encoded credential ID from the authenticator.
-- public_key is the COSE-encoded public key bytes stored as BYTEA.
CREATE TABLE IF NOT EXISTS passkey_credentials (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT        NOT NULL UNIQUE,
  public_key    BYTEA       NOT NULL,
  sign_count    BIGINT      NOT NULL DEFAULT 0,
  transports    TEXT[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user ON passkey_credentials (user_id);
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_cred_id ON passkey_credentials (credential_id);

-- WebAuthn challenges: short-lived challenges for registration and assertion.
-- Challenges are single-use and expire after 5 minutes.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge   TEXT        NOT NULL UNIQUE,
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  flow        TEXT        NOT NULL CHECK (flow IN ('registration', 'assertion')),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges (challenge);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges (expires_at);

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

-- =============================================================================
-- Task Queue: agent_rw DB role and claimable task view
--
-- The agent_rw role is the DB identity used by worker containers.
-- Workers connect only to read claimable tasks — all mutations go through
-- the application API using single-use delegated credentials.
--
-- Security constraints (WORKER-X-001):
--   - agent_rw has NO access to domain tables (placements, commission_records, etc.)
--   - agent_rw can SELECT only from the claimable_tasks view
--   - The view exposes only the columns needed for the claim-execute loop
-- =============================================================================

-- Create the agent_rw role if it does not exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_rw') THEN
    CREATE ROLE agent_rw NOLOGIN;
  END IF;
END$$;

-- Claimable tasks view: exposes only pending tasks for the agent_rw role.
-- Workers read from this view to discover available tasks; the actual
-- claim UPDATE is performed by the application server on behalf of the worker.
CREATE OR REPLACE VIEW claimable_tasks AS
  SELECT
    id,
    agent_type,
    job_type,
    status,
    priority,
    created_at,
    next_retry_at
  FROM task_queue
  WHERE status = 'pending'
    AND (next_retry_at IS NULL OR next_retry_at <= NOW());

-- Grant agent_rw SELECT on the claimable_tasks view only.
-- No access to any domain table is granted.
GRANT SELECT ON claimable_tasks TO agent_rw;

-- =============================================================================
-- Encryption Key Registry
-- Maps entity_type + field_name → KMS key ID used to wrap the DEK for that field.
-- FieldEncryptor consults this table to determine which KMS key to use when
-- wrapping/unwrapping a data encryption key.
-- Architecture: docs/architecture/decisions.md — Field Encryption Registry
-- =============================================================================

CREATE TABLE IF NOT EXISTS encryption_key_registry (
  entity_type  TEXT NOT NULL,
  field_name   TEXT NOT NULL,
  kms_key_id   TEXT NOT NULL,
  PRIMARY KEY (entity_type, field_name)
);

-- =============================================================================
-- Commission Domain: Lifecycle State Enums
-- Matches PRD §6 exactly.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE placement_state AS ENUM (
    'Created',
    'ContributorsAssigned',
    'PendingApproval',
    'Active',
    'Invoiced',
    'Collected',
    'GuaranteeActive',
    'GuaranteeExpired',
    'Closed',
    'Refunded',
    'Disputed',
    'ClawbackTriggered'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE commission_state AS ENUM (
    'Accrued',
    'PendingApproval',
    'Approved',
    'Held',
    'Payable',
    'Paid',
    'ClawbackInitiated',
    'Recovered'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_state AS ENUM (
    'Issued',
    'PartiallyPaid',
    'Paid',
    'Disputed',
    'WrittenOff',
    'CreditMemoApplied'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE guarantee_state AS ENUM (
    'Active',
    'ExpiredClean',
    'Triggered',
    'ClawbackApplied'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE draw_state AS ENUM (
    'Active',
    'PartiallyRecovered',
    'FullyRecovered',
    'Forgiven'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE exception_state AS ENUM (
    'Requested',
    'UnderReview',
    'Approved',
    'Rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE plan_version_state AS ENUM (
    'Draft',
    'Active',
    'Superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- Commission Domain: Core Relational Tables
-- All tables carry org_id UUID NOT NULL for multi-tenancy.
-- Encrypted columns stored as BYTEA (AES-256-GCM via FieldEncryptor).
-- Architecture: docs/architecture/decisions.md — ER Diagram, Field Encryption Registry
-- =============================================================================

-- Placements: the canonical record for each direct-hire/retained search engagement.
CREATE TABLE IF NOT EXISTS placements (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL,
  ats_placement_id  TEXT,
  candidate_id      UUID        NOT NULL,
  client_entity_id  UUID        NOT NULL,
  job_title         TEXT        NOT NULL,
  start_date        DATE,
  status            placement_state NOT NULL DEFAULT 'Created',
  fee_amount        BYTEA       NOT NULL,
  compensation_base BYTEA       NOT NULL,
  guarantee_days    INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_placements_org ON placements (org_id);
CREATE INDEX IF NOT EXISTS idx_placements_status ON placements (org_id, status);

-- Contributors: participants credited on a placement (bd, owner, sourcer, researcher, etc.)
CREATE TABLE IF NOT EXISTS contributors (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  placement_id     UUID        NOT NULL REFERENCES placements(id),
  producer_id      UUID        NOT NULL,
  role_code        TEXT        NOT NULL,
  split_pct        NUMERIC(5,4) NOT NULL,
  split_override   BOOLEAN     NOT NULL DEFAULT false,
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contributors_org ON contributors (org_id);
CREATE INDEX IF NOT EXISTS idx_contributors_placement ON contributors (placement_id);

-- Contribution splits: granular split breakdown per contributor (supports multi-split models).
CREATE TABLE IF NOT EXISTS contribution_splits (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  contributor_id   UUID        NOT NULL REFERENCES contributors(id),
  split_type       TEXT        NOT NULL,
  split_pct        NUMERIC(5,4) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contribution_splits_org ON contribution_splits (org_id);
CREATE INDEX IF NOT EXISTS idx_contribution_splits_contributor ON contribution_splits (contributor_id);

-- Commission plans: named plan definitions (each with one or more versioned rule sets).
CREATE TABLE IF NOT EXISTS commission_plans (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  name             TEXT        NOT NULL,
  effective_from   DATE        NOT NULL,
  effective_to     DATE,
  config_entity_id UUID        NOT NULL,
  created_by       UUID        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_plans_org ON commission_plans (org_id);

-- Plan versions: immutable snapshots of commission plan rules.
CREATE TABLE IF NOT EXISTS plan_versions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  plan_id          UUID        NOT NULL REFERENCES commission_plans(id),
  version_num      INT         NOT NULL,
  status           plan_version_state NOT NULL DEFAULT 'Draft',
  rules_snapshot   JSONB       NOT NULL,
  acknowledged_by  UUID[]      NOT NULL DEFAULT '{}',
  effective_at     TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_plan_versions_org ON plan_versions (org_id);
CREATE INDEX IF NOT EXISTS idx_plan_versions_plan ON plan_versions (plan_id);

-- Plan assignments: which producers are on which plan version.
CREATE TABLE IF NOT EXISTS plan_assignments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  plan_version_id  UUID        NOT NULL REFERENCES plan_versions(id),
  producer_id      UUID        NOT NULL,
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ,
  UNIQUE (plan_version_id, producer_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_assignments_org ON plan_assignments (org_id);
CREATE INDEX IF NOT EXISTS idx_plan_assignments_producer ON plan_assignments (producer_id);

-- Commission records: the calculated commission amount per contributor per placement.
CREATE TABLE IF NOT EXISTS commission_records (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  placement_id     UUID        NOT NULL REFERENCES placements(id),
  contributor_id   UUID        NOT NULL REFERENCES contributors(id),
  plan_version_id  UUID        NOT NULL REFERENCES plan_versions(id),
  gross_amount     BYTEA       NOT NULL,
  net_payable      BYTEA       NOT NULL,
  tier_rate        NUMERIC(5,4),
  status           commission_state NOT NULL DEFAULT 'Accrued',
  approval_actor   UUID,
  approval_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_records_org ON commission_records (org_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_placement ON commission_records (placement_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_contributor ON commission_records (contributor_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_status ON commission_records (org_id, status);

-- Invoices: billed amounts sent to clients for placements.
CREATE TABLE IF NOT EXISTS invoices (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  placement_id     UUID        NOT NULL REFERENCES placements(id),
  invoice_number   TEXT        NOT NULL,
  amount_billed    BYTEA       NOT NULL,
  amount_collected BYTEA,
  status           invoice_state NOT NULL DEFAULT 'Issued',
  issued_at        TIMESTAMPTZ NOT NULL,
  due_at           TIMESTAMPTZ,
  collected_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices (org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_placement ON invoices (placement_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (org_id, status);

-- Guarantee periods: risk windows after placement start.
CREATE TABLE IF NOT EXISTS guarantee_periods (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  placement_id     UUID        NOT NULL REFERENCES placements(id),
  guarantee_ends   DATE        NOT NULL,
  status           guarantee_state NOT NULL DEFAULT 'Active',
  risk_amount      BYTEA       NOT NULL,
  triggered_at     TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  resolution       TEXT
);

CREATE INDEX IF NOT EXISTS idx_guarantee_periods_org ON guarantee_periods (org_id);
CREATE INDEX IF NOT EXISTS idx_guarantee_periods_placement ON guarantee_periods (placement_id);

-- Draw balances: outstanding draw advances against future commissions.
CREATE TABLE IF NOT EXISTS draw_balances (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  producer_id      UUID        NOT NULL,
  balance          BYTEA       NOT NULL,
  draw_limit       BYTEA       NOT NULL,
  status           draw_state  NOT NULL DEFAULT 'Active',
  recovery_start   DATE,
  recovery_end     DATE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_draw_balances_org ON draw_balances (org_id);
CREATE INDEX IF NOT EXISTS idx_draw_balances_producer ON draw_balances (producer_id);

-- Exceptions: requested overrides to split percentages, rates, or clawback waivers.
CREATE TABLE IF NOT EXISTS exceptions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  placement_id     UUID        NOT NULL REFERENCES placements(id),
  requested_by     UUID        NOT NULL,
  exception_type   TEXT        NOT NULL,
  justification    TEXT        NOT NULL,
  status           exception_state NOT NULL DEFAULT 'Requested',
  reviewed_by      UUID,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exceptions_org ON exceptions (org_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_placement ON exceptions (placement_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_status ON exceptions (org_id, status);

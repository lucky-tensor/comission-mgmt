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
-- Task Queue access model
--
-- Workers hold NO database identity. There is intentionally no `agent_rw` role
-- and no `claimable_tasks` view: granting the worker any DB reach — even
-- read-only — is the prohibited WORKER pattern (WORKER-X-009, WORKER-P-008).
-- Workers discover, claim, and submit tasks exclusively through the application
-- API using single-use, task-scoped delegated tokens. The application server
-- performs all task_queue reads and the claim UPDATE on the worker's behalf.
--
-- Phase: Arbitration & Simulation (dev-scout #188)
-- ═════════════════════════════════════════════════════════════════════════
-- Task queue views for arbitration and simulation agents.
-- These views expose only the columns needed for workers to decide whether to
-- claim a task (id, job_type, status, payload, correlation_id, priority, created_at,
-- attempt, max_attempts). Sensitive columns (delegated_token, created_by, result,
-- error_message) are excluded — workers receive delegated tokens only through the
-- API claim response.
--
-- Canonical: docs/arbitration-simulation.md (scout #188)
-- =============================================================================

-- Task queue view for arbitration agent type.
-- Filters tasks by agent_type='arbitration_agent' and shows non-sensitive columns.
DROP VIEW IF EXISTS task_queue_view_arbitration;
CREATE VIEW task_queue_view_arbitration AS
  SELECT
    id,
    job_type,
    status,
    payload,
    correlation_id,
    priority,
    created_at,
    attempt,
    max_attempts
  FROM task_queue
  WHERE agent_type = 'arbitration_agent';

-- Task queue view for simulation agent type.
-- Filters tasks by agent_type='simulation_agent' and shows non-sensitive columns.
DROP VIEW IF EXISTS task_queue_view_simulation;
CREATE VIEW task_queue_view_simulation AS
  SELECT
    id,
    job_type,
    status,
    payload,
    correlation_id,
    priority,
    created_at,
    attempt,
    max_attempts
  FROM task_queue
  WHERE agent_type = 'simulation_agent';

-- =============================================================================
-- Database Roles for Agent Types
--
-- Per WORKER-P-001 (read-only-database-access) and WORKER-D-007 (per-agent-type
-- database role), agents are issued database credentials scoped to their type.
-- Roles are read-only to task-queue views; all writes are delegated to the API
-- layer using single-use, task-scoped tokens (WORKER-P-002, WORKER-P-006).
--
-- Startup guard (IMPL-TQ-RS-006): each agent-type role has SELECT-only, no INSERT,
-- UPDATE, DELETE, or TRUNCATE. A worker started with a write-capable role panics
-- before the main loop.
--
-- Canonical: docs/arbitration-simulation.md, database role assignment table (scout #188)
-- =============================================================================

-- Arbitration agent role: SELECT on arbitration task queue view + delegated token write path.
-- The delegated token write path refers to the POST endpoints that accept the single-use
-- token and write results (e.g., POST /disputes/:id/arbitration-result).
-- Roles start with no permissions; we explicitly grant SELECT on views.
DO $$ BEGIN
  CREATE ROLE arbitration_agent WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN DUPLICATE_OBJECT THEN NULL;
END $$;

-- Grant SELECT on arbitration task queue view (read task data only).
GRANT SELECT ON task_queue_view_arbitration TO arbitration_agent;

-- Simulation agent role: SELECT on simulation task queue view + delegated token write path.
DO $$ BEGIN
  CREATE ROLE simulation_agent WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN DUPLICATE_OBJECT THEN NULL;
END $$;

-- Grant SELECT on simulation task queue view (read task data only).
GRANT SELECT ON task_queue_view_simulation TO simulation_agent;

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

-- Plan acknowledgments: durable, audited records of producer acceptance of a plan version.
-- Immutable once created (idempotent per producer+plan_version_id — unique constraint).
-- Canonical docs: docs/prd.md §4 (HR / People Ops)
-- Issue: feat: commission plan acknowledgment (#123)
CREATE TABLE IF NOT EXISTS plan_acknowledgments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  plan_version_id  UUID        NOT NULL REFERENCES plan_versions(id),
  producer_id      UUID        NOT NULL,
  acknowledged_by  UUID        NOT NULL,
  acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_version_id, producer_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_acknowledgments_org ON plan_acknowledgments (org_id);
CREATE INDEX IF NOT EXISTS idx_plan_acknowledgments_producer ON plan_acknowledgments (producer_id);
CREATE INDEX IF NOT EXISTS idx_plan_acknowledgments_version ON plan_acknowledgments (plan_version_id);

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

-- Plain-language explanation for each commission record (issue #11: explainability).
-- Nullable so existing rows without an explanation remain valid.
ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS explanation TEXT;

-- Hold reason for commission_records with status=Held (issue #12: invoice and collection tracking).
-- Values: 'collection_gate' | 'guarantee_hold' | NULL (for non-Held records).
ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS hold_reason TEXT;

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_org_number ON invoices (org_id, invoice_number);
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

-- Exception workflow additional columns (issue #14: exception request and approval workflow).
-- commission_record_id: optional link to the affected CommissionRecord.
-- impact_amount: Finance Admin-entered monetary impact of the exception.
-- rejection_reason: reason supplied when Finance Admin rejects the request.
-- attachment_url: URL/key to uploaded supporting documentation.
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS commission_record_id UUID REFERENCES commission_records(id);
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS impact_amount NUMERIC(15,2);
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- =============================================================================
-- Attribution Events: immutable timeline of contribution assignment lifecycle events.
-- Records submit, approve, and reject events for the manager split-approval workflow.
-- Canonical: docs/prd.md §5.2, issue #8 feat: manager split approval workflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS attribution_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  placement_id     UUID        NOT NULL REFERENCES placements(id),
  event_type       TEXT        NOT NULL
                   CHECK (event_type IN ('Submitted', 'Approved', 'Rejected')),
  actor_id         UUID        NOT NULL,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attribution_events_org ON attribution_events (org_id);
CREATE INDEX IF NOT EXISTS idx_attribution_events_placement ON attribution_events (placement_id);
CREATE INDEX IF NOT EXISTS idx_attribution_events_created ON attribution_events (placement_id, created_at);

-- =============================================================================
-- Commission Runs: Finance Admin commission close workflow.
-- A run groups placements for a period, pre-flight checks completeness,
-- and gates final approval until all included records are individually approved.
-- Canonical: docs/prd.md §5.4, §9 — Finance Close Workflow
-- Issue: feat: finance admin commission run and review queue (#13)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE commission_run_state AS ENUM (
    'Open',
    'Approved',
    'Cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- commission_runs: one row per Finance Admin commission close batch.
CREATE TABLE IF NOT EXISTS commission_runs (
  id               UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID                  NOT NULL,
  period_start     DATE                  NOT NULL,
  period_end       DATE                  NOT NULL,
  status           commission_run_state  NOT NULL DEFAULT 'Open',
  created_by       UUID                  NOT NULL,
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_runs_org ON commission_runs (org_id);
CREATE INDEX IF NOT EXISTS idx_commission_runs_status ON commission_runs (org_id, status);

-- commission_run_records: links a commission_run to the individual commission_records it governs.
-- Each record may be individually approved; the run may only be fully approved once all
-- linked records are approved.
CREATE TABLE IF NOT EXISTS commission_run_records (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  run_id           UUID        NOT NULL REFERENCES commission_runs(id) ON DELETE CASCADE,
  commission_record_id UUID    NOT NULL REFERENCES commission_records(id),
  individually_approved    BOOLEAN     NOT NULL DEFAULT false,
  individually_approved_by UUID,
  individually_approved_at TIMESTAMPTZ,
  UNIQUE (run_id, commission_record_id)
);

CREATE INDEX IF NOT EXISTS idx_commission_run_records_run ON commission_run_records (run_id);
CREATE INDEX IF NOT EXISTS idx_commission_run_records_org ON commission_run_records (org_id);

-- =============================================================================
-- Payroll Export Artifacts: immutable export files generated from Approved runs.
-- Each export is a downloadable CSV artifact linked to a commission run.
-- Re-requesting an export for the same run returns the existing artifact (idempotent).
-- Canonical: docs/prd.md §5.7 — Commission Close and Payroll Export
-- Issue: feat: payroll-ready export from approved commission run (#15)
-- =============================================================================

CREATE TABLE IF NOT EXISTS payroll_export_artifacts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  run_id           UUID        NOT NULL REFERENCES commission_runs(id) ON DELETE CASCADE,
  format           TEXT        NOT NULL DEFAULT 'csv'
                   CHECK (format IN ('csv')),
  -- CSV content stored inline (MVP); large exports can be moved to object storage later.
  content          TEXT        NOT NULL,
  row_count        INTEGER     NOT NULL,
  created_by       UUID        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_export_artifacts_org ON payroll_export_artifacts (org_id);
CREATE INDEX IF NOT EXISTS idx_payroll_export_artifacts_run ON payroll_export_artifacts (run_id);

-- =============================================================================
-- Billing Phases: named phases for retained search placements (issue #63).
--
-- Retained search placements carry two named billing phases — retainer and
-- delivery — each with its own invoice linkage, projected/billed/received
-- amounts, per-phase contributor-credit assignments, and commission lifecycle.
-- Collection gating is phase-scoped: a paid retainer invoice releases only
-- retainer-phase commission; delivery-phase commission remains Held until the
-- delivery invoice is paid independently.
--
-- Property-graph registry: billing_phase is registered as an entity_type in
-- the encryption_key_registry with kms_key_id metadata (projected_amount,
-- billed_amount, received_amount are BYTEA).
--
-- Canonical: docs/prd.md §5.1, §5.5, docs/architecture.md §4
-- Issue: feat: retained search billing phases (#63)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE billing_phase_name AS ENUM (
    'retainer',
    'delivery'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- billing_phases: one row per named phase on a retained-search placement.
-- Each phase may link to one invoice, track projected/billed/received amounts,
-- and carry its own commission lifecycle independently of other phases.
CREATE TABLE IF NOT EXISTS billing_phases (
  id               UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID              NOT NULL,
  placement_id     UUID              NOT NULL REFERENCES placements(id),
  phase_name       billing_phase_name NOT NULL,
  -- Invoice linked to this phase (nullable until invoiced).
  invoice_id       UUID              REFERENCES invoices(id),
  -- Monetary columns stored as BYTEA (AES-256-GCM via FieldEncryptor).
  projected_amount BYTEA             NOT NULL,
  billed_amount    BYTEA,
  received_amount  BYTEA,
  created_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  UNIQUE (placement_id, phase_name)
);

CREATE INDEX IF NOT EXISTS idx_billing_phases_org ON billing_phases (org_id);
CREATE INDEX IF NOT EXISTS idx_billing_phases_placement ON billing_phases (placement_id);

-- Property-graph registry entry for billing_phase (architecture §4).
-- kms_key_id metadata tells FieldEncryptor which KMS key to use for each
-- BYTEA column on this entity type.
INSERT INTO encryption_key_registry (entity_type, field_name, kms_key_id)
VALUES
  ('billing_phases', 'projected_amount', 'billing_phases_amounts_key'),
  ('billing_phases', 'billed_amount',    'billing_phases_amounts_key'),
  ('billing_phases', 'received_amount',  'billing_phases_amounts_key')
ON CONFLICT (entity_type, field_name) DO NOTHING;

-- phase_contributors: per-phase contributor-credit assignments.
-- A contributor may be credited on one or both phases independently.
-- When a contributor has no phase_contributors row for a given phase,
-- they accrue zero commission on that phase.
CREATE TABLE IF NOT EXISTS phase_contributors (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  billing_phase_id UUID        NOT NULL REFERENCES billing_phases(id),
  contributor_id   UUID        NOT NULL REFERENCES contributors(id),
  split_pct        NUMERIC(5,4) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (billing_phase_id, contributor_id)
);

CREATE INDEX IF NOT EXISTS idx_phase_contributors_org ON phase_contributors (org_id);
CREATE INDEX IF NOT EXISTS idx_phase_contributors_phase ON phase_contributors (billing_phase_id);
CREATE INDEX IF NOT EXISTS idx_phase_contributors_contributor ON phase_contributors (contributor_id);

-- billing_phase_id on commission_records: links a record to the phase it was
-- calculated for. NULL for non-retained (contingency) placements — no change
-- to existing contingency flow.
ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS billing_phase_id UUID REFERENCES billing_phases(id);
CREATE INDEX IF NOT EXISTS idx_commission_records_phase ON commission_records (billing_phase_id) WHERE billing_phase_id IS NOT NULL;

-- Update hold_reason to include the phase-level variant.
-- Values: 'collection_gate' | 'guarantee_hold' | 'held_pending_phase_invoice' | NULL
-- The existing 'collection_gate' value remains for contingency placements.
-- 'held_pending_phase_invoice' is used when the invoice linked to a specific
-- billing phase has not yet been marked Paid.
-- (No DDL change required — hold_reason is TEXT with no constraint.)

-- =============================================================================
-- Commission Journal: relational append-only journal for phase-level transitions.
--
-- Every Held→Released commission transition (triggered by phase invoice payment)
-- writes an immutable journal entry with billing_phase_id, from_status, to_status,
-- triggering invoice ID, and the actor who triggered the transition.
-- Used for audit, reconciliation, and replay.
--
-- Canonical: docs/architecture.md §4 (relational journal)
-- Issue: feat: retained search billing phases (#63)
-- =============================================================================

CREATE TABLE IF NOT EXISTS commission_journal (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL,
  commission_record_id UUID     NOT NULL REFERENCES commission_records(id),
  billing_phase_id  UUID        REFERENCES billing_phases(id),
  from_status       TEXT        NOT NULL,
  to_status         TEXT        NOT NULL,
  trigger_invoice_id UUID       REFERENCES invoices(id),
  actor_id          UUID,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_journal_org ON commission_journal (org_id);
CREATE INDEX IF NOT EXISTS idx_commission_journal_record ON commission_journal (commission_record_id);
CREATE INDEX IF NOT EXISTS idx_commission_journal_phase ON commission_journal (billing_phase_id) WHERE billing_phase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commission_journal_created ON commission_journal (created_at);

-- =============================================================================
-- Financial Reconciliation: ledger vs financial system (AR) cross-check.
-- Finance Admins generate a reconciliation report for a period. Discrepancies
-- are surfaced and must be acknowledged before a commission run can be finalized.
-- Canonical: docs/prd.md §5.8
-- Issue: feat: financial reconciliation report — ledger vs financial system cross-check (#65)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE discrepancy_type AS ENUM (
    'ledger_only',
    'system_only',
    'amount_mismatch',
    'date_gap'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ar_ingested_records: AR data ingested from the financial system for reconciliation.
-- This table holds the system-of-record amounts to compare against ledger invoices.
CREATE TABLE IF NOT EXISTS ar_ingested_records (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  invoice_number   TEXT        NOT NULL,
  amount_billed    NUMERIC(15,2) NOT NULL,
  amount_collected NUMERIC(15,2),
  billed_date      DATE        NOT NULL,
  collected_date   DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_ingested_org_number ON ar_ingested_records (org_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_ar_ingested_org ON ar_ingested_records (org_id);
CREATE INDEX IF NOT EXISTS idx_ar_ingested_billed_date ON ar_ingested_records (org_id, billed_date);

-- reconciliation_discrepancies: one row per discovered discrepancy between ledger and AR.
-- Finance Admins acknowledge discrepancies to allow commission run finalization.
CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
  id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID             NOT NULL,
  period_start         DATE             NOT NULL,
  period_end           DATE             NOT NULL,
  discrepancy_type     discrepancy_type NOT NULL,
  invoice_id           UUID             REFERENCES invoices(id),
  invoice_number       TEXT,
  ledger_amount_billed NUMERIC(15,2),
  ar_amount_billed     NUMERIC(15,2),
  ledger_issued_at     DATE,
  ar_billed_date       DATE,
  date_gap_days        INTEGER,
  acknowledged         BOOLEAN          NOT NULL DEFAULT false,
  acknowledged_by      UUID,
  acknowledged_at      TIMESTAMPTZ,
  acknowledged_note    TEXT,
  created_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_discrepancies_org ON reconciliation_discrepancies (org_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_discrepancies_period ON reconciliation_discrepancies (org_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_reconciliation_discrepancies_ack ON reconciliation_discrepancies (org_id, acknowledged);

-- =============================================================================
-- Disputes: Producer-submitted payout disputes and questions.
-- Producers link a dispute to a specific CommissionRecord. Finance Admins review
-- and resolve disputes, optionally linking to a resulting exception or adjustment.
-- State lifecycle: Submitted → UnderReview → Resolved
-- Canonical: docs/prd.md §5.8, §4 — Producer user stories
-- Issue: feat: payout dispute and question submission (#18)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE dispute_state AS ENUM (
    'Submitted',
    'UnderReview',
    'Resolved'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS disputes (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID          NOT NULL,
  commission_record_id UUID          NOT NULL REFERENCES commission_records(id),
  submitted_by         UUID          NOT NULL,
  description          TEXT          NOT NULL,
  state                dispute_state NOT NULL DEFAULT 'Submitted',
  resolved_by          UUID,
  resolved_at          TIMESTAMPTZ,
  resolution_note      TEXT,
  exception_id         UUID          REFERENCES exceptions(id),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disputes_org ON disputes (org_id);
CREATE INDEX IF NOT EXISTS idx_disputes_submitted_by ON disputes (org_id, submitted_by);
CREATE INDEX IF NOT EXISTS idx_disputes_state ON disputes (org_id, state);
CREATE INDEX IF NOT EXISTS idx_disputes_commission_record ON disputes (commission_record_id);

-- =============================================================================
-- Confidential placement flag — field masking for Producer and External Partner.
-- Finance Admins set is_confidential=true on a placement to suppress position
-- title and client-identifying details in producer-facing and partner-facing views.
-- Masking is enforced in the API response layer (position_title → "Confidential",
-- client_entity_id → masked). Commission amounts are never affected.
-- Canonical: docs/prd.md §9, docs/architecture.md §4
-- Issue: feat: placement confidential flag and field masking (#64)
-- =============================================================================

ALTER TABLE placements ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- Guarantee period tracking — expiry date persisted on placement for efficient
-- cron scans. guarantee_expiry_date = start_date + guarantee_days.
-- Stored as a computed-at-write DATE to allow an index scan in the expiry cron.
-- Canonical: docs/prd.md §5.6, docs/architecture/phase-post-placement-risk.md §Seam 2
-- Issue: feat: guarantee period tracking and monitoring (#19)
-- =============================================================================

ALTER TABLE placements ADD COLUMN IF NOT EXISTS guarantee_expiry_date DATE;

CREATE INDEX IF NOT EXISTS idx_placements_guarantee_expiry
  ON placements (guarantee_expiry_date)
  WHERE guarantee_expiry_date IS NOT NULL;

-- guarantee_periods.expired_at: timestamp when the guarantee was expired by the cron.
ALTER TABLE guarantee_periods ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_guarantee_periods_expiry_scan
  ON guarantee_periods (guarantee_ends)
  WHERE status = 'Active';

-- =============================================================================
-- Clawback and holdback event handling (issue #20).
-- Finance Admins record a candidate departure or refund event that triggers
-- the applicable clawback rule for a placement inside its guarantee window.
-- Canonical: docs/prd.md §5.6, docs/architecture/phase-post-placement-risk.md
-- =============================================================================

-- clawback_events: one row per trigger event recorded by a Finance Admin.
CREATE TABLE IF NOT EXISTS clawback_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  placement_id     UUID        NOT NULL REFERENCES placements(id),
  guarantee_period_id UUID     NOT NULL REFERENCES guarantee_periods(id),
  event_type       TEXT        NOT NULL,   -- candidate_departure | refund
  rule             TEXT        NOT NULL,   -- clawback | holdback | refund_credit | replacement_search
  occurred_at      TIMESTAMPTZ NOT NULL,
  triggered_by     UUID        NOT NULL,   -- Finance Admin actor
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clawback_events_org ON clawback_events (org_id);
CREATE INDEX IF NOT EXISTS idx_clawback_events_placement ON clawback_events (org_id, placement_id);

-- commission_record_adjustments: additive ledger entries for clawback / holdback / exception
-- adjustments. net_payable is re-derived from SUM of all adjustment rows rather than
-- destructively overwritten. Shared with exception-workflow adjustments (phase-finance-close.md §Seam 3).
CREATE TABLE IF NOT EXISTS commission_record_adjustments (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID        NOT NULL,
  commission_record_id UUID        NOT NULL REFERENCES commission_records(id),
  clawback_event_id    UUID        REFERENCES clawback_events(id),
  amount_delta         NUMERIC(15,2) NOT NULL,  -- negative for clawback/holdback deductions
  reason_code          TEXT        NOT NULL,     -- clawback | holdback | refund_credit | exception_adjustment
  adjusted_by          UUID        NOT NULL,
  adjusted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recovered            BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_cra_org ON commission_record_adjustments (org_id);
CREATE INDEX IF NOT EXISTS idx_cra_commission_record ON commission_record_adjustments (commission_record_id);
CREATE INDEX IF NOT EXISTS idx_cra_clawback_event ON commission_record_adjustments (clawback_event_id);
CREATE INDEX IF NOT EXISTS idx_cra_producer_exposure
  ON commission_record_adjustments (commission_record_id)
  WHERE recovered = false;

-- clawback_recovery_schedules: payroll deduction schedule for clawback rule.
-- One row per clawback event (schedule header). Installments are derived
-- from installment_count × installment_amount.
CREATE TABLE IF NOT EXISTS clawback_recovery_schedules (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID        NOT NULL,
  clawback_event_id    UUID        NOT NULL REFERENCES clawback_events(id),
  commission_record_id UUID        NOT NULL REFERENCES commission_records(id),
  clawback_amount      NUMERIC(15,2) NOT NULL,
  installment_count    INTEGER     NOT NULL DEFAULT 1,
  installment_amount   NUMERIC(15,2) NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crs_org ON clawback_recovery_schedules (org_id);
CREATE INDEX IF NOT EXISTS idx_crs_clawback_event ON clawback_recovery_schedules (clawback_event_id);

-- =============================================================================
-- Refund and credit-memo adjustment ledger entries (issue #122).
-- Finance Admins post refund or credit-memo adjustments as append-only ledger
-- entries. The reason column carries the required human-readable explanation.
-- Canonical: docs/prd.md §4, §5.4, §9, docs/architecture/phase-finance-close.md
-- =============================================================================

-- commission_record_adjustments.reason: free-text human-readable reason for the
-- adjustment (required for refund/credit-memo adjustments posted via issue #122).
ALTER TABLE commission_record_adjustments ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE INDEX IF NOT EXISTS idx_cra_reason_code_type
  ON commission_record_adjustments (org_id, reason_code)
  WHERE reason_code IN ('refund', 'credit_memo');

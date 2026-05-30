-- Commission Audit Database Schema
-- Database: commission_audit
-- Role: audit_w (INSERT-only — no UPDATE, DELETE, or TRUNCATE granted)
-- Architecture: docs/architecture/decisions.md — Audit Write Policy

-- audit_log_entries: immutable, append-only record of all consequential mutations.
-- The audit_w role has INSERT-only access; no updates or deletes are permitted
-- at the database level, enforcing the "audit-log-first" policy.
CREATE TABLE IF NOT EXISTS audit_log_entries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  actor_id         UUID        NOT NULL,
  actor_type       TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  entity_type      TEXT        NOT NULL,
  entity_id        UUID        NOT NULL,
  before_json      JSONB,
  after_json       JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log_entries (org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log_entries (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log_entries (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log_entries (created_at);

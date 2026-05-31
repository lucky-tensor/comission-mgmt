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

-- ---------------------------------------------------------------------------
-- DB-level append-only enforcement (DATA-D-004/D-010, IMPL-DATA-043).
--
-- GRANT/REVOKE alone is insufficient: a table's OWNER bypasses column/table
-- privileges, so the role that runs migrations (and any role that becomes the
-- owner) could still UPDATE/DELETE/TRUNCATE the ledger. A trigger fires for the
-- owner too, so it is the only mechanism that makes the table immutable for
-- *every* role. Row-level UPDATE/DELETE are blocked by a BEFORE ROW trigger;
-- TRUNCATE is blocked by a BEFORE TRUNCATE statement trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_entries is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log_entries;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit_log_entries
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_log_entries;
CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit_log_entries
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

DROP TRIGGER IF EXISTS trg_audit_no_truncate ON audit_log_entries;
CREATE TRIGGER trg_audit_no_truncate
  BEFORE TRUNCATE ON audit_log_entries
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- Commission Analytics Database Schema
-- Database: commission_analytics
-- Role: analytics_w (INSERT-only — no UPDATE, DELETE, or TRUNCATE granted)
-- Architecture: docs/architecture/decisions.md — Analytics Taxonomy

-- commission_events: pseudonymized analytics event log.
-- Never stores raw financial values — amounts are bucketed into ranges.
-- actor_hash and org_id are HMAC-pseudonymized per analytics taxonomy.
-- No foreign keys to commission_app (separate DB, separate role).
CREATE TABLE IF NOT EXISTS commission_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  event_type       TEXT        NOT NULL,
  metadata         JSONB       NOT NULL DEFAULT '{}',
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_events_org ON commission_events (org_id);
CREATE INDEX IF NOT EXISTS idx_commission_events_type ON commission_events (event_type);
CREATE INDEX IF NOT EXISTS idx_commission_events_occurred_at ON commission_events (occurred_at);

-- ---------------------------------------------------------------------------
-- DB-level append-only enforcement (DATA-D-004/D-010, IMPL-DATA-043).
--
-- As with the audit ledger, GRANT/REVOKE does not bind the table owner, so a
-- trigger is required to make commission_events immutable for every role —
-- including the migration/owner role. Row UPDATE/DELETE are blocked by a BEFORE
-- ROW trigger; TRUNCATE by a BEFORE TRUNCATE statement trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_analytics_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commission_events is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_no_update ON commission_events;
CREATE TRIGGER trg_events_no_update
  BEFORE UPDATE ON commission_events
  FOR EACH ROW EXECUTE FUNCTION reject_analytics_mutation();

DROP TRIGGER IF EXISTS trg_events_no_delete ON commission_events;
CREATE TRIGGER trg_events_no_delete
  BEFORE DELETE ON commission_events
  FOR EACH ROW EXECUTE FUNCTION reject_analytics_mutation();

DROP TRIGGER IF EXISTS trg_events_no_truncate ON commission_events;
CREATE TRIGGER trg_events_no_truncate
  BEFORE TRUNCATE ON commission_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_analytics_mutation();

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

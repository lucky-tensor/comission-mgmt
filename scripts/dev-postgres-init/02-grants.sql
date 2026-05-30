-- dev-postgres-init/02-grants.sql
--
-- Grants database-level privileges to the three commission roles.
-- This script connects to each database in turn and sets up:
--
--   commission_analytics:
--     - analytics_w: CONNECT + USAGE on public schema (INSERT-only grants
--       applied by migrate.ts after schema creation)
--
--   commission_audit:
--     - audit_w: CONNECT + USAGE on public schema (INSERT-only grants
--       applied by migrate.ts after schema creation)
--
-- Architecture constraints (DATA-A-001, DATA-C-002, IMPL-DATA-003/004):
--   - No cross-DB privileges: analytics_w cannot access commission_app or commission_audit
--   - No UPDATE/DELETE/TRUNCATE grants on analytics or audit databases
--   - migrate.ts (packages/db/migrate.ts) applies table-level INSERT-only grants
--     after creating the schema, so this file only sets database/schema access.

\connect commission_analytics

GRANT CONNECT ON DATABASE commission_analytics TO analytics_w;
GRANT USAGE ON SCHEMA public TO analytics_w;
-- Default privileges ensure future tables created by app_rw are also INSERT-only for analytics_w
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT ON TABLES TO analytics_w;

\connect commission_audit

GRANT CONNECT ON DATABASE commission_audit TO audit_w;
GRANT USAGE ON SCHEMA public TO audit_w;
-- Default privileges ensure future tables created by app_rw are also INSERT-only for audit_w
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT ON TABLES TO audit_w;

\connect postgres

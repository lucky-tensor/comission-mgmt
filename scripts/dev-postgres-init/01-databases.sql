-- dev-postgres-init/01-databases.sql
--
-- Creates the three commission databases and three insert-only-where-applicable
-- DB roles for local development.
--
-- Architecture constraints (DATA-A-001, DATA-C-002, IMPL-DATA-003/004/043):
--   - Three physically separated databases: commission_app, commission_analytics, commission_audit
--   - Three roles: app_rw (read-write on app), analytics_w (insert-only), audit_w (insert-only)
--   - No cross-DB privileges
--   - Both analytics_w and audit_w are INSERT-only: no UPDATE, DELETE, or TRUNCATE
--
-- This script runs once on first postgres container start (postgres init hook).
-- It is idempotent: all statements use IF NOT EXISTS / DO...END guards.
--
-- In production, these databases and roles are provisioned by the infrastructure
-- scripts (scripts/gcp/) during cluster initialization.

-- ---------------------------------------------------------------------------
-- Databases
-- ---------------------------------------------------------------------------

-- Transactional ledger: placements, commission calculations, task queue
SELECT 'CREATE DATABASE commission_app OWNER app_rw'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'commission_app')
\gexec

-- Insert-only analytics events: pseudonymized aggregated data
SELECT 'CREATE DATABASE commission_analytics OWNER app_rw'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'commission_analytics')
\gexec

-- Append-only audit log: separate encryption key, independent backup
SELECT 'CREATE DATABASE commission_audit OWNER app_rw'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'commission_audit')
\gexec

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- app_rw: read-write on commission_app (already exists as POSTGRES_USER)
-- Created by POSTGRES_USER env var — no action needed.

-- analytics_w: insert-only on commission_analytics (no UPDATE/DELETE/TRUNCATE)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analytics_w') THEN
    CREATE ROLE analytics_w WITH LOGIN PASSWORD 'analytics_w_dev_password' NOINHERIT;
  END IF;
END
$$;

-- audit_w: insert-only on commission_audit (no UPDATE/DELETE/TRUNCATE)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_w') THEN
    CREATE ROLE audit_w WITH LOGIN PASSWORD 'audit_w_dev_password' NOINHERIT;
  END IF;
END
$$;

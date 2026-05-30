/**
 * Commission management database connection pools.
 *
 * Three PostgreSQL pools with role-separated access:
 *   - sql         → superfield_app (transactional, RW for business data)
 *   - auditSql    → superfield_audit (audit log writes)
 *   - analyticsSql → superfield_analytics (analytics writes)
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, three-DB posture
 */

import postgres from 'postgres';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { buildSslOptions } from './ssl';

export { buildSslOptions } from './ssl';

const DEFAULT_DATABASE_URLS = {
  app: 'postgres://app_rw:app_rw_password@localhost:5432/commission_app',
  audit: 'postgres://audit_w:audit_w_password@localhost:5432/commission_audit',
  analytics: 'postgres://analytics_w:analytics_w_password@localhost:5432/commission_analytics',
} as const;

export interface DatabaseUrls {
  app: string;
  audit: string;
  analytics: string;
}

function maskDbUrl(dbUrl: string): string {
  return dbUrl.replace(/:[^:@]+@/, ':***@');
}

export function resolveDatabaseUrls(env: NodeJS.ProcessEnv = process.env): DatabaseUrls {
  return {
    app: env.DATABASE_URL || DEFAULT_DATABASE_URLS.app,
    audit: env.AUDIT_DATABASE_URL || DEFAULT_DATABASE_URLS.audit,
    analytics: env.ANALYTICS_DATABASE_URL || DEFAULT_DATABASE_URLS.analytics,
  };
}

function createPool(databaseUrl: string, max: number) {
  console.log(`[db] Binding to PostgreSQL at: ${maskDbUrl(databaseUrl)}`);
  return postgres(databaseUrl, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: buildSslOptions(),
    connection: { client_min_messages: 'warning' },
  });
}

const databaseUrls = resolveDatabaseUrls();

export const sql = createPool(databaseUrls.app, 10);
export const auditSql = createPool(databaseUrls.audit, 5);
export const analyticsSql = createPool(databaseUrls.analytics, 3);

/**
 * Create a single-connection postgres.js pool bound to an arbitrary URL.
 * Useful in tests that start an ephemeral Postgres container.
 */
export function createSql(databaseUrl: string, max = 1) {
  return createPool(databaseUrl, max);
}

export interface MigrateOptions {
  /** URL for commission_app (transactional). Defaults to the module-level pool. */
  databaseUrl?: string;
  /**
   * URL for commission_audit.
   * If omitted, the audit schema migration is skipped (useful for unit tests
   * that only need the app schema in an ephemeral container).
   * Pass null explicitly to skip.
   */
  auditDatabaseUrl?: string | null;
  /**
   * URL for commission_analytics.
   * If omitted, the analytics schema migration is skipped.
   * Pass null explicitly to skip.
   */
  analyticsDatabaseUrl?: string | null;
}

export function resolveSchemaPath(
  filename: string,
  moduleUrl: string = import.meta.url,
  cwd: string = process.cwd(),
): string {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    resolve(moduleDir, filename),
    resolve(moduleDir, `../packages/db/${filename}`),
    resolve(cwd, `packages/db/${filename}`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export function resolveSchemaSqlPath(
  moduleUrl: string = import.meta.url,
  cwd: string = process.cwd(),
): string {
  return resolveSchemaPath('schema.sql', moduleUrl, cwd);
}

/**
 * Split a SQL string into individual statements on top-level semicolons,
 * respecting dollar-quoted blocks ($$...$$) so PL/pgSQL function bodies
 * that contain semicolons are never split mid-body.
 */
export function splitSqlStatements(sqlStr: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let i = 0;

  while (i < sqlStr.length) {
    if (sqlStr[i] === '$' && sqlStr[i + 1] === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i += 2;
      continue;
    }

    if (!inDollarQuote && sqlStr[i] === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      i += 1;
      continue;
    }

    current += sqlStr[i];
    i += 1;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }

  return statements;
}

async function applySchema(schemaFilePath: string, pool: ReturnType<typeof postgres>, owned: boolean) {
  const schemaSql = readFileSync(schemaFilePath, 'utf-8');
  const cleanSql = schemaSql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const statements = splitSqlStatements(cleanSql).filter((s) => s.length > 0);
  try {
    for (const statement of statements) {
      await pool.unsafe(statement);
    }
  } finally {
    if (owned) {
      await pool.end({ timeout: 5 });
    }
  }
}

/**
 * Initializes all three commission databases by applying their respective schemas.
 *
 * - commission_app: schema.sql (placements, contributors, commission plans, etc.)
 * - commission_audit: audit_schema.sql (audit_log_entries — INSERT-only for audit_w)
 * - commission_analytics: analytics_schema.sql (commission_events — INSERT-only for analytics_w)
 *
 * All migrations are idempotent (CREATE TABLE IF NOT EXISTS / DO...EXCEPTION guards).
 * This function should be called at server startup to ensure tables exist.
 */
export async function migrate(options: MigrateOptions = {}) {
  console.log('[db] Initializing PostgreSQL database schemas...');

  const appUrl = options.databaseUrl ?? databaseUrls.app;

  const appPool = options.databaseUrl === undefined
    ? sql
    : postgres(appUrl, { max: 1, idle_timeout: 10, connect_timeout: 10, connection: { client_min_messages: 'warning' } });
  const appOwned = options.databaseUrl !== undefined;

  try {
    await applySchema(resolveSchemaPath('schema.sql'), appPool, false);
    console.log('[db] App schema applied.');

    // Audit and analytics migrations are opt-in: only run when an explicit URL is provided.
    // This allows unit tests that only need the app schema to skip them.
    if (options.auditDatabaseUrl) {
      const auditPool = postgres(options.auditDatabaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 10, connection: { client_min_messages: 'warning' } });
      try {
        await applySchema(resolveSchemaPath('audit_schema.sql'), auditPool, false);
        console.log('[db] Audit schema applied.');
      } finally {
        await auditPool.end({ timeout: 5 });
      }
    } else if (options.auditDatabaseUrl === undefined) {
      // Default production/dev mode: use the module-level auditSql pool
      // (skipped if auditDatabaseUrl is explicitly null)
      await applySchema(resolveSchemaPath('audit_schema.sql'), auditSql, false);
      console.log('[db] Audit schema applied.');
    }

    if (options.analyticsDatabaseUrl) {
      const analyticsPool = postgres(options.analyticsDatabaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 10, connection: { client_min_messages: 'warning' } });
      try {
        await applySchema(resolveSchemaPath('analytics_schema.sql'), analyticsPool, false);
        console.log('[db] Analytics schema applied.');
      } finally {
        await analyticsPool.end({ timeout: 5 });
      }
    } else if (options.analyticsDatabaseUrl === undefined) {
      await applySchema(resolveSchemaPath('analytics_schema.sql'), analyticsSql, false);
      console.log('[db] Analytics schema applied.');
    }

    console.log('[db] Schema migration complete.');
  } catch (err) {
    console.error('[db] Schema migration failed:', err);
    throw err;
  } finally {
    if (appOwned) await appPool.end({ timeout: 5 });
  }
}

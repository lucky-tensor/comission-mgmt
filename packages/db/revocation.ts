import { sql as defaultSql } from './index';
import type postgres from 'postgres';

/**
 * Minimal sql-tagged-template type accepted by all exported functions.
 * Matches the postgres.js Sql type used in worker-tokens.ts.
 */
export type SqlClient = postgres.Sql;

/**
 * Records a token JTI as revoked. Called on logout.
 *
 * @param jti - The JWT ID claim to revoke.
 * @param expiresAt - The token's original expiry time. Rows are cleaned up
 *                    after this time passes so the table does not grow unbounded.
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function revokeToken(
  jti: string,
  expiresAt: Date,
  sqlClient?: SqlClient,
): Promise<void> {
  const sql = sqlClient ?? defaultSql;
  await sql`
    INSERT INTO revoked_tokens (jti, expires_at)
    VALUES (${jti}, ${expiresAt})
    ON CONFLICT (jti) DO NOTHING
  `;
}

/**
 * Returns true when the given JTI is present in the revoked_tokens table.
 * Uses a primary-key point lookup (O(log n)).
 *
 * @param jti - The JWT ID claim to test.
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function isRevoked(jti: string, sqlClient?: SqlClient): Promise<boolean> {
  const sql = sqlClient ?? defaultSql;
  const rows = await sql`
    SELECT 1 FROM revoked_tokens WHERE jti = ${jti} LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Deletes all rows whose token has already expired.
 * Called at server startup and every 24 hours.
 *
 * @param sqlClient - Optional injectable SQL client (for testing).
 */
export async function cleanupExpiredRevocations(sqlClient?: SqlClient): Promise<void> {
  const sql = sqlClient ?? defaultSql;
  await sql`DELETE FROM revoked_tokens WHERE expires_at < NOW()`;
}

/**
 * Starts the 24-hour cleanup timer.
 * The returned NodeJS.Timeout has `.unref()` called so it does not prevent
 * process exit.
 */
export function startRevocationCleanup(): ReturnType<typeof setInterval> {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const timer = setInterval(() => {
    cleanupExpiredRevocations().catch((err) => console.error('[revocation] cleanup failed:', err));
  }, INTERVAL_MS);
  timer.unref();
  return timer;
}

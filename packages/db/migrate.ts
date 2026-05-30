/**
 * Migration runner — applies all three commission database schemas idempotently.
 *
 * Databases migrated:
 *   - commission_app      (DATABASE_URL)        — core relational tables
 *   - commission_audit    (AUDIT_DATABASE_URL)   — immutable audit log
 *   - commission_analytics (ANALYTICS_DATABASE_URL) — pseudonymized events
 *
 * Usage: bun run packages/db/migrate.ts
 * All migrations are idempotent; running twice on the same DB is safe.
 */
import { migrate } from './index';

await migrate();
console.log('Migration script executed successfully for CI/CD.');
process.exit(0);

/**
 * Worker startup guard — refuses to boot if any database credential is present.
 *
 * The worker is a network-isolated, HTTP-only task runner: it claims and submits
 * work exclusively through the application API using single-use, task-scoped
 * delegated tokens. It must never hold a database connection string or the field
 * encryption master key — possession of the credential *is* the vulnerability,
 * regardless of intent (WORKER-X-009, WORKER-C-002, WORKER-P-001; DATA-P-007/X-006).
 *
 * This guard runs first at process startup and aborts (exit 1) when any of the
 * forbidden env vars is set, so a misconfigured manifest fails loud and early
 * rather than silently granting the worker DB reach.
 *
 * Canonical docs: docs/architecture.md — Worker isolation; IMPL-TQ-TS-008.
 */

/** Env vars the worker must never receive. */
export const FORBIDDEN_ENV_PATTERNS: RegExp[] = [
  /^DATABASE_URL$/,
  /^ENCRYPTION_MASTER_KEY$/,
  /^PG[A-Z_]*$/, // PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT, …
];

/**
 * Returns the names of forbidden env vars present in the given environment.
 * Pure — takes the environment as input so it is trivially testable.
 */
export function findForbiddenEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env).filter(
    (name) => env[name] != null && FORBIDDEN_ENV_PATTERNS.some((re) => re.test(name)),
  );
}

/**
 * Aborts the process when any forbidden DB credential is present in the
 * environment. Call this before any other worker startup logic.
 */
export function assertNoDbCredentials(env: NodeJS.ProcessEnv = process.env): void {
  const found = findForbiddenEnv(env);
  if (found.length > 0) {
    console.error(
      `[worker] FATAL: forbidden database credential(s) present in environment: ${found.join(
        ', ',
      )}. The worker is HTTP-only and must never hold a DB credential or the ` +
        `encryption master key. Remove these from the worker manifest. Aborting.`,
    );
    process.exit(1);
  }
}

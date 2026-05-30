/**
 * Startup environment validation — fail fast on missing required configuration.
 *
 * A server that boots with an insecure default (e.g. a hardcoded DB password or
 * a blank JWT secret) is worse than one that refuses to start: it silently runs
 * in an unsafe state. This module asserts every required secret/connection is
 * present and aborts the process with a clear message if any is missing
 * (DEPLOY env fail-fast).
 *
 * Demo/dev mode (DEMO_MODE=true) relaxes the requirement set since those flows
 * do not mint real sessions or touch production secrets.
 */

/** Env vars that must be present for a production boot. */
export const REQUIRED_ENV_VARS = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_MASTER_KEY'] as const;

/**
 * Returns the names of required env vars that are missing or blank in the given
 * environment. Pure — accepts the environment as input for testability.
 */
export function findMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  // Demo mode runs without real secrets.
  if (env.DEMO_MODE === 'true') return [];
  return REQUIRED_ENV_VARS.filter((name) => {
    const v = env[name];
    return v == null || v.trim() === '';
  });
}

/**
 * Validates the environment and aborts the process (exit 1) when any required
 * var is missing. Call this once, before constructing DB pools or the server.
 */
export function assertRequiredEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = findMissingEnv(env);
  if (missing.length > 0) {
    console.error(
      `[server] FATAL: missing required environment variable(s): ${missing.join(', ')}. ` +
        `Set them (or run with DEMO_MODE=true for local demos). Aborting.`,
    );
    process.exit(1);
  }
}

/**
 * @file claude-cli-engine.ts
 *
 * Producer Deal Simulator — Claude CLI spawn engine seam.
 *
 * DORMANT_BY_DESIGN
 * depends_on: issue #262 (Producer Deal Simulator pipeline)
 * reason: dev-scout #263 reserves the typed entrypoint, timeout contract, and
 * structured-output parse signature for the forecasting engine. The real
 * implementation spawns the `claude` CLI as a subprocess; this scout performs
 * NO subprocess execution so the phase branch stays compile-safe and inert.
 *
 * Why a CLI engine (vs. the HTTP callClaudeAPI client):
 *   - callClaudeAPI (claude-api-client.ts, #188) is the HTTP/SDK path shared by
 *     the arbitration + simulation workers for short structured prompts.
 *   - runClaudeCli is the SIMULATION-specific engine seam: the digital-twin
 *     forecasting step shells out to the `claude` CLI so the simulation worker
 *     can reuse the operator's local agent toolchain (tools, MCP, sandboxing)
 *     rather than a bare message API call. Issue #262 picks the final engine;
 *     both seams are reserved so the feature is not blocked on that choice.
 *
 * Contract reserved here:
 *   - typed entrypoint: runClaudeCli(request) -> ClaudeCliResult<T>
 *   - timeout contract: request.timeoutMs (default 60s); on expiry the engine
 *     aborts the subprocess and returns { status: 'error', error.code: 'timeout' }.
 *   - structured-output parse signature: request.parse maps raw stdout -> T,
 *     and parse failures surface as error.code 'parse_error' (never a throw).
 *
 * Canonical docs: docs/prd.md §5.9, docs/prd.md §5.12, docs/arbitration-simulation.md
 */

/** Default subprocess timeout for a CLI forecast run — 60 seconds. */
export const CLAUDE_CLI_DEFAULT_TIMEOUT_MS = 60_000;

/** Structured-output parser: maps raw CLI stdout to the typed result shape. */
export type ClaudeCliParser<T> = (rawStdout: string) => T;

/**
 * Request to the Claude CLI engine.
 *
 * The engine spawns the `claude` CLI with `prompt`, enforces `timeoutMs`, and
 * applies `parse` to the captured stdout. Business data is passed via `prompt`
 * (already redacted/contextualized by the caller).
 */
export interface ClaudeCliRequest<T = string> {
  /** Correlates the run to its simulation_run / task_queue row for audit. */
  taskId: string;
  /** Fully-formed prompt sent to the CLI on stdin / as an argument. */
  prompt: string;
  /** Hard subprocess timeout in ms (default CLAUDE_CLI_DEFAULT_TIMEOUT_MS). */
  timeoutMs?: number;
  /**
   * Structured-output parser. The real engine pipes CLI stdout through this to
   * produce the typed forecast. Defaults to identity (raw stdout as string).
   */
  parse?: ClaudeCliParser<T>;
}

/** Stable error codes surfaced by the CLI engine (never thrown). */
export type ClaudeCliErrorCode =
  | 'timeout' // subprocess exceeded timeoutMs
  | 'spawn_error' // CLI binary missing / failed to launch
  | 'nonzero_exit' // CLI exited non-zero
  | 'parse_error' // parse(stdout) threw or returned invalid output
  | 'not_implemented' // dev-scout stub: engine intentionally inert
  | 'unknown';

/** Structured result from the CLI engine. Mirrors ClaudeApiResponse shape. */
export interface ClaudeCliResult<T = string> {
  status: 'success' | 'error';
  result?: T;
  error?: {
    code: ClaudeCliErrorCode;
    message: string;
    /** True for transient failures (timeout, spawn) the caller may retry. */
    retriable: boolean;
  };
}

/**
 * Spawn the Claude CLI to produce a structured forecast.
 *
 * STUB IMPLEMENTATION (dev-scout #263): does NOT spawn any subprocess. It
 * validates the request shape and returns a structured `not_implemented` error
 * so callers compile and route against a stable signature. Issue #262 will:
 *   1. Spawn `claude` via node:child_process with an AbortController bound to
 *      `timeoutMs` (on abort -> error.code 'timeout', retriable true).
 *   2. Capture stdout/stderr; non-zero exit -> error.code 'nonzero_exit'.
 *   3. Apply `parse(stdout)`; a throw -> error.code 'parse_error' (not a throw).
 *   4. On success -> { status: 'success', result }.
 *
 * @param request - typed CLI request (prompt, timeout, parser).
 * @returns structured result; never throws.
 */
export async function runClaudeCli<T = string>(
  request: ClaudeCliRequest<T>,
): Promise<ClaudeCliResult<T>> {
  const timeoutMs = request.timeoutMs ?? CLAUDE_CLI_DEFAULT_TIMEOUT_MS;

  // Shape guard so the seam fails fast on obviously malformed requests.
  if (typeof request.taskId !== 'string' || request.taskId.trim() === '') {
    return {
      status: 'error',
      error: { code: 'unknown', message: 'taskId is required', retriable: false },
    };
  }
  if (typeof request.prompt !== 'string') {
    return {
      status: 'error',
      error: { code: 'unknown', message: 'prompt must be a string', retriable: false },
    };
  }

  // STUB: no subprocess is spawned in the scout. The parser/timeout are part of
  // the reserved contract and are referenced so they remain wired for #262.
  void timeoutMs;
  void (request.parse ?? ((raw: string) => raw as unknown as T));

  return {
    status: 'error',
    error: {
      code: 'not_implemented',
      message:
        'Claude CLI engine is a dev-scout seam (#263); real subprocess execution lands in #262.',
      retriable: false,
    },
  };
}

export default { runClaudeCli };

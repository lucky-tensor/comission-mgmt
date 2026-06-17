/**
 * @file claude-cli-engine.ts
 *
 * Producer Deal Simulator — Claude CLI spawn engine.
 *
 * The simulation worker shells out to the locally-installed `claude` CLI as a
 * subprocess to produce a structured deal forecast. The CLI engine reuses the
 * operator's local agent toolchain (no outbound Anthropic HTTP call is made by
 * the worker; the device-local binary is invoked) and is bounded by a hard
 * subprocess timeout.
 *
 * Why a CLI engine (vs. the HTTP callClaudeAPI client):
 *   - callClaudeAPI (claude-api-client.ts, #188) is the HTTP/SDK path shared by
 *     the arbitration + simulation workers for short structured prompts.
 *   - runClaudeCli is the SIMULATION-specific engine: the digital-twin
 *     forecasting step shells out to the `claude` CLI so the simulation worker
 *     reuses the operator's local agent toolchain (tools, MCP, sandboxing).
 *
 * Contract:
 *   - typed entrypoint: runClaudeCli(request) -> ClaudeCliResult<T>
 *   - timeout contract: request.timeoutMs (default 60s); on expiry the engine
 *     aborts the subprocess and returns { status: 'error', error.code: 'timeout' }.
 *   - structured-output parse signature: request.parse maps raw stdout -> T,
 *     and parse failures surface as error.code 'parse_error' (never a throw).
 *
 * Hermetic testing: the subprocess spawn is injectable via request.spawn so unit
 * tests never invoke the real binary. Production callers omit it and the engine
 * spawns the configured `claude` CLI through node:child_process.
 *
 * Canonical docs: docs/prd.md §5.9, docs/prd.md §5.12, docs/arbitration-simulation.md
 */

/** Default subprocess timeout for a CLI forecast run — 60 seconds. */
export const CLAUDE_CLI_DEFAULT_TIMEOUT_MS = 60_000;

/** Binary invoked for the forecast run. Overridable via CLAUDE_CLI_BIN. */
export const CLAUDE_CLI_BIN = process.env.CLAUDE_CLI_BIN ?? 'claude';

/** Structured-output parser: maps raw CLI stdout to the typed result shape. */
export type ClaudeCliParser<T> = (rawStdout: string) => T;

/**
 * Outcome of one subprocess execution, normalized so the engine never has to
 * know how the process was launched. Returned by ClaudeCliSpawn.
 */
export interface ClaudeCliSpawnResult {
  /** Process exit code (null if the process was killed by a signal/timeout). */
  code: number | null;
  /** True when the run was aborted because it exceeded timeoutMs. */
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** Set when the binary could not be launched at all (ENOENT etc.). */
  spawnError?: Error;
}

/**
 * Subprocess launcher. The default implementation spawns the `claude` CLI; tests
 * inject a stub so no real binary is invoked.
 */
export type ClaudeCliSpawn = (args: {
  bin: string;
  prompt: string;
  timeoutMs: number;
}) => Promise<ClaudeCliSpawnResult>;

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
  /** Fully-formed prompt sent to the CLI via stdin. */
  prompt: string;
  /** Hard subprocess timeout in ms (default CLAUDE_CLI_DEFAULT_TIMEOUT_MS). */
  timeoutMs?: number;
  /**
   * Structured-output parser. The engine pipes CLI stdout through this to
   * produce the typed forecast. Defaults to identity (raw stdout as string).
   */
  parse?: ClaudeCliParser<T>;
  /** Injectable subprocess launcher for hermetic tests. */
  spawn?: ClaudeCliSpawn;
}

/** Stable error codes surfaced by the CLI engine (never thrown). */
export type ClaudeCliErrorCode =
  | 'timeout' // subprocess exceeded timeoutMs
  | 'spawn_error' // CLI binary missing / failed to launch
  | 'nonzero_exit' // CLI exited non-zero
  | 'parse_error' // parse(stdout) threw or returned invalid output
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
 * Default subprocess launcher — spawns the `claude` CLI in non-interactive
 * print mode (Bun.spawn), feeds the prompt over stdin, and captures
 * stdout/stderr. The process is killed if it exceeds timeoutMs.
 *
 * `claude -p` (print mode) runs a single non-interactive turn and writes the
 * response to stdout, which is exactly the structured-output contract the engine
 * needs. We do not pass tool/permission flags here — the operator's local config
 * governs the toolchain.
 */
export const defaultClaudeCliSpawn: ClaudeCliSpawn = async ({ bin, prompt, timeoutMs }) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([bin, '-p'], {
      stdin: new TextEncoder().encode(prompt),
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    return {
      code: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: err instanceof Error ? err : new Error(String(err)),
    };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGKILL');
  }, timeoutMs);

  try {
    // With stdout/stderr: 'pipe', Bun exposes ReadableStreams here; the type
    // union also includes a numeric fd which never applies under 'pipe'.
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ]);
    await proc.exited;
    clearTimeout(timer);
    return { code: proc.exitCode, timedOut, stdout, stderr };
  } catch (err) {
    clearTimeout(timer);
    return {
      code: null,
      timedOut,
      stdout: '',
      stderr: '',
      spawnError: err instanceof Error ? err : new Error(String(err)),
    };
  }
};

/**
 * Spawn the Claude CLI to produce a structured forecast.
 *
 * Execution model:
 *   1. Spawn `claude` (or CLAUDE_CLI_BIN) bounded by `timeoutMs`. On expiry the
 *      subprocess is killed -> error.code 'timeout' (retriable).
 *   2. Failure to launch the binary (ENOENT etc.) -> error.code 'spawn_error'.
 *   3. Non-zero exit -> error.code 'nonzero_exit'.
 *   4. Apply `parse(stdout)`; a throw -> error.code 'parse_error' (never a throw).
 *   5. On success -> { status: 'success', result }.
 *
 * The function never throws: every failure path maps to a structured error.
 *
 * @param request - typed CLI request (prompt, timeout, parser, optional spawn).
 * @returns structured result; never throws.
 */
export async function runClaudeCli<T = string>(
  request: ClaudeCliRequest<T>,
): Promise<ClaudeCliResult<T>> {
  const timeoutMs = request.timeoutMs ?? CLAUDE_CLI_DEFAULT_TIMEOUT_MS;

  // Shape guard so the engine fails fast on obviously malformed requests.
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

  const spawn = request.spawn ?? defaultClaudeCliSpawn;
  const parse = request.parse ?? ((raw: string) => raw as unknown as T);

  let outcome: ClaudeCliSpawnResult;
  try {
    outcome = await spawn({ bin: CLAUDE_CLI_BIN, prompt: request.prompt, timeoutMs });
  } catch (err) {
    // A spawn implementation that itself throws is treated as a spawn failure.
    return {
      status: 'error',
      error: {
        code: 'spawn_error',
        message: `Failed to launch ${CLAUDE_CLI_BIN}: ${err instanceof Error ? err.message : String(err)}`,
        retriable: true,
      },
    };
  }

  if (outcome.timedOut) {
    return {
      status: 'error',
      error: {
        code: 'timeout',
        message: `${CLAUDE_CLI_BIN} exceeded ${timeoutMs}ms and was terminated`,
        retriable: true,
      },
    };
  }

  if (outcome.spawnError) {
    return {
      status: 'error',
      error: {
        code: 'spawn_error',
        message: `Failed to launch ${CLAUDE_CLI_BIN}: ${outcome.spawnError.message}`,
        retriable: true,
      },
    };
  }

  if (outcome.code !== 0) {
    return {
      status: 'error',
      error: {
        code: 'nonzero_exit',
        message: `${CLAUDE_CLI_BIN} exited with code ${outcome.code}: ${outcome.stderr.trim() || '(no stderr)'}`,
        retriable: false,
      },
    };
  }

  let result: T;
  try {
    result = parse(outcome.stdout);
  } catch (err) {
    return {
      status: 'error',
      error: {
        code: 'parse_error',
        message: `Failed to parse CLI output: ${err instanceof Error ? err.message : String(err)}`,
        retriable: false,
      },
    };
  }

  return { status: 'success', result };
}

export default { runClaudeCli };

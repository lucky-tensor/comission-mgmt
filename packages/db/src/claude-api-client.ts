/**
 * Claude API Client with timeout and retry logic.
 *
 * Provides a shared module for arbitration and simulation workers to call Claude API
 * with exponential backoff retry, configurable timeout, and structured error handling.
 *
 * Phase: Arbitration & Simulation (dev-scout #188)
 * Canonical: docs/arbitration-simulation.md — Claude API client integration
 *
 * Error handling:
 *   - Transient errors (network timeout, 5xx): logged to audit DB, marked retriable=true
 *   - Permanent errors (4xx excluding rate limit, auth failure): logged to audit DB, marked retriable=false
 *   - Rate limit (429): logged to audit DB, marked retriable=true (retryable via backoff)
 *
 * Timeout: 30 seconds per request (configurable).
 * Retry: exponential backoff (2^N seconds), max 3 attempts.
 */

// Note: sql is not imported in this stub. The real implementation
// will need to import { sql } from the parent db package for audit logging.
// For now, we rely on process.env for audit operations (stub behavior).

/**
 * Structured error response returned by callClaudeAPI.
 * Consumers should check the error field to determine if the call succeeded.
 */
export interface ClaudeApiResponse<T = unknown> {
  status: 'success' | 'error';
  result?: T;
  error?: {
    code: string; // 'timeout' | 'auth_error' | 'network_error' | 'rate_limit' | 'unknown'
    message: string;
    retriable: boolean;
  };
}

/**
 * Context passed to callClaudeAPI for audit and logging purposes.
 */
export interface ClaudeApiContext {
  taskId: string;
  jobType: string; // 'dispute_arbitration' | 'producer_simulation'
  correlationId?: string;
  userId?: string; // The user who triggered this work (for audit trail)
}

/**
 * Call the Claude API with timeout and exponential backoff retry.
 *
 * @param context - Task and audit context
 * @param prompt - The prompt/message to send to Claude
 * @param timeoutMs - Request timeout in milliseconds (default: 30000 = 30s)
 * @param maxAttempts - Maximum retry attempts (default: 3)
 * @returns Structured response with result or error
 *
 * STUB IMPLEMENTATION: This is a dev-scout placeholder that does not invoke
 * the actual Claude API. It compiles and returns a structured response.
 * Real implementation will be filled in by the feature team (#186, #187).
 */
export async function callClaudeAPI<T = string>(
  context: ClaudeApiContext,
  prompt: string,
  _timeoutMs: number = 30000,
  maxAttempts: number = 3,
): Promise<ClaudeApiResponse<T>> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    const errorMsg = 'CLAUDE_API_KEY environment variable not set';
    await logClaudeApiError(context, 'missing_api_key', errorMsg, false);
    return {
      status: 'error',
      error: {
        code: 'auth_error',
        message: errorMsg,
        retriable: false,
      },
    };
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // STUB: Placeholder for actual Claude API call.
      // Real implementation will use the Anthropic SDK or direct HTTP call.
      //
      // Expected behavior:
      // - Initialize Anthropic client with apiKey
      // - Create message with prompt
      // - Set timeout using AbortController (30s default)
      // - Return parsed response as result
      //
      // This stub always succeeds (simulating a valid API call).
      // Once the feature team (#186, #187) lands, this will be replaced
      // with actual API invocation logic.

      console.log(`[claude-api] Task ${context.taskId} attempt ${attempt + 1}/${maxAttempts}`);

      // STUB: Simulate successful API call
      const result = {
        status: 'success',
        result: `[STUB] Claude API response for ${context.jobType}` as unknown as T,
      } as ClaudeApiResponse<T>;

      await logClaudeApiSuccess(context, 'stub_success');
      return result;
    } catch (error) {
      lastError = error;
      const isRetriable = isRetriableError(error);
      const errorCode = getErrorCode(error);

      // Log the error attempt
      const message = error instanceof Error ? error.message : String(error);
      await logClaudeApiError(context, errorCode, message, isRetriable, attempt + 1);

      if (!isRetriable) {
        return {
          status: 'error',
          error: {
            code: errorCode,
            message: message,
            retriable: false,
          },
        };
      }

      // If this is not the last attempt and the error is retriable, wait with exponential backoff
      if (attempt < maxAttempts - 1) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 2^0, 2^1, 2^2 seconds
        console.log(
          `[claude-api] Task ${context.taskId} retriable error, backing off ${backoffMs}ms before retry`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // All retries exhausted
  const finalMessage = lastError instanceof Error ? lastError.message : String(lastError);
  return {
    status: 'error',
    error: {
      code: getErrorCode(lastError),
      message: `Failed after ${maxAttempts} attempts: ${finalMessage}`,
      retriable: false, // Retries exhausted
    },
  };
}

/**
 * Determine if an error is retriable (transient) or permanent.
 */
function isRetriableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Timeout errors are retriable
    if (message.includes('timeout') || message.includes('abort')) {
      return true;
    }

    // Network errors are retriable
    if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
      return true;
    }

    // 5xx errors are retriable
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
      return true;
    }

    // Rate limit (429) is retriable
    if (message.includes('429') || message.includes('rate limit')) {
      return true;
    }
  }

  // Unknown errors are retriable by default (conservative)
  return true;
}

/**
 * Extract a structured error code from the error.
 */
function getErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('timeout') || message.includes('abort')) return 'timeout';
    if (message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('forbidden')) {
      return 'auth_error';
    }
    if (message.includes('429') || message.includes('rate limit')) return 'rate_limit';
    if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
      return 'network_error';
    }
  }
  return 'unknown';
}

/**
 * Log a successful Claude API call to the audit database.
 * STUB: This is a placeholder. Real implementation will write to the audit DB.
 */
async function logClaudeApiSuccess(_context: ClaudeApiContext, _result: string): Promise<void> {
  try {
    // STUB: Placeholder for audit logging.
    // Real implementation will:
    // - Connect to commission_audit database
    // - Insert a row into audit_log_entries with event_type='claude_api_call_success'
    // - Include task_id, job_type, correlation_id, user_id, timestamp
    //
    // For now, just log to console
    console.log(`[claude-api] Audit: success for task ${_context.taskId} (${_context.jobType})`);
  } catch (err) {
    // Audit logging failure should be logged but not thrown
    console.error(`[claude-api] Audit logging failed:`, err);
  }
}

/**
 * Log a Claude API error to the audit database.
 * STUB: This is a placeholder. Real implementation will write to the audit DB.
 */
async function logClaudeApiError(
  context: ClaudeApiContext,
  errorCode: string,
  message: string,
  retriable: boolean,
  attempt?: number,
): Promise<void> {
  try {
    // STUB: Placeholder for audit logging.
    // Real implementation will:
    // - Connect to commission_audit database
    // - Insert a row into audit_log_entries with event_type='claude_api_call_error'
    // - Include task_id, job_type, correlation_id, user_id, error_code, message, retriable, attempt
    //
    // For now, just log to console
    const attemptStr = attempt ? ` (attempt ${attempt})` : '';
    console.log(
      `[claude-api] Audit: error for task ${context.taskId} (${context.jobType}): ${errorCode} - ${message} (retriable=${retriable})${attemptStr}`,
    );
  } catch (err) {
    // Audit logging failure should be logged but not thrown
    console.error(`[claude-api] Audit logging failed:`, err);
  }
}

export default { callClaudeAPI };

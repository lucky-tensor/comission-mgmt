/**
 * Claude CLI spawn engine seam tests — dev-scout #263.
 *
 * Verifies the reserved typed contract (entrypoint, timeout default, parser
 * signature) without spawning any subprocess. The engine is intentionally inert
 * until the Producer Deal Simulator pipeline (#262) wires real execution.
 */

import { describe, expect, test } from 'vitest';
import { runClaudeCli, CLAUDE_CLI_DEFAULT_TIMEOUT_MS, type ClaudeCliResult } from '../index';

describe('claude CLI engine seam', () => {
  test('default timeout contract is exposed', () => {
    expect(CLAUDE_CLI_DEFAULT_TIMEOUT_MS).toBe(60_000);
  });

  test('valid request returns a structured not_implemented error (no subprocess)', async () => {
    const result: ClaudeCliResult = await runClaudeCli({
      taskId: crypto.randomUUID(),
      prompt: 'forecast this deal',
    });
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('not_implemented');
    expect(result.error?.retriable).toBe(false);
  });

  test('accepts a typed structured-output parser without throwing', async () => {
    const result = await runClaudeCli<{ commission: number }>({
      taskId: crypto.randomUUID(),
      prompt: 'forecast',
      timeoutMs: 1000,
      parse: (raw) => JSON.parse(raw) as { commission: number },
    });
    // Still the inert scout path — parser is wired but not invoked.
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('not_implemented');
  });

  test('rejects a malformed request (missing taskId) without throwing', async () => {
    const result = await runClaudeCli({ taskId: '', prompt: 'x' });
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('unknown');
  });
});

/**
 * Claude CLI spawn engine tests — issue #262.
 *
 * Hermetic: the subprocess is injected via request.spawn so no real `claude`
 * binary is invoked. Verifies the engine maps every subprocess outcome to a
 * stable structured result (success / timeout / spawn_error / nonzero_exit /
 * parse_error) and never throws.
 */

import { describe, expect, test } from 'vitest';
import {
  runClaudeCli,
  CLAUDE_CLI_DEFAULT_TIMEOUT_MS,
  type ClaudeCliResult,
  type ClaudeCliSpawn,
} from '../index';

describe('claude CLI engine', () => {
  test('default timeout contract is exposed', () => {
    expect(CLAUDE_CLI_DEFAULT_TIMEOUT_MS).toBe(60_000);
  });

  test('success: applies the parser to captured stdout', async () => {
    const spawn: ClaudeCliSpawn = async () => ({
      code: 0,
      timedOut: false,
      stdout: '{"commission": 4200}',
      stderr: '',
    });
    const result = await runClaudeCli<{ commission: number }>({
      taskId: crypto.randomUUID(),
      prompt: 'forecast',
      parse: (raw) => JSON.parse(raw) as { commission: number },
      spawn,
    });
    expect(result.status).toBe('success');
    expect(result.result?.commission).toBe(4200);
  });

  test('timeout: returns retriable timeout error', async () => {
    const spawn: ClaudeCliSpawn = async () => ({
      code: null,
      timedOut: true,
      stdout: '',
      stderr: '',
    });
    const result = await runClaudeCli({ taskId: 't', prompt: 'x', timeoutMs: 10, spawn });
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('timeout');
    expect(result.error?.retriable).toBe(true);
  });

  test('spawn_error: binary missing is retriable', async () => {
    const spawn: ClaudeCliSpawn = async () => ({
      code: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: new Error('ENOENT'),
    });
    const result = await runClaudeCli({ taskId: 't', prompt: 'x', spawn });
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('spawn_error');
    expect(result.error?.retriable).toBe(true);
  });

  test('nonzero_exit: non-retriable', async () => {
    const spawn: ClaudeCliSpawn = async () => ({
      code: 2,
      timedOut: false,
      stdout: '',
      stderr: 'fatal',
    });
    const result = await runClaudeCli({ taskId: 't', prompt: 'x', spawn });
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('nonzero_exit');
    expect(result.error?.retriable).toBe(false);
  });

  test('parse_error: parser throw is mapped, never thrown', async () => {
    const spawn: ClaudeCliSpawn = async () => ({
      code: 0,
      timedOut: false,
      stdout: 'not json',
      stderr: '',
    });
    const result = await runClaudeCli({
      taskId: 't',
      prompt: 'x',
      parse: (raw) => JSON.parse(raw) as unknown,
      spawn,
    });
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('parse_error');
  });

  test('rejects a malformed request (missing taskId) without throwing', async () => {
    const result: ClaudeCliResult = await runClaudeCli({ taskId: '', prompt: 'x' });
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('unknown');
  });
});

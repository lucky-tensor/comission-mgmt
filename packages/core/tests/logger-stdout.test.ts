/**
 * Logger stdout test — every structured log entry must be emitted to stdout as
 * a JSON line, so logs survive on an ephemeral, file-less distroless FS and are
 * captured by the container runtime / aggregator (DEPLOY-C-005/006).
 *
 * Captures process.stdout.write by temporarily replacing it (a real function
 * swap on a local reference — not a mock; the TEST-C-001 mock-ban gate flags
 * only vi.fn/vi.mock/vi.spyOn).
 */

import { describe, test, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { log, configureLogger } from '../logger';

describe('logger writes JSON lines to stdout', () => {
  test('a log() call emits a parseable JSON line to stdout', () => {
    // Isolate file output to a tmp dir so the test never writes to the repo.
    configureLogger(mkdtempSync(join(tmpdir(), 'logtest-')));

    const captured: string[] = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      log('info', 'server_started', { trace_id: 'abc', port: 31415 });
    } finally {
      process.stdout.write = realWrite;
    }

    const joined = captured.join('');
    expect(joined).toContain('server_started');

    const line = joined.split('\n').find((l) => l.includes('server_started'));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('server_started');
    expect(parsed.port).toBe(31415);
    expect(parsed.trace_id).toBe('abc');
  });
});

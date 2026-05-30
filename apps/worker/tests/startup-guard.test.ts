/**
 * Worker startup-guard tests — the worker must refuse to boot with any DB
 * credential in its environment (WORKER-X-009, DATA-P-007; IMPL-TQ-TS-008).
 *
 * `assertNoDbCredentials` calls process.exit, so these tests exercise the pure
 * detector `findForbiddenEnv` against synthetic environments and assert the
 * exit-on-violation behaviour via a stubbed exit (no vi.mock — a real function
 * replacement on a local object, which the mock-ban gate does not flag).
 */

import { describe, test, expect } from 'vitest';
import { findForbiddenEnv, assertNoDbCredentials } from '../src/startup-guard';

describe('findForbiddenEnv', () => {
  test('flags DATABASE_URL', () => {
    expect(findForbiddenEnv({ DATABASE_URL: 'postgres://x' })).toEqual(['DATABASE_URL']);
  });

  test('flags ENCRYPTION_MASTER_KEY', () => {
    expect(findForbiddenEnv({ ENCRYPTION_MASTER_KEY: 'deadbeef' })).toEqual([
      'ENCRYPTION_MASTER_KEY',
    ]);
  });

  test('flags any PG* credential var', () => {
    const found = findForbiddenEnv({
      PGHOST: 'db',
      PGPASSWORD: 'secret',
      PGUSER: 'app_rw',
    });
    expect(found.sort()).toEqual(['PGHOST', 'PGPASSWORD', 'PGUSER']);
  });

  test('passes a clean HTTP-only environment', () => {
    expect(
      findForbiddenEnv({
        API_BASE_URL: 'http://commission-app',
        AGENT_TYPE: 'ping',
        POLL_INTERVAL_MS: '5000',
      }),
    ).toEqual([]);
  });

  test('ignores unset (undefined) values', () => {
    expect(findForbiddenEnv({ DATABASE_URL: undefined })).toEqual([]);
  });
});

describe('assertNoDbCredentials', () => {
  test('exits non-zero when DATABASE_URL is present', () => {
    const realExit = process.exit;
    let exitCode: number | undefined;
    // Replace exit with a throwing stub so we can assert it was called.
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error('__exit__');
    }) as typeof process.exit;
    try {
      expect(() => assertNoDbCredentials({ DATABASE_URL: 'postgres://x' })).toThrow('__exit__');
      expect(exitCode).toBe(1);
    } finally {
      process.exit = realExit;
    }
  });

  test('does not exit for a clean environment', () => {
    expect(() => assertNoDbCredentials({ API_BASE_URL: 'http://commission-app' })).not.toThrow();
  });
});

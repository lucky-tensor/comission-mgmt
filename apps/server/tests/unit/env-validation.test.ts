/**
 * Env fail-fast tests — the server must refuse to boot when a required secret
 * or connection string is missing, rather than silently running with an
 * insecure default (DEPLOY env fail-fast).
 *
 * Exercises the pure detector `findMissingEnv` and the exit-on-missing
 * behaviour of `assertRequiredEnv` via a stubbed process.exit (a local function
 * swap, not a mock).
 */

import { describe, test, expect } from 'vitest';
import { findMissingEnv, assertRequiredEnv, REQUIRED_ENV_VARS } from '../../src/config/env';

const FULL = {
  DATABASE_URL: 'postgres://x',
  JWT_SECRET: 's',
  ENCRYPTION_MASTER_KEY: 'k',
};

describe('findMissingEnv', () => {
  test('reports nothing when all required vars are set', () => {
    expect(findMissingEnv(FULL)).toEqual([]);
  });

  test('reports each missing required var', () => {
    expect(findMissingEnv({}).sort()).toEqual([...REQUIRED_ENV_VARS].sort());
  });

  test('treats a blank value as missing', () => {
    expect(findMissingEnv({ ...FULL, JWT_SECRET: '   ' })).toEqual(['JWT_SECRET']);
  });

  test('demo mode relaxes all requirements', () => {
    expect(findMissingEnv({ DEMO_MODE: 'true' })).toEqual([]);
  });
});

describe('assertRequiredEnv', () => {
  test('exits non-zero with a clear message when a var is missing', () => {
    const realExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error('__exit__');
    }) as typeof process.exit;
    try {
      expect(() => assertRequiredEnv({ DATABASE_URL: 'postgres://x' })).toThrow('__exit__');
      expect(exitCode).toBe(1);
    } finally {
      process.exit = realExit;
    }
  });

  test('does not exit when the environment is complete', () => {
    expect(() => assertRequiredEnv(FULL)).not.toThrow();
  });
});

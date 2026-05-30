/**
 * Vitest configuration for tier progress unit tests.
 *
 * Covers:
 *   - Tier lookup: correct rate selected for any production level
 *   - Production sum arithmetic: passed through unchanged
 *   - remaining_to_next_tier computation
 *   - Top-tier edge case: remaining_to_next_tier is null
 *
 * No database required — pure in-memory assertions.
 *
 * Issue: feat: producer tier progress display (#17)
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const root = __dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: 'core/tier-progress', replacement: resolve(root, 'packages/core/tier-progress.ts') },
      { find: 'core', replacement: resolve(root, 'packages/core/index.ts') },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/engine/tier-progress/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

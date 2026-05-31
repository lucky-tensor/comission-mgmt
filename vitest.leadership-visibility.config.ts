/**
 * Vitest configuration for Leadership Visibility stub tests.
 *
 * Covers:
 *   - GET /analytics/executive stub returns 501
 *   - GET /analytics/team stub returns 501
 *
 * No DB container required — stubs are exercised directly.
 *
 * Issue: dev-scout: stub Leadership Visibility integration seams (#28)
 */
import { defineConfig } from 'vitest/config';
import { vitestAliases } from './vitest.aliases';

export default defineConfig({
  resolve: {
    alias: vitestAliases(__dirname),
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/api/leadership-visibility/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

/**
 * Vitest configuration for security-wiring integration tests (CSRF, rate
 * limiting, cookie posture). Requires an ephemeral Postgres container (Docker).
 *
 * These tests drive the full exported `fetchHandler`, so every db/* and core/*
 * subpath the server imports must be aliased here.
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
    include: ['apps/server/tests/integration/security/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

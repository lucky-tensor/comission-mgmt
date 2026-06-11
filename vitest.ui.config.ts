/**
 * Vitest configuration for the shared ui package's pure-logic unit tests.
 *
 * Covers the design-system layer's framework-independent logic (#203): the
 * StatusChip status→variant semantic mapping and any token-derived helpers.
 * These are plain functions — no DOM, no Postgres — so they run fast in node
 * and gate the semantic palette contract every surface depends on.
 *
 * Run: `bun run test:ui`
 * Issue: feat: webapp — UX overhaul: design-system pass (#203)
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
    include: ['packages/ui/tests/**/*.test.ts'],
  },
});

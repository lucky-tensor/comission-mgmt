/**
 * Vitest configuration for Web App UX phase routing-seam unit tests — #201.
 *
 * Covers the role routing seam contract (apps/web/tests/roleRoutes.test.ts):
 * landing/permitted invariants and the nav/permitted invariant that downstream
 * Web App UX issues (#197 docs route, #198 nav cleanup) must not violate.
 *
 * Pure node — no Postgres, no browser. The routing seam is plain data + helpers,
 * so these tests run fast and gate every route/nav edit in the phase.
 *
 * Canonical docs: docs/web-app-ux.md — routing seam contract; issue #201
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
    include: ['apps/web/tests/**/*.test.ts'],
  },
});

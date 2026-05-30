/**
 * Vitest browser-mode config — the project's headless-Chromium harness.
 *
 * Runs the React component tests (tests/component) and the producer-portal E2E
 * user-story test (tests/e2e) inside a REAL headless Chromium via the Playwright
 * provider (TEST-D-004 / IMPL-TEST-002 — never JSDOM/Happy DOM).
 *
 * The E2E test drives the actual portal UI against the real API server started
 * by tests/e2e/global-setup.ts (real ephemeral Postgres). The Vitest dev server
 * proxies `/api` to that server, stripping the prefix exactly as the app's Vite
 * proxy does in production-dev.
 *
 * Run: `bun run test:browser`
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const root = __dirname;
const apiTarget = `http://localhost:${process.env.E2E_SERVER_PORT ?? 31999}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // core lives flat at packages/core/*.ts: index first, then a catch-all.
      { find: /^core$/, replacement: resolve(root, 'packages/core/index.ts') },
      { find: /^core\/(.+)$/, replacement: resolve(root, 'packages/core') + '/$1.ts' },
      // db/* subpaths before the catch-all.
      // db root-level entry points (live at packages/db/*.ts, not src/).
      { find: 'db/revocation', replacement: resolve(root, 'packages/db/revocation.ts') },
      { find: 'db/migrate', replacement: resolve(root, 'packages/db/migrate.ts') },
      { find: 'db/ssl', replacement: resolve(root, 'packages/db/ssl.ts') },
      { find: 'db/task-queue', replacement: resolve(root, 'packages/db/task-queue.ts') },
      { find: 'db/worker-tokens', replacement: resolve(root, 'packages/db/worker-tokens.ts') },
      { find: 'db/seed', replacement: resolve(root, 'packages/db/seed.ts') },
      { find: 'db/passkeys', replacement: resolve(root, 'packages/db/passkeys.ts') },
      { find: 'db/pg-container', replacement: resolve(root, 'packages/db/pg-container.ts') },
      { find: /^db\/index$/, replacement: resolve(root, 'packages/db/index.ts') },
      // Every other db/<name> subpath resolves to packages/db/src/<name>.ts.
      { find: /^db\/(.+)$/, replacement: resolve(root, 'packages/db/src') + '/$1.ts' },
      { find: /^db$/, replacement: resolve(root, 'packages/db/index.ts') },
    ],
  },
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globalSetup: ['./tests/e2e/global-setup.ts'],
    setupFiles: ['./tests/component/setup.ts'],
    include: ['tests/component/**/*.test.tsx', 'tests/e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'chromium',
      headless: true,
      screenshotFailures: false,
    },
  },
});

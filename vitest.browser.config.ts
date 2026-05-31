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
import { vitestAliases } from './vitest.aliases';

const apiTarget = `http://localhost:${process.env.E2E_SERVER_PORT ?? 31999}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: vitestAliases(__dirname),
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

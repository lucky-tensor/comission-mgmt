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
 * The `/__e2e_fixture__` endpoint is served by a lightweight Vite plugin and
 * returns the JSON written by globalSetup (run IDs and fixture placement IDs).
 * Browser-side E2E tests fetch this endpoint at runtime so they can reference
 * dynamic IDs without needing vi.mock or globalThis hacks.
 *
 * Run: `bun run test:browser`
 * Issues:
 *   feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 *   test: E2E — Finance Admin month-end close (headless Chromium) (#117)
 */

import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { vitestAliases } from './vitest.aliases';

const apiTarget = `http://localhost:${process.env.E2E_SERVER_PORT ?? 31999}`;
const FIXTURE_PATH = resolve(__dirname, '.e2e-fixture.json');

/**
 * Vite plugin that serves the E2E fixture JSON (written by globalSetup) at
 * `GET /__e2e_fixture__` so browser-side tests can fetch dynamic seed IDs
 * without vi.mock or process.env hacks.
 */
function e2eFixturePlugin(): Plugin {
  return {
    name: 'e2e-fixture-server',
    configureServer(server) {
      server.middlewares.use('/__e2e_fixture__', (_req, res) => {
        const body = existsSync(FIXTURE_PATH)
          ? readFileSync(FIXTURE_PATH, 'utf-8')
          : JSON.stringify({});
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), e2eFixturePlugin()],
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
    // Raise the assertion timeout for expect.element() calls from the default
    // 1 second to 10 seconds so that API-driven UI updates (which go through
    // the proxy → real server → DB) have enough time to settle in CI.
    expect: { timeout: 10_000 },
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'chromium',
      headless: true,
      screenshotFailures: false,
    },
  },
});

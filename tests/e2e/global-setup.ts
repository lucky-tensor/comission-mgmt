/**
 * Vitest globalSetup for the browser/E2E harness (Bun runtime side — owns all
 * infra per IMPL-TEST-003).
 *
 * Boots a real, ephemeral stack for the E2E user-story tests:
 *   1. start an isolated postgres:16 container (db/pg-container),
 *   2. migrate + seed the producer persona into it (real handlers, real crypto),
 *   3. spawn the actual API server (apps/server/src/index.ts) as a subprocess
 *      bound to that database, with DEMO_MODE=true (demo login) and
 *      CSRF_DISABLED=true (the double-submit cookie requires Secure/HTTPS which
 *      the local HTTP harness can't set; the apiClient's CSRF wiring is still
 *      exercised — it just isn't enforced here),
 *   4. wait until /readyz is green.
 *   5. seed the finance-close fixture (commission run + invoice + AR discrepancy).
 *
 * The server listens on E2E_SERVER_PORT (default 31999); the Vitest dev server
 * proxies /api there (see vitest.browser.config.ts). Teardown stops both.
 *
 * Component tests do not need this stack — they render presentational
 * components with in-test data — but globalSetup is cheap to share and the E2E
 * tests depend on it.
 *
 * Issues:
 *   feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 *   test: E2E — Finance Admin month-end close (headless Chromium) (#117)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrateAndSeedIdentities, seedViaHttp } from './fixtures/seed-producer';
import { seedFinanceClose } from './fixtures/seed-finance-close';

const PORT = Number(process.env.E2E_SERVER_PORT ?? 31999);
const ROOT = resolve(__dirname, '../..');

let pg: PgContainer | undefined;
let server: ChildProcess | undefined;

async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}

export async function setup(): Promise<void> {
  pg = await startPostgres();
  // Phase 1: schema + unencrypted identity rows (pre-server).
  await migrateAndSeedIdentities(pg.url);

  server = spawn('bun', ['run', 'apps/server/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: pg.url,
      AUDIT_DATABASE_URL: pg.url,
      ANALYTICS_DATABASE_URL: pg.url,
      DEMO_MODE: 'true',
      CSRF_DISABLED: 'true',
      SECURE_COOKIES: 'false',
      NODE_ENV: 'test',
    },
    stdio: 'inherit',
  });

  await waitForReady(`http://localhost:${PORT}/readyz`);

  // Phase 2: seed the producer's encrypted commission data through the running
  // server so its process-local DEK encrypts it (the test's reads then decrypt).
  await seedViaHttp(`http://localhost:${PORT}`, pg.url);

  // Phase 3: seed the finance-close fixture (incomplete placement, commission
  // run, ledger invoice, AR discrepancy). IDs are shared with the browser-side
  // test via a JSON file in the OS temp directory that the browser context reads
  // through the /api/e2e-fixture proxy (see vitest.browser.config.ts proxy config).
  // Simpler: write to a well-known path and expose via a static server route.
  //
  // We use process.env since globalSetup shares the Node/Bun process with the
  // Vitest orchestrator — env vars set here ARE visible to setupFiles.
  const closeFixture = await seedFinanceClose(`http://localhost:${PORT}`, pg.url);
  process.env.E2E_CLOSE_RUN_ID = closeFixture.runId;
  process.env.E2E_CLOSE_INCOMPLETE_PLACEMENT_ID = closeFixture.incompletePlacementId;

  // Also write to a JSON file so the browser-side test can fetch it via the
  // /api/e2e-fixture endpoint (served by the test API server if available) or
  // the Vite dev server plugin below.
  const fixtureJson = JSON.stringify({
    closeRunId: closeFixture.runId,
    closeIncompletePlacementId: closeFixture.incompletePlacementId,
  });
  const fixturePath = resolve(ROOT, '.e2e-fixture.json');
  writeFileSync(fixturePath, fixtureJson, 'utf-8');
}

export async function teardown(): Promise<void> {
  if (server && !server.killed) server.kill('SIGTERM');
  await pg?.stop();
}

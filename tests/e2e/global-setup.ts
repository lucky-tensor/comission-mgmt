/**
 * Vitest globalSetup for the browser/E2E harness.
 *
 * Boots a real, ephemeral stack:
 *   1. start an isolated postgres:16 container
 *   2. Phase 1: migrate + seed identity rows
 *   3. spawn the API server bound to that database
 *   4. wait for /readyz
 *   5. Phase 2: seed all encrypted commission data via HTTP API
 *   6. write .e2e-fixture.json for the browser tests
 *
 * Canonical: docs/prd.md — Demo seed script
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { seedIdentities, seedEncrypted } from '../../scripts/shared-seed/index.js';

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
  await seedIdentities(pg.url);

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

  // Phase 2: seed encrypted commission data through the running server so its
  // in-memory DEK cache can decrypt the data on subsequent reads.
  const fixture = await seedEncrypted(`http://localhost:${PORT}`, pg.url);

  writeFileSync(resolve(ROOT, '.e2e-fixture.json'), JSON.stringify(fixture), 'utf-8');
}

export async function teardown(): Promise<void> {
  if (server && !server.killed) server.kill('SIGTERM');
  await pg?.stop();
}

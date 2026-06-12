/**
 * .ui-review-boot.ts — untracked helper for a UI design review session.
 * Boots the same ephemeral stack as tests/e2e/global-setup.ts but stays alive:
 *   postgres container -> identity seed -> API server (DEMO_MODE) -> encrypted seed.
 * Kill with SIGTERM to tear down.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { seedIdentities, seedEncrypted } from './scripts/shared-seed/index.js';

const PORT = Number(process.env.E2E_SERVER_PORT ?? 31999);
const ROOT = import.meta.dir;

async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server not ready at ${url}`);
}

let pg: PgContainer | undefined;
let server: ChildProcess | undefined;

async function main() {
  pg = await startPostgres();
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
  const fixture = await seedEncrypted(`http://localhost:${PORT}`, pg.url);
  writeFileSync(resolve(ROOT, '.e2e-fixture.json'), JSON.stringify(fixture), 'utf-8');
  console.log('UI_REVIEW_STACK_READY port=' + PORT);

  const shutdown = async () => {
    if (server && !server.killed) server.kill('SIGTERM');
    await pg?.stop();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  // stay alive
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

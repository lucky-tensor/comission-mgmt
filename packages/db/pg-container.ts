/**
 * DIY Testcontainers — spins up an isolated postgres:16 Docker container
 * and tears it down on request. Used by both the test suite and studio mode.
 *
 * Usage:
 *   const pg = await startPostgres();
 *   // pg.url — DATABASE_URL for this container
 *   // pg.containerId — for reference
 *   // pg.stop() — removes the container
 */

import postgres from 'postgres';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { cleanupStaleContainers, addProcess, removeProcess } from './cleanup';

const PG_USER = 'superfield';
const PG_PASSWORD = 'superfield';
const PG_DB = 'superfield';
const PG_IMAGE = 'postgres:16';
const DEFAULT_READY_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = readReadyTimeoutMs();
const PORT_POLL_INTERVAL_MS = 250;

export interface PgContainer {
  url: string;
  containerId: string;
  stop: () => Promise<void>;
}

export async function startPostgres(): Promise<PgContainer> {
  const startedAt = Date.now();
  logPg(`startup begin timeout=${READY_TIMEOUT_MS}ms`);
  logPg('cleaning up stale containers');
  cleanupStaleContainers();
  logPg(`cleanup complete in ${elapsedMs(startedAt)}ms`);
  logPg('starting docker container');
  const networkArgs = getDockerNetworkArgs();
  if (networkArgs.length) {
    logPg(`using network args: ${networkArgs.join(' ')}`);
  }
  const runResult = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      ...networkArgs,
      '-e',
      `POSTGRES_USER=${PG_USER}`,
      '-e',
      `POSTGRES_PASSWORD=${PG_PASSWORD}`,
      '-e',
      `POSTGRES_DB=${PG_DB}`,
      PG_IMAGE,
    ],
    { encoding: 'utf8' },
  );

  if (runResult.status !== 0) {
    throw new Error(`Failed to start postgres container: ${runResult.stderr}`);
  }

  const containerId = runResult.stdout.trim();
  logPg(`docker run complete container=${containerId} in ${elapsedMs(startedAt)}ms`);
  addProcess(containerId, 'postgres');

  let address: string;
  try {
    logPg(`waiting for container ip container=${containerId}`);
    address = await getContainerAddressWithRetry(containerId);
    logPg(
      `container ip ready container=${containerId} address=${address} in ${elapsedMs(startedAt)}ms`,
    );
    logPg(`waiting for postgres readiness container=${containerId} address=${address}:5432`);
    await waitForPostgres(address);
    logPg(
      `postgres ready container=${containerId} address=${address}:5432 in ${elapsedMs(startedAt)}ms`,
    );
  } catch (err) {
    removeProcess(containerId);
    spawnSync('docker', ['stop', containerId], { encoding: 'utf8' });
    throw err;
  }

  const url = `postgres://${PG_USER}:${PG_PASSWORD}@${address}:5432/${PG_DB}`;

  return {
    url,
    containerId,
    stop: async () => {
      removeProcess(containerId);
      spawnSync('docker', ['stop', containerId], { encoding: 'utf8' });
    },
  };
}

async function getContainerAddressWithRetry(containerId: string): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastProgressLogAt = 0;
  let lastAddressOutput = '';
  while (Date.now() < deadline) {
    const result = spawnSync(
      'docker',
      [
        'inspect',
        '-f',
        '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}',
        containerId,
      ],
      {
        encoding: 'utf8',
      },
    );
    const output = result.stdout.trim();
    lastAddressOutput = output;
    try {
      return parseDockerAddressOutput(output);
    } catch {
      const now = Date.now();
      if (now - lastProgressLogAt >= 5_000) {
        lastProgressLogAt = now;
        logPg(
          `waiting for docker inspect ip container=${containerId} (${deadline - now}ms remaining, output=${formatMaybeEmpty(lastAddressOutput)})`,
        );
      }
      await sleep(PORT_POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    `Timed out waiting for docker to resolve container IP for container ${containerId}. Last output: ${formatMaybeEmpty(lastAddressOutput)}`,
  );
}

async function waitForPostgres(host: string, port = 5432): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const url = `postgres://${PG_USER}:${PG_PASSWORD}@${host}:${port}/${PG_DB}`;
  let lastProgressLogAt = 0;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const testSql = postgres(url, { connect_timeout: 2 });
      await testSql`SELECT 1`;
      await testSql.end();
      return;
    } catch (err) {
      lastError = err;
      const now = Date.now();
      if (now - lastProgressLogAt >= 5_000) {
        lastProgressLogAt = now;
        logPg(
          `waiting for postgres login ${host}:${port} (${deadline - now}ms remaining, lastError=${formatError(lastError)})`,
        );
      }
      await sleep(300);
    }
  }
  throw new Error(
    `Postgres container did not become ready within ${READY_TIMEOUT_MS}ms at ${host}:${port}. Last error: ${formatError(lastError)}`,
  );
}

export function parseDockerPortOutput(output: string): number {
  if (!output.trim()) {
    throw new Error('Could not parse port from docker port output: ""');
  }
  const firstLine = output.split('\n')[0].trim();
  const port = parseInt(firstLine.split(':').at(-1) ?? '', 10);
  if (!Number.isFinite(port)) {
    throw new Error(`Could not parse port from docker port output: "${output}"`);
  }
  return port;
}

export function parseDockerAddressOutput(output: string): string {
  if (!output.trim()) {
    throw new Error('Could not parse address from docker inspect output: ""');
  }
  const firstLine = output.split('\n')[0].trim();
  if (!firstLine) {
    throw new Error(`Could not parse address from docker inspect output: "${output}"`);
  }
  return firstLine;
}

// When running inside a Docker container via a mounted socket (DinD), spawned
// containers are siblings on the host daemon. They land on the default bridge,
// which is unreachable from the runner's custom network. Connecting the new
// container to the same network as the current container fixes routing.
function getDockerNetworkArgs(): string[] {
  if (!existsSync('/.dockerenv')) return [];
  const hostname = process.env.HOSTNAME;
  if (!hostname) return [];
  const result = spawnSync(
    'docker',
    [
      'inspect',
      hostname,
      '--format',
      '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}\n{{end}}',
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !result.stdout.trim()) return [];
  const network = result.stdout.trim().split('\n')[0].trim();
  return network ? ['--network', network] : [];
}

function readReadyTimeoutMs(): number {
  const raw = process.env.PG_CONTAINER_READY_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_READY_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_READY_TIMEOUT_MS;
  }

  return Math.floor(parsed);
}

function logPg(message: string): void {
  console.info(`[pg-container] ${message}`);
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatMaybeEmpty(value: string): string {
  return value.trim() ? JSON.stringify(value) : '""';
}

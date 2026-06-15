#!/usr/bin/env bun
/**
 * local-demo.ts — Local Kubernetes demo runtime using k3d + cloudflared.
 *
 * Run via: bun run local-demo
 *
 * Lifecycle:
 *   1) Verify docker/k3d/kubectl/bun are installed and docker daemon is up
 *   2) Create/reuse a k3d cluster with a local registry
 *   3) Apply dev Postgres manifests and wait for readiness
 *   4) Run schema migration against the cluster Postgres (port-forward)
 *   5) Seed demo personas + commission demo data (port-forward, DEMO_MODE=true)
 *   6) Build latest app image (Dockerfile --target release) and import into k3d
 *   7) Apply demo app Service + Deployment + Ingress
 *   8) Wait for rollout; run smoke test (internal pod probe)
 *   9) Print public URL (commission-demo.superfield.co via host cloudflared)
 *  10) Enter interactive watch mode: Enter to redeploy, q to quit
 *
 * Flags:
 *   --status      Print cluster status and exit
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createConnection } from 'node:net';
import { newRunIdentity, dockerLabelFlags, k3dRuntimeLabelFlags } from 'db/docker-labels';

function pathHash(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) h = (Math.imul(31, h) + p.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16).slice(0, 6);
}

const REPO_ROOT = join(import.meta.dir, '..');
const INSTANCE_ID = pathHash(REPO_ROOT);
const CLUSTER_NAME = `commission-demo-${INSTANCE_ID}`;
const KUBECONFIG_PATH = process.env.KUBECONFIG ?? join(REPO_ROOT, `.k3d-kubeconfig-${INSTANCE_ID}`);
const NAMESPACE = 'default';

// Fixed port — matches the cloudflared host config entry for commission-demo.superfield.co.
const INGRESS_HOST_PORT = Number(process.env.COMMISSION_DEMO_PORT ?? 4600);
const DB_HOST_PORT = Number(
  process.env.COMMISSION_DEMO_DB_PORT ?? 10000 + Math.floor(Math.random() * 50000),
);
const PUBLIC_URL = `http://localhost:${INGRESS_HOST_PORT}`;
const PUBLIC_TUNNEL_URL = 'https://commission-demo.superfield.co';

// WebAuthn RP ID (registrable domain suffix) and origin derived from the tunnel
// URL so they stay in sync with the served domain.  The server reads these via
// getRpId() / getOrigin() in apps/server/src/auth/passkeys.ts:247-256.
const WEBAUTHN_RP_ID = new URL(PUBLIC_TUNNEL_URL).hostname;
const WEBAUTHN_ORIGIN = PUBLIC_TUNNEL_URL;

const APP_IMAGE = `commission-demo-app-${INSTANCE_ID}:dev`;
const APP_NAME = `commission-demo-app-${INSTANCE_ID}`;
const APP_SERVICE = `commission-demo-app-${INSTANCE_ID}`;
const APP_SECRET = `commission-demo-secrets-${INSTANCE_ID}`;

// Zombie-detection identities. The cluster/app *names* stay keyed on INSTANCE_ID
// (the reuse path depends on stable names), but we stamp every k3d node
// container and built image with run-id + created-unix + host-pid labels so the
// reaper (scripts/reap-zombies.ts) can tell a healthy current resource from a
// straggler left by a crashed run. INSTANCE_ID seeds the run-id for readability.
const K3D_RUN = newRunIdentity('demo-k3d', INSTANCE_ID);
const IMAGE_RUN = newRunIdentity('demo-app-image', INSTANCE_ID);

const WATCH_DIRS = ['apps/web', 'apps/server', 'apps/worker', 'packages'];

// In-cluster DB URL (used by the app pod)
const APP_DB_URL = 'postgres://app_rw:app_rw_password@commission-dev-postgres:5432/commission_app';
// Host-side DB URL (used by migration runner over port-forward)
const HOST_DB_URL = `postgres://app_rw:app_rw_password@localhost:${DB_HOST_PORT}/commission_app`;

process.env.KUBECONFIG = KUBECONFIG_PATH;

function run(cmd: string, options?: { cwd?: string; stdio?: 'inherit' | 'pipe' }): string {
  try {
    const out = execSync(cmd, {
      cwd: options?.cwd ?? REPO_ROOT,
      stdio: options?.stdio === 'inherit' ? 'inherit' : 'pipe',
      encoding: 'utf-8',
      env: { ...process.env },
    });
    return typeof out === 'string' ? out.trim() : '';
  } catch (err) {
    const execErr = err as { stderr?: string | Buffer };
    const stderr =
      execErr.stderr instanceof Buffer ? execErr.stderr.toString('utf-8') : (execErr.stderr ?? '');
    throw new Error(`Command failed: ${cmd}\n${stderr}`, { cause: err });
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe', env: { ...process.env } });
    return true;
  } catch {
    return false;
  }
}

function checkPrerequisites(): void {
  console.log('\nChecking prerequisites...');
  const missing: string[] = [];

  if (!commandExists('docker')) missing.push('docker');
  if (!commandExists('k3d')) missing.push('k3d');
  if (!commandExists('kubectl')) missing.push('kubectl');
  if (!commandExists('bun')) missing.push('bun');

  if (missing.length > 0) {
    console.error(`Missing prerequisites: ${missing.join(', ')}`);
    process.exit(1);
  }

  try {
    run('docker info');
  } catch {
    console.error('Docker daemon is not running. Start Docker and retry.');
    process.exit(1);
  }

  console.log('  All prerequisites found.');
}

function clusterExists(): boolean {
  try {
    const output = run('k3d cluster list -o json');
    const list = JSON.parse(output) as Array<{ name: string }>;
    return list.some((cluster) => cluster.name === CLUSTER_NAME);
  } catch {
    return false;
  }
}

function teardownCluster(): void {
  console.log('\nTearing down demo cluster...');
  if (!clusterExists()) {
    console.log(`  k3d cluster ${CLUSTER_NAME} is not present.`);
    return;
  }

  try {
    run(`k3d cluster delete ${CLUSTER_NAME}`, { stdio: 'inherit' });
  } catch (err) {
    console.error(
      `  Failed to delete cluster: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function ensureCluster(): void {
  if (!clusterExists()) {
    console.log(`\nCreating k3d cluster ${CLUSTER_NAME}...`);
    run(
      `k3d cluster create ${CLUSTER_NAME} --port 0.0.0.0:${INGRESS_HOST_PORT}:80@loadbalancer ${k3dRuntimeLabelFlags(K3D_RUN)} --wait`,
      { stdio: 'inherit' },
    );
    // Wait for API server to be fully ready
    console.log('Waiting for API server to be ready...');
    execSync('sleep 5');
  } else {
    console.log(`\nk3d cluster ${CLUSTER_NAME} already exists. Reusing.`);
  }

  console.log('Writing kubeconfig...');
  // Use 'get' instead of 'write' as 'write' has a bug where it creates an empty file
  run(`k3d kubeconfig get ${CLUSTER_NAME} > ${KUBECONFIG_PATH}`, { stdio: 'inherit' });

  // Verify kubeconfig is valid
  const kubeconfigContent = run(`cat ${KUBECONFIG_PATH}`);
  if (!kubeconfigContent.includes('apiVersion') || !kubeconfigContent.includes('clusters:')) {
    throw new Error('Kubeconfig is empty or malformed');
  }
}

function applyPostgres(): void {
  console.log('\nApplying Postgres manifests...');
  run('kubectl apply -f k8s/dev/dev-secrets.yaml', { stdio: 'inherit' });
  run('kubectl apply -f k8s/dev/postgres.yaml', { stdio: 'inherit' });

  console.log('Waiting for Postgres rollout...');
  run(`kubectl rollout status statefulset/commission-dev-postgres -n ${NAMESPACE} --timeout=180s`, {
    stdio: 'inherit',
  });

  // Wait a bit longer for Postgres to fully initialize and accept connections
  console.log('Waiting for Postgres to fully initialize...');
  execSync('sleep 3');
}

function waitForPort(host: string, port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ host, port });

      socket.once('connect', () => {
        socket.destroy();
        // Give the port a moment to fully stabilize after connect
        setTimeout(resolve, 500);
      });

      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 250);
      });

      socket.setTimeout(5000);
      socket.once('timeout', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

/**
 * withDbPortForward — opens a single kubectl port-forward to the cluster
 * Postgres, waits until the port is accepting connections, runs the callback,
 * then kills the forward.  Using one long-lived forward for both migration and
 * seeding avoids a race where a SIGTERM'd forward still holds the OS port while
 * the next spawn tries to bind the same number.
 */
async function withDbPortForward<T>(fn: () => T | Promise<T>): Promise<T> {
  console.log(
    `Starting temporary port-forward: svc/commission-dev-postgres ${DB_HOST_PORT}:5432 (namespace ${NAMESPACE})`,
  );

  const portForward = spawn(
    'kubectl',
    ['port-forward', 'svc/commission-dev-postgres', `${DB_HOST_PORT}:5432`, '-n', NAMESPACE],
    {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  portForward.stdout.on('data', (chunk) => {
    process.stdout.write(String(chunk));
  });
  portForward.stderr.on('data', (chunk) => {
    process.stderr.write(String(chunk));
  });

  try {
    await waitForPort('127.0.0.1', DB_HOST_PORT);
    // Give the port-forward extra time to stabilize
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return await fn();
  } finally {
    if (!portForward.killed) {
      portForward.kill('SIGTERM');
    }
  }
}

/**
 * withKubectlPortForward — generic kubectl port-forward that runs a callback
 * while the forward is active, then tears it down.
 */
async function withKubectlPortForward<T>(
  target: string,
  localPort: number,
  remotePort: number,
  fn: () => T | Promise<T>,
): Promise<T> {
  console.log(
    `Starting temporary port-forward: ${target} ${localPort}:${remotePort} (namespace ${NAMESPACE})`,
  );

  const portForward = spawn(
    'kubectl',
    ['port-forward', target, `${localPort}:${remotePort}`, '-n', NAMESPACE],
    { cwd: REPO_ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  portForward.stdout.on('data', (chunk) => process.stdout.write(String(chunk)));
  portForward.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));

  try {
    await waitForPort('127.0.0.1', localPort);
    return await fn();
  } finally {
    if (!portForward.killed) portForward.kill('SIGTERM');
  }
}

/**
 * runMigrationAndPhase1 — runs schema migration then Phase 1 (identity rows)
 * under a single shared port-forward.
 *
 * Phase 2 (encrypted commission data via HTTP API) runs AFTER the app is
 * deployed, because only the server's in-memory DEK cache can encrypt data
 * that it can later decrypt.
 *
 * Canonical: docs/prd.md — Demo seed script
 */
async function runMigrationAndPhase1(): Promise<void> {
  console.log('\nRunning database migration and Phase 1 (identities) against demo Postgres...');

  await withDbPortForward(() => {
    const HOST_ANALYTICS_URL = `postgres://app_rw:app_rw_password@localhost:${DB_HOST_PORT}/commission_analytics`;
    const HOST_AUDIT_URL = `postgres://app_rw:app_rw_password@localhost:${DB_HOST_PORT}/commission_audit`;

    run(
      `DATABASE_URL=${HOST_DB_URL} ANALYTICS_DATABASE_URL=${HOST_ANALYTICS_URL} AUDIT_DATABASE_URL=${HOST_AUDIT_URL} bun run packages/db/migrate.ts`,
      { stdio: 'inherit' },
    );

    run(`DEMO_MODE=true DATABASE_URL=${HOST_DB_URL} bun run scripts/demo-seed.ts`, {
      stdio: 'inherit',
    });
  });

  console.log('  Seeded demo identities (one user per role):');
  console.log('    - Finance Admin (FinanceAdmin)');
  console.log('    - Producer (Producer)');
  console.log('    - Manager (Manager)');
  console.log('    - Executive (Executive)');
  console.log('    - HR (HR)');
  console.log('    - External Partner (ExternalPartner)');
}

/**
 * seedPhase2 — seeds encrypted commission data through the running app's HTTP
 * API. Must be called AFTER the app is deployed and its ingress is reachable.
 *
 * Uses a temporary port-forward to the app Service so the Bun script can reach
 * the API from the host without the cloudflared tunnel being live.
 */
async function seedPhase2(): Promise<void> {
  console.log('\nSeeding Phase 2 (encrypted commission data) through app API...');

  const phase2Port = 30000 + Math.floor(Math.random() * 10000);
  const baseUrl = `http://127.0.0.1:${phase2Port}`;

  await withKubectlPortForward(`svc/${APP_SERVICE}`, phase2Port, 80, async () => {
    await withDbPortForward(() => {
      run(`BASE_URL=${baseUrl} DATABASE_URL=${HOST_DB_URL} bun run scripts/phase2-seed.ts`, {
        stdio: 'inherit',
      });
    });
  });

  console.log('  Phase 2 complete — encrypted commission data seeded.');
}

function buildAndImportImage(): void {
  console.log('\nBuilding app image from latest local code...');
  run(`docker build --target release ${dockerLabelFlags(IMAGE_RUN)} -t ${APP_IMAGE} .`, {
    stdio: 'inherit',
  });

  console.log(`Importing ${APP_IMAGE} into k3d cluster...`);
  run(`k3d image import ${APP_IMAGE} -c ${CLUSTER_NAME}`, { stdio: 'inherit' });
}

function applyDemoApp(): void {
  console.log('\nApplying demo app resources...');

  // Create the app secret (idempotent via --dry-run | apply)
  run(
    [
      `kubectl create secret generic ${APP_SECRET}`,
      `--from-literal=DATABASE_URL=${APP_DB_URL}`,
      `--from-literal=ANALYTICS_DATABASE_URL=postgres://analytics_w:analytics_w_dev_password@commission-dev-postgres:5432/commission_analytics`,
      `--from-literal=AUDIT_DATABASE_URL=postgres://audit_w:audit_w_dev_password@commission-dev-postgres:5432/commission_audit`,
      '--from-literal=JWT_SECRET=demo-dev-jwt-secret',
      '--from-literal=ENCRYPTION_MASTER_KEY=0000000000000000000000000000000000000000000000000000000000000001',
      `--from-literal=WEBAUTHN_RP_ID=${WEBAUTHN_RP_ID}`,
      `--from-literal=WEBAUTHN_ORIGIN=${WEBAUTHN_ORIGIN}`,
      '--dry-run=client -o yaml | kubectl apply -f -',
    ].join(' '),
    { stdio: 'inherit' },
  );

  const manifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP_NAME}
  labels:
    app: ${APP_NAME}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${APP_NAME}
  template:
    metadata:
      labels:
        app: ${APP_NAME}
    spec:
      containers:
        - name: app
          image: ${APP_IMAGE}
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 31415
          env:
            - name: PORT
              value: "31415"
            - name: DEMO_MODE
              value: "true"
            - name: CSRF_DISABLED
              value: "true"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${APP_SECRET}
                  key: DATABASE_URL
            - name: ANALYTICS_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${APP_SECRET}
                  key: ANALYTICS_DATABASE_URL
            - name: AUDIT_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${APP_SECRET}
                  key: AUDIT_DATABASE_URL
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: ${APP_SECRET}
                  key: JWT_SECRET
            - name: ENCRYPTION_MASTER_KEY
              valueFrom:
                secretKeyRef:
                  name: ${APP_SECRET}
                  key: ENCRYPTION_MASTER_KEY
            - name: WEBAUTHN_RP_ID
              valueFrom:
                secretKeyRef:
                  name: ${APP_SECRET}
                  key: WEBAUTHN_RP_ID
            - name: WEBAUTHN_ORIGIN
              valueFrom:
                secretKeyRef:
                  name: ${APP_SECRET}
                  key: WEBAUTHN_ORIGIN
          livenessProbe:
            httpGet:
              path: /healthz
              port: 31415
            initialDelaySeconds: 20
            periodSeconds: 20
            timeoutSeconds: 5
          readinessProbe:
            httpGet:
              path: /readyz
              port: 31415
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: ${APP_SERVICE}
  labels:
    app: ${APP_NAME}
spec:
  selector:
    app: ${APP_NAME}
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: 31415
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${APP_NAME}
  annotations:
    kubernetes.io/ingress.class: traefik
spec:
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${APP_SERVICE}
                port:
                  number: 80
`;

  run(`kubectl apply -f - <<'YAML'\n${manifest}\nYAML`, { stdio: 'inherit' });
}

function waitForAppReady(): void {
  console.log('\nWaiting for app rollout...');
  try {
    run(`kubectl rollout status deployment/${APP_NAME} -n ${NAMESPACE} --timeout=300s`, {
      stdio: 'inherit',
    });
  } catch (err) {
    // Collect diagnostics before failing
    console.error('\nRollout timed out. Collecting diagnostics...\n');
    try {
      const podStatus = run(`kubectl get pods -n ${NAMESPACE} -l app=${APP_NAME} -o wide`);
      console.error('--- Pod status ---\n' + podStatus);
    } catch {
      /* ignore */
    }
    try {
      const podLogs = run(`kubectl logs -n ${NAMESPACE} -l app=${APP_NAME} --tail=50 2>/dev/null`);
      if (podLogs) console.error('--- Pod logs (last 50 lines) ---\n' + podLogs);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * smokeTest — port-forwards to the app pod and probes /healthz from the host.
 * Distroless images have no shell, so kubectl exec is not available.
 */
async function smokeTest(): Promise<void> {
  console.log('\nRunning smoke test...');

  const smokePort = await new Promise<number>((resolve) => {
    // Pick a random high port for the temporary port-forward
    const p = 30000 + Math.floor(Math.random() * 10000);
    resolve(p);
  });

  const portForward = spawn(
    'kubectl',
    ['port-forward', `svc/${APP_SERVICE}`, `${smokePort}:80`, '-n', NAMESPACE],
    { cwd: REPO_ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  try {
    await waitForPort('127.0.0.1', smokePort, 15_000);
    const result = run(`curl -sf http://127.0.0.1:${smokePort}/healthz`);
    if (!result.includes('"status":"ok"') && !result.includes('"status": "ok"')) {
      throw new Error(`Smoke test: unexpected response: ${result.slice(0, 200)}`);
    }
    console.log('  Smoke test: OK');
  } finally {
    if (!portForward.killed) portForward.kill('SIGTERM');
  }
}

function waitForIngress(): void {
  console.log('\nWaiting for ingress route...');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      run(`curl -sSf -o /dev/null ${PUBLIC_URL}/healthz`);
      console.log(`  Demo URL reachable: ${PUBLIC_URL}`);
      return;
    } catch {
      try {
        execSync('sleep 1');
      } catch {
        // ignore
      }
    }
  }

  console.warn(`  Ingress did not respond within timeout: ${PUBLIC_URL}`);
}

function rolloutApp(): void {
  buildAndImportImage();
  run(`kubectl rollout restart deployment/${APP_NAME}`, { stdio: 'inherit' });
  waitForAppReady();
}

type RolloutAction = 'rollout' | 'all' | 'quit' | 'skip';

function promptRolloutAction(rl: ReadlineInterface): Promise<RolloutAction> {
  return new Promise((resolve) => {
    console.log('\nPress Enter to redeploy, q+Enter to quit, or s+Enter to skip:');
    rl.question('> ', (answer) => {
      const choice = answer.trim().toLowerCase();
      if (choice === 'q' || choice === 'quit') resolve('quit');
      else if (choice === 's' || choice === 'skip') resolve('skip');
      else if (choice === 'a' || choice === 'all') resolve('all');
      else resolve('rollout');
    });
  });
}

async function handleRolloutAction(action: RolloutAction): Promise<boolean> {
  if (action === 'quit') {
    return false;
  }

  if (action === 'rollout') {
    rolloutApp();
    return true;
  }

  if (action === 'all') {
    buildAndImportImage();
    applyDemoApp();
    waitForAppReady();
    waitForIngress();
    return true;
  }

  console.log('Skipped.');
  return true;
}

function startWatcher(rl: ReadlineInterface): void {
  console.log('\nWatching for file changes...');
  console.log('Press Ctrl+C to stop (cluster will be torn down on exit).\n');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let inPrompt = false;
  let pending = false;

  const schedulePrompt = () => {
    if (inPrompt) {
      pending = true;
      return;
    }

    inPrompt = true;
    void (async () => {
      const action = await promptRolloutAction(rl);
      const shouldContinue = await handleRolloutAction(action);
      inPrompt = false;
      if (!shouldContinue) {
        console.log('\nQuitting...');
        process.exit(0);
      }
      if (pending) {
        pending = false;
        schedulePrompt();
      }
    })();
  };

  for (const dir of WATCH_DIRS) {
    const fullPath = join(REPO_ROOT, dir);
    if (!existsSync(fullPath)) continue;

    watch(fullPath, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (filename.includes('node_modules') || filename.includes('dist')) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        schedulePrompt();
      }, 500);
    });
  }

  // Also respond to bare Enter presses from stdin
  (rl as unknown as import('node:events').EventEmitter).on('line', () => {
    schedulePrompt();
  });
}

async function main(): Promise<void> {
  console.log('\n=== Commission Management — Local Demo ===\n');

  const args = process.argv.slice(2);
  if (args.includes('--status')) {
    console.log(`k3d cluster '${CLUSTER_NAME}': ${clusterExists() ? 'running' : 'not found'}`);
    return;
  }

  checkPrerequisites();

  let teardownRan = false;
  const runTeardownOnce = () => {
    if (teardownRan) return;
    teardownRan = true;
    teardownCluster();
  };

  const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    console.log(`\nReceived ${signal}. Cleaning up...`);
    runTeardownOnce();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('exit', () => runTeardownOnce());

  ensureCluster();
  applyPostgres();
  await runMigrationAndPhase1();
  buildAndImportImage();
  applyDemoApp();
  waitForAppReady();
  waitForIngress();

  await seedPhase2();
  await smokeTest();

  const externalIps = Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface!.address);

  console.log('\n=== Demo Environment Ready ===');
  console.log(`  Local:      ${PUBLIC_URL}`);
  for (const ip of externalIps) {
    console.log(`  Network:    http://${ip}:${INGRESS_HOST_PORT}`);
  }
  console.log(`  KUBECONFIG: ${KUBECONFIG_PATH}`);

  console.log(`  Public URL: ${PUBLIC_TUNNEL_URL}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.on('exit', () => {
    try {
      rl.close();
    } catch {
      // ignore
    }
  });

  startWatcher(rl);
}

const meta = import.meta as unknown as { main?: boolean };
const isMainModule =
  typeof meta.main === 'boolean'
    ? meta.main
    : (process.argv[1]?.endsWith('local-demo.ts') ?? false);

if (isMainModule) {
  main().catch((err) => {
    console.error('\nDemo startup failed:');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

/**
 * Docker / k3d resource labelling — the single source of truth for how every
 * container, image, and cluster this project spins up is stamped so that
 * leftover "zombie" resources can be detected and reaped later.
 *
 * The problem this solves: container/cluster *names* alone cannot tell you who
 * created a resource, when, or whether the owning process is still alive. A
 * sidecar tracking file (see cleanup.ts) is fragile — a hard kill (SIGKILL)
 * never updates it. Docker/k3d *labels* survive a hard kill and are directly
 * queryable, so they are the durable primitive for zombie detection.
 *
 * Every resource we create carries:
 *   com.superfield.project       — fixed PROJECT, lets us enumerate all our objects
 *   com.superfield.component     — what kind of resource (Component)
 *   com.superfield.run-id        — unique per invocation (`<seed>-<unix>-<rand>`)
 *   com.superfield.created-unix  — creation time (epoch seconds) for TTL reaping
 *   com.superfield.host-pid      — owning process PID for liveness checks
 *
 * Consumers:
 *   - packages/db/pg-container.ts  (ephemeral test/studio Postgres containers)
 *   - scripts/local-demo.ts        (k3d demo cluster + built app image)
 *   - scripts/reap-zombies.ts      (the reaper)
 *   - packages/db/cleanup.ts       (label-based backstop sweep)
 */

export const LABEL_NAMESPACE = 'com.superfield';
export const LABEL_PROJECT = `${LABEL_NAMESPACE}.project`;
export const LABEL_COMPONENT = `${LABEL_NAMESPACE}.component`;
export const LABEL_RUN_ID = `${LABEL_NAMESPACE}.run-id`;
export const LABEL_CREATED_UNIX = `${LABEL_NAMESPACE}.created-unix`;
export const LABEL_HOST_PID = `${LABEL_NAMESPACE}.host-pid`;

/** Fixed project identifier shared by every resource we create. */
export const PROJECT = 'commission-mgmt';

/**
 * The kinds of resources we create on the host:
 *   pg-test        — ephemeral Postgres container (docker run)
 *   demo-k3d       — k3d cluster node containers (k3d runtime-label)
 *   demo-app-image — the demo app image built on the host (docker build)
 */
export type Component = 'pg-test' | 'demo-k3d' | 'demo-app-image';

export interface RunIdentity {
  component: Component;
  runId: string;
  createdUnix: number;
  hostPid: number;
}

/**
 * Mints a fresh identity for one invocation. `seed` lets callers fold in a
 * stable prefix (e.g. the repo path hash) so the run-id is both human-readable
 * and unique: `<seed>-<unix>-<rand>`.
 */
export function newRunIdentity(component: Component, seed?: string): RunIdentity {
  const createdUnix = Math.floor(Date.now() / 1000);
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  const prefix = seed ? `${seed}-` : '';
  return {
    component,
    runId: `${prefix}${createdUnix}-${rand}`,
    createdUnix,
    hostPid: process.pid,
  };
}

/** The label key/value pairs for a run, as a plain record. */
export function labelPairs(run: RunIdentity): Record<string, string> {
  return {
    [LABEL_PROJECT]: PROJECT,
    [LABEL_COMPONENT]: run.component,
    [LABEL_RUN_ID]: run.runId,
    [LABEL_CREATED_UNIX]: String(run.createdUnix),
    [LABEL_HOST_PID]: String(run.hostPid),
  };
}

/**
 * `--label k=v` arguments for `docker run` / `docker build`, as an argv array
 * suitable for spawnSync/spawn.
 */
export function dockerLabelArgs(run: RunIdentity): string[] {
  return Object.entries(labelPairs(run)).flatMap(([k, v]) => ['--label', `${k}=${v}`]);
}

/**
 * The same labels as a single shell-safe string for embedding in command
 * strings passed to execSync. All values are project constants, epoch integers,
 * a PID, or `[0-9a-f-]` ids — none contain whitespace or shell metacharacters.
 */
export function dockerLabelFlags(run: RunIdentity): string {
  return dockerLabelArgs(run).join(' ');
}

/**
 * k3d applies `--runtime-label KEY=VALUE@NODEFILTER` to the node *containers* it
 * creates (distinct from k8s `--k3s-node-label`). We target the server node so
 * each cluster has at least one container carrying our labels; k3d additionally
 * stamps its own `k3d.cluster=<name>` label, which the reaper reads to map a
 * zombie node container back to the cluster it should `k3d cluster delete`.
 */
export function k3dRuntimeLabelFlags(run: RunIdentity): string {
  return Object.entries(labelPairs(run))
    .map(([k, v]) => `--runtime-label ${k}=${v}@server:*`)
    .join(' ');
}

/** k3d's own label that ties a node container to its cluster. */
export const K3D_CLUSTER_LABEL = 'k3d.cluster';

/**
 * Liveness check for an owning process. Returns false if the PID is invalid or
 * no such process exists. Note: PIDs are reused by the OS, so a `true` here is
 * a heuristic — always pair it with a TTL (created-unix) when reaping.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs error checking without actually sending a signal.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by another user → alive.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

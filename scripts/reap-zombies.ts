/**
 * Zombie reaper: detect and remove stale k3d clusters and docker containers
 * that survived a hard kill (SIGKILL) and are no longer associated with live processes.
 *
 * Usage: bun run reap
 */

import { spawnSync } from 'node:child_process';
import {
  LABEL_HOST_PID,
  LABEL_CREATED_UNIX,
  LABEL_PROJECT,
  PROJECT,
  isPidAlive,
} from 'db/docker-labels';

const TTL_SECONDS = 86400; // 24 hours

interface DockerContainer {
  Id: string;
  Labels: Record<string, string> | null;
}

interface K3DCluster {
  name: string;
  nodes: Array<{
    container: string;
    labels: Record<string, string>;
  }>;
}

function listDockerContainers(): DockerContainer[] {
  const result = spawnSync(
    'docker',
    ['ps', '-a', '--filter', `label=${LABEL_PROJECT}=${PROJECT}`, '--format', 'json'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !result.stdout.trim()) return [];

  try {
    return JSON.parse(`[${result.stdout.trim().split('\n').join(',')}]`);
  } catch {
    return [];
  }
}

function listK3DClusters(): K3DCluster[] {
  const result = spawnSync('k3d', ['cluster', 'list', '-o', 'json'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) return [];

  try {
    const clusters = JSON.parse(result.stdout) as Array<{
      name: string;
      nodes: Array<{ container: string }>;
    }>;
    return clusters.map((c) => ({
      ...c,
      nodes: c.nodes.map((n) => ({
        ...n,
        labels: getDockerLabels(n.container),
      })),
    }));
  } catch {
    return [];
  }
}

function getDockerLabels(containerId: string): Record<string, string> {
  const result = spawnSync(
    'docker',
    ['inspect', '--format', '{{json .Config.Labels}}', containerId],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !result.stdout.trim()) return {};
  try {
    return JSON.parse(result.stdout) || {};
  } catch {
    return {};
  }
}

function isStale(labels: Record<string, string> | null): boolean {
  if (!labels) return true;
  const pidStr = labels[LABEL_HOST_PID];
  const unixStr = labels[LABEL_CREATED_UNIX];

  if (pidStr && isPidAlive(Number(pidStr))) return false;

  if (!unixStr) return true;
  const createdUnix = Number(unixStr);
  const ageSeconds = Math.floor(Date.now() / 1000) - createdUnix;
  return ageSeconds > TTL_SECONDS;
}

function reapDockerContainers(): void {
  const containers = listDockerContainers();
  let removed = 0;

  for (const container of containers) {
    if (isStale(container.Labels)) {
      console.log(`[reap] Removing docker container: ${container.Id.substring(0, 12)}`);
      spawnSync('docker', ['rm', '-f', container.Id], { encoding: 'utf8' });
      removed++;
    }
  }

  if (removed > 0) console.log(`[reap] Removed ${removed} docker container(s)`);
}

function reapK3DClusters(): void {
  const clusters = listK3DClusters();
  let removed = 0;

  for (const cluster of clusters) {
    for (const node of cluster.nodes) {
      if (isStale(node.labels)) {
        console.log(`[reap] Removing k3d cluster: ${cluster.name}`);
        spawnSync('k3d', ['cluster', 'delete', cluster.name], { encoding: 'utf8' });
        removed++;
        break;
      }
    }
  }

  if (removed > 0) console.log(`[reap] Removed ${removed} k3d cluster(s)`);
}

console.log('[reap] Starting zombie reaper...');
reapDockerContainers();
reapK3DClusters();
console.log('[reap] Done');

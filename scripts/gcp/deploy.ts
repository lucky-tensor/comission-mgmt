#!/usr/bin/env bun
/**
 * deploy.ts — Validate GCP resources, SSH-tunnel into the VM, obtain kubectl
 * access, and run deploy.sh for a health-gated commission-mgmt rollout.
 *
 * Usage:
 *   bun run deploy --project <project-id> --region <region> --zone <zone>
 *                  --environment <env> --vm-name <name> --tag <image-tag>
 *
 * Required configuration:
 *   --project / GCP_PROJECT_ID
 *   --region / GCP_REGION
 *   --zone / GCP_ZONE
 *   --environment / SUPERFIELD_ENV
 *   --vm-name / GCP_VM_NAME
 *   --alloydb-cluster / GCP_ALLOYDB_CLUSTER
 *   --alloydb-instance / GCP_ALLOYDB_INSTANCE
 *   --tag / SUPERFIELD_IMAGE_TAG
 *   SSH_AUTH_SOCK or SUPERFIELD_SSH_PRIVATE_KEY_FILE
 *
 * Flags:
 *   --check-only   Validate liveness and stop before deploy.sh
 *   --help         Show this message
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { join } from 'node:path';
import {
  buildSshOptions,
  createTempFile,
  ensureSshAuthMaterial,
  extractNatIp,
  getProjectNumber,
  googleJsonRequest,
  hasFlag,
  log,
  parseArgs,
  printHelp,
  requireCommands,
  resolveBooleanOption,
  resolveOption,
  resolveRequiredOption,
  runCommand,
  shellQuote,
  sshTarget,
  waitForTcpPort,
} from './common';
import { runDoctor } from './doctor';

interface ComputeInstance {
  status?: string;
  networkInterfaces?: Array<{ accessConfigs?: Array<{ natIP?: string }> }>;
}

interface AlloyCluster {
  state?: string;
}

interface AlloyInstance {
  state?: string;
  ipAddress?: string;
}

const helpText = `
Validate the Google Cloud VM and AlloyDB instance, prepare kube access, run
pre-deploy liveness checks, and deploy a given image tag.

Cluster access is obtained via an SSH tunnel (k3s kubeconfig through port 6443).

Required configuration:
  --project / GCP_PROJECT_ID
  --region / GCP_REGION
  --zone / GCP_ZONE
  --environment / SUPERFIELD_ENV
  --vm-name / GCP_VM_NAME
  --alloydb-cluster / GCP_ALLOYDB_CLUSTER
  --alloydb-instance / GCP_ALLOYDB_INSTANCE
  --tag / SUPERFIELD_IMAGE_TAG
  SSH_AUTH_SOCK or SUPERFIELD_SSH_PRIVATE_KEY_FILE

Flags:
  --check-only          Validate liveness and stop before deploy.sh
  --help                Show this message
`.trim();

export async function main(): Promise<void> {
  const args = parseArgs();
  if (args.flags.has('help')) {
    printHelp('scripts/gcp/deploy.ts', helpText);
    return;
  }

  requireCommands(['ssh', 'kubectl', 'bash']);

  const projectId = resolveRequiredOption(args, 'project', ['GCP_PROJECT_ID'], 'GCP project');
  const region = resolveRequiredOption(args, 'region', ['GCP_REGION'], 'GCP region');
  const zone = resolveRequiredOption(args, 'zone', ['GCP_ZONE'], 'GCP zone');
  const environment = resolveRequiredOption(args, 'environment', ['SUPERFIELD_ENV'], 'Environment');
  const vmName = resolveRequiredOption(args, 'vm-name', ['GCP_VM_NAME'], 'VM name');
  const alloyCluster = resolveRequiredOption(
    args,
    'alloydb-cluster',
    ['GCP_ALLOYDB_CLUSTER'],
    'AlloyDB cluster',
  );
  const alloyInstance = resolveRequiredOption(
    args,
    'alloydb-instance',
    ['GCP_ALLOYDB_INSTANCE'],
    'AlloyDB instance',
  );
  const imageTag = resolveRequiredOption(args, 'tag', ['SUPERFIELD_IMAGE_TAG'], 'Image tag');
  const namespace = resolveOption(
    args,
    'namespace',
    ['DEPLOY_NAMESPACE'],
    `commission-${environment}`,
  )!;
  const serviceAccountName = resolveOption(
    args,
    'service-account',
    ['DEPLOY_SA_NAME'],
    'commission-deployer',
  )!;
  const sshUser = resolveOption(args, 'ssh-user', ['DEPLOY_SSH_USER'], 'root')!;
  const checkOnly = hasFlag(args, 'check-only');
  const skipHttpCheck = resolveBooleanOption(
    args,
    'skip-http-check',
    ['SUPERFIELD_SKIP_HTTP_CHECK'],
    false,
  );

  const sshAuth = ensureSshAuthMaterial();
  const scriptDir = import.meta.dir ?? join(process.cwd(), 'scripts', 'gcp');
  const repoRoot = join(scriptDir, '..', '..');

  try {
    const doctor = await runDoctor({
      mode: 'deploy',
      projectId,
      quiet: true,
    });
    if (!doctor.ok) {
      throw new Error(
        `Doctor failed. Missing permissions: ${doctor.missingPermissions.join(', ') || 'none'}`,
      );
    }

    await getProjectNumber(projectId);

    const compute = await googleJsonRequest<ComputeInstance>(
      `https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances/${vmName}`,
    );
    if (!compute || compute.status !== 'RUNNING') {
      throw new Error(`Compute Engine VM ${vmName} is not RUNNING`);
    }

    const hostIp = extractNatIp(compute);
    if (!hostIp) {
      throw new Error(`Compute Engine VM ${vmName} has no external IP`);
    }

    const cluster = await googleJsonRequest<AlloyCluster>(
      `https://alloydb.googleapis.com/v1/projects/${projectId}/locations/${region}/clusters/${alloyCluster}`,
    );
    if (!cluster || cluster.state !== 'READY') {
      throw new Error(`AlloyDB cluster ${alloyCluster} is not READY`);
    }

    const instance = await googleJsonRequest<AlloyInstance>(
      `https://alloydb.googleapis.com/v1/projects/${projectId}/locations/${region}/clusters/${alloyCluster}/instances/${alloyInstance}`,
    );
    if (!instance || instance.state !== 'READY' || !instance.ipAddress) {
      throw new Error(`AlloyDB instance ${alloyInstance} is not READY`);
    }

    await runDeploySsh({
      sshAuth,
      sshUser,
      hostIp,
      alloyIp: instance.ipAddress,
      namespace,
      serviceAccountName,
      imageTag,
      checkOnly,
      skipHttpCheck,
      repoRoot,
    });
  } finally {
    sshAuth.cleanup();
  }
}

export async function runDeploySsh(config: {
  sshAuth: ReturnType<typeof ensureSshAuthMaterial>;
  sshUser: string;
  hostIp: string;
  alloyIp: string;
  namespace: string;
  serviceAccountName: string;
  imageTag: string;
  checkOnly: boolean;
  skipHttpCheck: boolean;
  repoRoot: string;
}): Promise<void> {
  const { sshAuth, sshUser, hostIp, alloyIp, namespace, serviceAccountName } = config;

  await runSsh(sshAuth, sshUser, hostIp, 'true');
  await verifyDatabasePath(sshAuth, sshUser, hostIp, alloyIp);

  const tunnelProcess = startTunnel(sshAuth, sshUser, hostIp);
  try {
    await waitForTcpPort('127.0.0.1', 6443, 15_000);

    const deployToken = (
      await runSsh(
        sshAuth,
        sshUser,
        hostIp,
        `kubectl create token ${shellQuote(serviceAccountName)} --namespace ${shellQuote(namespace)} --duration=1h`,
      )
    ).trim();
    const caData = (
      await runSsh(
        sshAuth,
        sshUser,
        hostIp,
        `kubectl config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}'`,
      )
    ).trim();

    const kubeconfigFile = createTempFile(
      'kubeconfig',
      buildKubeconfig({
        namespace,
        token: deployToken,
        caData,
      }),
    );

    try {
      const kubectlEnv = {
        KUBECONFIG: kubeconfigFile.path,
        DEPLOY_HOST: hostIp,
        DEPLOY_NAMESPACE: namespace,
        APP_DEPLOYMENT: 'commission-app',
        APP_CONTAINER_NAME: 'app',
        API_URL: `http://${hostIp}:31415/healthz`,
      };

      runLivenessChecks(kubectlEnv, namespace);

      if (!config.skipHttpCheck) {
        log(`Checking current app health at http://${hostIp}:31415/healthz`);
        const response = await fetch(`http://${hostIp}:31415/healthz`);
        if (!response.ok) {
          throw new Error(`Current deployment health check failed with HTTP ${response.status}`);
        }
      }

      if (config.checkOnly) {
        log('Pre-deploy checks passed. --check-only set; skipping deploy.sh.');
        return;
      }

      log(`Deploying image tag ${config.imageTag}`);
      runCommand(['bash', './deploy.sh', config.imageTag], {
        cwd: config.repoRoot,
        env: kubectlEnv,
      });

      maybeAnnotateDeployment(kubectlEnv, namespace, config.imageTag);
    } finally {
      kubeconfigFile.cleanup();
    }
  } finally {
    tunnelProcess.kill();
    await tunnelProcess.exited;
  }
}

export function runLivenessChecks(kubectlEnv: Record<string, string>, namespace: string): void {
  runCommand(['kubectl', 'get', 'namespace', namespace], { env: kubectlEnv });
  runCommand(['kubectl', 'get', 'secret', 'superfield-api-secrets', '-n', namespace], {
    env: kubectlEnv,
  });
  runCommand(['kubectl', 'get', 'deployment', 'commission-app', '-n', namespace], {
    env: kubectlEnv,
  });
  runCommand(
    ['kubectl', 'rollout', 'status', 'deployment/commission-app', '-n', namespace, '--timeout=60s'],
    { env: kubectlEnv },
  );
}

export async function runSsh(
  sshAuth: ReturnType<typeof ensureSshAuthMaterial>,
  sshUser: string,
  hostIp: string,
  command: string,
): Promise<string> {
  const result = runCommand([
    ...buildSshOptions(sshAuth),
    sshTarget(sshUser, hostIp),
    'bash',
    '-lc',
    command,
  ]);
  return result.stdout;
}

export async function verifyDatabasePath(
  sshAuth: ReturnType<typeof ensureSshAuthMaterial>,
  sshUser: string,
  hostIp: string,
  alloyIp: string,
): Promise<void> {
  log(`Checking TCP reachability from ${sshUser}@${hostIp} to AlloyDB ${alloyIp}:5432`);
  await runSsh(sshAuth, sshUser, hostIp, `timeout 5 bash -lc 'echo >/dev/tcp/${alloyIp}/5432'`);
}

export function startTunnel(
  sshAuth: ReturnType<typeof ensureSshAuthMaterial>,
  sshUser: string,
  hostIp: string,
) {
  const args = [
    ...buildSshOptions(sshAuth),
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-o',
    'ExitOnForwardFailure=yes',
    '-N',
    '-L',
    '6443:localhost:6443',
    sshTarget(sshUser, hostIp),
  ];
  const child = nodeSpawn(args[0], args.slice(1), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const exited = new Promise<number>((resolve) => {
    (child as unknown as import('node:events').EventEmitter).on('close', (code: number | null) =>
      resolve(code ?? 1),
    );
  });
  return { kill: () => child.kill(), exited };
}

export function maybeAnnotateDeployment(
  kubectlEnv: Record<string, string>,
  namespace: string,
  imageTag: string,
): void {
  const actor = process.env.GITHUB_ACTOR;
  const runId = process.env.GITHUB_RUN_ID;
  if (!actor || !runId) return;

  runCommand(
    [
      'kubectl',
      'annotate',
      'deployment/commission-app',
      '--namespace',
      namespace,
      '--overwrite',
      `deploy.commission/actor=${actor}`,
      `deploy.commission/run-id=${runId}`,
      `deploy.commission/image-tag=${imageTag}`,
      `deploy.commission/timestamp=${new Date().toISOString()}`,
    ],
    { env: kubectlEnv },
  );
}

export function buildKubeconfig(config: {
  namespace: string;
  token: string;
  caData: string;
}): string {
  return `apiVersion: v1
kind: Config
clusters:
  - cluster:
      server: https://localhost:6443
      certificate-authority-data: ${config.caData}
    name: k3s
contexts:
  - context:
      cluster: k3s
      namespace: ${config.namespace}
      user: deployer
    name: deploy
current-context: deploy
users:
  - name: deployer
    user:
      token: ${config.token}
`;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

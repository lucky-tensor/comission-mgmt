#!/usr/bin/env bun
/**
 * doctor.ts — Validate GCP credentials, project access, required APIs,
 * and IAM permissions before running deploy.
 *
 * Usage:
 *   bun run scripts/gcp/doctor.ts --project <project-id>
 *
 * Credential sources (resolution order):
 *   1. GCP_ACCESS_TOKEN
 *   2. GCP_OAUTH_TOKEN_FILE (default: ~/.config/superfield/gcp-oauth-token.json)
 *   3. GCP_SERVICE_ACCOUNT_JSON
 *   4. GOOGLE_APPLICATION_CREDENTIALS
 *   5. GCP_SERVICE_ACCOUNT_FILE
 *   6. GCP_SERVICE_ACCOUNT_KEY_JSON
 *   7. GCP_SERVICE_ACCOUNT_KEY_FILE
 *
 * GCP provisioning is handled externally. This doctor checks deploy-only permissions.
 */

import {
  getGoogleCredentialInfo,
  getGoogleAccessToken,
  getProjectNumber,
  googleJsonRequest,
  log,
  parseArgs,
  printHelp,
  resolveRequiredOption,
} from './common';

interface DoctorConfig {
  projectId: string;
  quiet?: boolean;
}

interface PermissionCheckResponse {
  permissions?: string[];
}

interface ProjectResponse {
  projectId?: string;
  projectNumber?: string;
  lifecycleState?: string;
  name?: string;
}

interface DoctorResult {
  credential: ReturnType<typeof getGoogleCredentialInfo>;
  disabledServices: string[];
  missingPermissions: string[];
  ok: boolean;
  projectId: string;
  projectNumber: string;
  warnings: string[];
}

// 4 IAM permissions required for deploy liveness checks.
// Provisioning is handled externally — no provision permissions needed here.
const DEPLOY_PERMISSIONS = [
  'resourcemanager.projects.get',
  'compute.instances.get',
  'alloydb.clusters.get',
  'alloydb.instances.get',
] as const;

const helpText = `
Validate the Google credential, project access, and IAM permissions before
running the GCP deploy script. GCP provisioning is done externally.

Usage:
  bun run scripts/gcp/doctor.ts --project <project-id>

Credential sources, in resolution order:
  1. GCP_ACCESS_TOKEN
  2. GCP_OAUTH_TOKEN_FILE (default: ~/.config/superfield/gcp-oauth-token.json)
  3. GCP_SERVICE_ACCOUNT_JSON
  4. GOOGLE_APPLICATION_CREDENTIALS
  5. GCP_SERVICE_ACCOUNT_FILE
  6. GCP_SERVICE_ACCOUNT_KEY_JSON
  7. GCP_SERVICE_ACCOUNT_KEY_FILE

Checks 4 IAM permissions for deploy liveness (VM and AlloyDB read access).
`.trim();

export async function runDoctor(config: DoctorConfig): Promise<DoctorResult> {
  const credential = getGoogleCredentialInfo();
  const permissions = [...DEPLOY_PERMISSIONS];

  if (!config.quiet) {
    log(`Doctor: validating deploy credential for project ${config.projectId}`);
    log(`Doctor: credential source ${credential.source}`);
    if (credential.principal) {
      log(`Doctor: service account ${credential.principal}`);
    }
  }

  await getGoogleAccessToken();

  const project = await googleJsonRequest<ProjectResponse>(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}`,
  );
  if (!project?.projectId || !project.projectNumber) {
    throw new Error(`Unable to read project metadata for ${config.projectId}`);
  }
  if (project.lifecycleState && project.lifecycleState !== 'ACTIVE') {
    throw new Error(
      `Project ${config.projectId} is ${project.lifecycleState}; expected ACTIVE`,
    );
  }

  const grantedPermissions = await testProjectPermissions(config.projectId, permissions);
  const missingPermissions = permissions.filter(
    (permission) => !grantedPermissions.has(permission),
  );

  const projectNumber = await getProjectNumber(config.projectId);

  const ok = missingPermissions.length === 0;

  return {
    credential,
    disabledServices: [],
    missingPermissions,
    ok,
    projectId: config.projectId,
    projectNumber,
    warnings: [],
  };
}

function printDoctorResult(result: DoctorResult): void {
  console.log('');
  console.log(`Project:           ${result.projectId}`);
  console.log(`Project number:    ${result.projectNumber}`);
  console.log(`Credential source: ${result.credential.source}`);
  console.log(
    `Principal:         ${result.credential.principal ?? '(not derivable from access token env)'}`,
  );
  console.log(
    `Missing perms:     ${result.missingPermissions.length === 0 ? 'none' : result.missingPermissions.join(', ')}`,
  );
  console.log('');
  console.log(`Checked ${DEPLOY_PERMISSIONS.length} IAM permissions for deploy.`);
  console.log('Note: GCP provisioning is handled externally (Terraform / gcloud / GCP Console).');

  for (const warning of result.warnings) {
    console.log(`Warning: ${warning}`);
  }
}

async function testProjectPermissions(
  projectId: string,
  permissions: readonly string[],
): Promise<Set<string>> {
  const response = await googleJsonRequest<PermissionCheckResponse>(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:testIamPermissions`,
    {
      method: 'POST',
      body: JSON.stringify({ permissions }),
    },
  );
  return new Set(response?.permissions ?? []);
}

// Re-export permission count for use in tests and other scripts.
export const DEPLOY_PERMISSION_COUNT = DEPLOY_PERMISSIONS.length;

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.flags.has('help')) {
    printHelp('scripts/gcp/doctor.ts', helpText);
    return;
  }

  const projectId = resolveRequiredOption(args, 'project', ['GCP_PROJECT_ID'], 'GCP project');

  const result = await runDoctor({
    projectId,
  });
  printDoctorResult(result);

  if (!result.ok) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

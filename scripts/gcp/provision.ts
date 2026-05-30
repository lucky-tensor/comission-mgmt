#!/usr/bin/env bun
/**
 * provision.ts — REMOVED.
 *
 * GCP infrastructure provisioning (VPC, AlloyDB, Compute Engine VM, PSA peering,
 * firewall rules) is handled externally — outside this codebase — via Terraform,
 * gcloud CLI, or manual GCP Console steps.
 *
 * This script intentionally exits with an error to prevent accidental invocation.
 * The deploy script (scripts/gcp/deploy.ts) assumes these resources already exist.
 */

console.error(
  'Error: GCP provisioning has been removed from this codebase.\n' +
    '\n' +
    'Infrastructure (VPC, AlloyDB cluster, Compute Engine VM) must be created\n' +
    'externally before running deploy. See docs/architecture.md for the expected\n' +
    'resource topology.\n',
);
process.exit(1);

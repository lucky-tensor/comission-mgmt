#!/usr/bin/env bun
/**
 * Vitest suite-coverage self-check (PROCESS-C-021/023, TEST-C-007/008).
 *
 * Every root `vitest.*.config.ts` must be executed by a CI workflow. This guards
 * against the audit's finding that most suites were orphaned — present on disk
 * but referenced by no workflow, so they could never gate a merge.
 *
 * The check is two-way:
 *   1. ORPHAN check — every `vitest.*.config.ts` (except the base `vitest.config.ts`)
 *      must appear in at least one `.github/workflows/*.yml`.
 *   2. STALE check — every config a workflow references must exist on disk.
 *
 * The base `vitest.config.ts` is the shared default config (no suite of its own)
 * and is intentionally excluded. `vitest.aliases.ts` is a helper module, not a
 * config, and is excluded by the `*.config.ts` glob.
 *
 * Run: bun run scripts/check-vitest-coverage.ts
 */

import { readFileSync, readdirSync, globSync } from 'node:fs';
import { basename, join } from 'node:path';

const BASE_CONFIG = 'vitest.config.ts';

const configs = globSync('vitest.*.config.ts')
  .map((p) => basename(p))
  .filter((name) => name !== BASE_CONFIG)
  .sort();

const workflowDir = '.github/workflows';
const workflowFiles = readdirSync(workflowDir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => join(workflowDir, f));
const workflowText = workflowFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

// Collect every vitest config filename referenced anywhere in the workflows.
const referenced = new Set<string>();
const refRe = /vitest\.[A-Za-z0-9._-]*config\.ts/g;
let m: RegExpExecArray | null;
while ((m = refRe.exec(workflowText)) !== null) {
  referenced.add(m[0]);
}

const orphans = configs.filter((c) => !referenced.has(c));

// STALE: a workflow names a config that no longer exists on disk.
const onDisk = new Set([...configs, BASE_CONFIG]);
const stale = [...referenced].filter((r) => !onDisk.has(r)).sort();

let failed = false;

if (orphans.length > 0) {
  failed = true;
  console.error('=== Vitest coverage gate FAILED — orphaned configs ===');
  console.error('These vitest config(s) are referenced by no CI workflow:');
  for (const o of orphans) console.error(`  ${o}`);
}

if (stale.length > 0) {
  failed = true;
  console.error('=== Vitest coverage gate FAILED — stale workflow references ===');
  console.error('These configs are referenced by a workflow but do not exist on disk:');
  for (const s of stale) console.error(`  ${s}`);
}

if (failed) {
  console.error(
    '\nEvery vitest.*.config.ts must be run by a CI workflow, and every referenced config must exist.',
  );
  process.exit(1);
}

console.log(
  `OK: all ${configs.length} vitest.*.config.ts suites are referenced by a CI workflow; no stale references.`,
);

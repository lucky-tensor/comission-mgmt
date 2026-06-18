#!/usr/bin/env bun
/**
 * Vitest suite-coverage self-check (PROCESS-C-021/023, TEST-C-007/008).
 *
 * Every root `vitest.*.config.ts` must be executed by a CI workflow. This guards
 * against the audit's finding that most suites were orphaned — present on disk
 * but referenced by no workflow, so they could never gate a merge.
 *
 * The check is three-way:
 *   1. ORPHAN check — every `vitest.*.config.ts` (except the base `vitest.config.ts`)
 *      must appear in at least one `.github/workflows/*.yml`.
 *   2. STALE check — every config a workflow references must exist on disk.
 *   3. UNCOVERED-FILE check — every `*.test.ts` on disk must be matched by the
 *      `include` glob of at least one config that a workflow actually executes.
 *      This closes the orphaned-test-file class (#268): before this check a test
 *      file (e.g. the 12 suites under packages/core/tests/) could exist with no
 *      executed config covering it, so it never gated a merge.
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

// ---------------------------------------------------------------------------
// UNCOVERED-FILE check (#268).
//
// A config being wired into a workflow is necessary but not sufficient: a test
// file is only protected if some executed config's `include` glob (or an
// explicit `vitest run <path>` arg in a workflow) actually matches it. Before
// this check, the 12 suites under packages/core/tests/ existed on disk but were
// matched by no executed config, so they never gated a merge.
//
// "Executed" matchers come from two sources:
//   1. the `include` globs of every workflow-referenced vitest config, and
//   2. explicit path/glob args that workflows pass to vitest — `vitest run
//      <path>`, the `file:` matrix entries consumed by `test:browser`, and the
//      `compgen -G "<glob>"` discovery globs in test-unit.yml.
//
// Files run by an intentionally-retired or separately-tracked mechanism are
// listed in KNOWN_UNCOVERED with a reason, so a deliberately uncovered file
// stays green but a NEWLY orphaned file (e.g. a fresh packages/core suite) is
// flagged.

/** Translate a glob (supports **, *, ?) into an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** A directory/path arg covers every test file beneath it. */
function pathArgToRegExp(arg: string): RegExp {
  const clean = arg.replace(/\/$/, '');
  if (clean.includes('.test.') || clean.endsWith('.e2e.ts')) return globToRegExp(clean);
  return globToRegExp(`${clean}/**`);
}

// Test files that are deliberately uncovered by any executed config. Each entry
// is a glob plus the reason it is allowed; never add an entry to silence a
// genuinely orphaned suite — wire it into CI instead.
const KNOWN_UNCOVERED: { glob: string; reason: string }[] = [
  {
    glob: 'tests/deprecated/**',
    reason: 'Retired suites kept for reference only; intentionally run by no workflow.',
  },
  {
    glob: 'packages/db/tests/**',
    reason:
      'Pre-existing orphan tracked in #272 (only migration/encryption-integration/demo-seed run, via vitest.migration.config.ts). Out of scope for #268.',
  },
  {
    glob: 'apps/server/tests/integration/placements/**',
    reason: 'Pre-existing orphan tracked in #272. Out of scope for #268.',
  },
];

const executedMatchers: RegExp[] = [];

// (1) include globs from workflow-referenced configs.
for (const config of configs) {
  if (!referenced.has(config)) continue;
  const txt = readFileSync(config, 'utf8');
  const inc = txt.match(/include:\s*\[([\s\S]*?)\]/);
  if (!inc) continue;
  for (const g of inc[1].matchAll(/['"]([^'"]+)['"]/g)) {
    executedMatchers.push(globToRegExp(g[1]));
  }
}

// (2) explicit path args, `file:` matrix entries, and compgen discovery globs.
for (const tok of workflowText.matchAll(/(?:vitest run|file:)\s+([^\s'"#]+)/g)) {
  const arg = tok[1];
  if (arg.startsWith('vitest.') || arg.startsWith('--')) continue;
  executedMatchers.push(pathArgToRegExp(arg));
}
for (const g of workflowText.matchAll(/compgen -G "([^"]+)"/g)) {
  executedMatchers.push(globToRegExp(g[1]));
}

const knownUncoveredMatchers = KNOWN_UNCOVERED.map((k) => globToRegExp(k.glob));

const testFiles = [
  ...globSync('**/*.test.ts'),
  ...globSync('**/*.test.tsx'),
  ...globSync('**/*.e2e.ts'),
].filter((f) => !f.includes('node_modules'));

const uncovered = testFiles
  .filter((f) => !executedMatchers.some((r) => r.test(f)))
  .filter((f) => !knownUncoveredMatchers.some((r) => r.test(f)))
  .sort();

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

if (uncovered.length > 0) {
  failed = true;
  console.error('=== Vitest coverage gate FAILED — uncovered test files ===');
  console.error(
    'These test files are matched by no executed vitest config and by no\n' +
      'explicit vitest-run path in a workflow, so they cannot gate a merge.\n' +
      'Wire them into a CI-executed config (or, if intentionally retired,\n' +
      'add a documented KNOWN_UNCOVERED entry):',
  );
  for (const u of uncovered) console.error(`  ${u}`);
}

if (failed) {
  console.error(
    '\nEvery vitest.*.config.ts must be run by a CI workflow, every referenced\n' +
      'config must exist, and every test file must be covered by an executed config.',
  );
  process.exit(1);
}

console.log(
  `OK: all ${configs.length} vitest.*.config.ts suites are referenced by a CI workflow; ` +
    `no stale references; all ${testFiles.length} test files are covered by an executed config ` +
    `(${KNOWN_UNCOVERED.length} known-uncovered globs allowlisted).`,
);

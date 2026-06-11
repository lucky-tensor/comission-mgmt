/**
 * Shared Vitest module aliases for the commission-mgmt monorepo.
 *
 * Every per-suite `vitest.*.config.ts` resolves the same `core/*` and `db/*`
 * workspace import paths to their on-disk source files. This module is the
 * single source of truth for that alias table so the configs stay DRY — a new
 * shared module only has to be wired in one place.
 *
 * Resolution rules:
 *   - `core` / `core/<name>`  → `packages/core/index.ts` / `packages/core/<name>.ts`
 *   - `db` / `db/index`       → `packages/db/index.ts`
 *   - a handful of `db/<name>` entry points live at `packages/db/<name>.ts`
 *     (revocation, passkeys, pg-container, ssl, worker-tokens, task-queue,
 *     migrate, seed, cleanup) and are aliased explicitly BEFORE the catch-all.
 *   - every other `db/<name>` → `packages/db/src/<name>.ts`
 *
 * Order matters: Vitest matches aliases top-to-bottom, so specific entries and
 * `db/index` precede the `db/<name>` catch-all, which precedes bare `db`.
 *
 * Canonical docs: docs/architecture.md — Test harness (per-suite vitest configs)
 */
import { resolve } from 'path';

export interface AliasEntry {
  find: string | RegExp;
  replacement: string;
}

/** db/* entry points that live at packages/db/<name>.ts (not src/). */
const DB_ROOT_MODULES = [
  'revocation',
  'passkeys',
  'pg-container',
  'ssl',
  'worker-tokens',
  'task-queue',
  'migrate',
  'seed',
  'cleanup',
] as const;

/**
 * Build the alias table rooted at `root` (typically a config's `__dirname`).
 */
export function vitestAliases(root: string): AliasEntry[] {
  return [
    // core — bare package, then subpath catch-all.
    { find: /^core$/, replacement: resolve(root, 'packages/core/index.ts') },
    { find: /^core\/(.+)$/, replacement: resolve(root, 'packages/core') + '/$1.ts' },

    // ui — shared component library (browser bundle only). Bare package
    // resolves to its index; subpaths resolve to the directory so Vite picks
    // the right .ts/.tsx file (tokens.ts, Button.tsx, StatusChip.tsx).
    { find: /^ui$/, replacement: resolve(root, 'packages/ui/index.ts') },
    { find: /^ui\/(.+)$/, replacement: resolve(root, 'packages/ui') + '/$1' },

    // db root-level entry points (packages/db/*.ts) — must precede the src catch-all.
    ...DB_ROOT_MODULES.map((name) => ({
      find: `db/${name}`,
      replacement: resolve(root, `packages/db/${name}.ts`),
    })),
    { find: /^db\/index$/, replacement: resolve(root, 'packages/db/index.ts') },

    // Every other db/<name> resolves to packages/db/src/<name>.ts.
    { find: /^db\/(.+)$/, replacement: resolve(root, 'packages/db/src') + '/$1.ts' },
    { find: /^db$/, replacement: resolve(root, 'packages/db/index.ts') },
  ];
}

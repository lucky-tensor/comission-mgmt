#!/usr/bin/env bun
/**
 * SQL-injection grep-gate — fails when a `sql.unsafe(`…`)` call interpolates a
 * value into its SQL string literal via `${…}` (DATA-C-005 injection defense).
 *
 * Every caller-supplied value must flow through a bound `$n` parameter. The only
 * interpolations allowed inside a `.unsafe()` template are programmatically
 * generated, value-free SQL fragments: bound-placeholder lists and dynamic
 * column/SET/WHERE clauses built solely from literal column names.
 *
 * Allowed interpolation expressions (the SQL string they expand to never
 * contains a caller value):
 *   - ${placeholders}                         generated "$2, $3, …" list
 *   - ${cols.join(...)}, ${valuePlaceholders.join(...)}
 *   - ${sets.join(...)}, ${conditions.join(...)}
 *   - ${periodFilter}                         static $-placeholder fragment
 *   - ${paramIdx}, ${paramIdx++}              positional index counters
 *
 * Run: bun run scripts/check-sql-injection.ts
 * Scope: packages/db/src and apps/server/src (production data-access surface).
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const SCOPES = ['packages/db/src', 'apps/server/src'];

const ALLOWED = [
  /^placeholders$/,
  /^cols\.join\(.*\)$/,
  /^valuePlaceholders\.join\(.*\)$/,
  /^sets\.join\(.*\)$/,
  /^conditions\.join\(.*\)$/,
  /^periodFilter$/,
  /^paramIdx\+?\+?$/,
];

function isAllowed(expr: string): boolean {
  const trimmed = expr.trim();
  return ALLOWED.some((re) => re.test(trimmed));
}

const interpRe = /\$\{([^}]*)\}/g;
const violations: string[] = [];

for (const scope of SCOPES) {
  const files = globSync(`${scope}/**/*.ts`);
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    let idx = 0;
    while (true) {
      const call = src.indexOf('.unsafe(', idx);
      if (call === -1) break;
      idx = call + 8;
      // Skip whitespace to find the SQL template literal.
      let i = idx;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== '`') continue;
      const end = src.indexOf('`', i + 1);
      if (end === -1) continue;
      const body = src.slice(i + 1, end);
      let m: RegExpExecArray | null;
      interpRe.lastIndex = 0;
      while ((m = interpRe.exec(body)) !== null) {
        if (!isAllowed(m[1])) {
          const line = src.slice(0, call).split('\n').length;
          violations.push(`${file}:${line}  raw interpolation into sql.unsafe(): \${${m[1]}}`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('=== SQL-injection gate FAILED ===');
  console.error('Caller-supplied values must be bound as $n parameters, not interpolated:');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log('OK: no raw value interpolation into sql.unsafe() in', SCOPES.join(', '));

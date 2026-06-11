/**
 * Web app branding — repo guard tests (#203).
 *
 * The UX review (docs/ux-review.md §5) found leftover template branding: the
 * browser tab read "RobotMoney Admin Dapp". These tests pin the corrected
 * branding so it can never regress:
 *   - apps/web/index.html <title> is "Commission Management"
 *   - the string "RobotMoney" appears nowhere under apps/web/
 *
 * Pure node test (filesystem read). Run: `bun run test:webapp-ux`
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const WEB_ROOT = resolve(__dirname, '..');

/** Recursively collect files under `dir`, skipping node_modules and dist. */
function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe('web app branding', () => {
  test('index.html title is "Commission Management"', () => {
    const html = readFileSync(join(WEB_ROOT, 'index.html'), 'utf-8');
    const match = html.match(/<title>([^<]*)<\/title>/);
    expect(match).not.toBeNull();
    expect(match![1].trim()).toBe('Commission Management');
  });

  test('the string "RobotMoney" appears nowhere under apps/web/', () => {
    const offenders: string[] = [];
    for (const file of walk(WEB_ROOT)) {
      // Skip this test file itself (it names the banned string).
      if (file.endsWith('branding.test.ts')) continue;
      const text = readFileSync(file, 'utf-8');
      if (text.includes('RobotMoney')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PRODUCT_ROOTS = ['apps/web/src', 'packages/ui'];
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx']);

function sourceFiles(directory: string): string[] {
  const absolute = join(ROOT, directory);
  return readdirSync(absolute).flatMap((entry) => {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(relative(ROOT, path));
    }
    const extension = path.slice(path.lastIndexOf('.'));
    return SOURCE_EXTENSIONS.has(extension) ? [path] : [];
  });
}

function productSources(): Array<{ path: string; source: string }> {
  return PRODUCT_ROOTS.flatMap(sourceFiles)
    .filter((path) => !path.includes('/tests/') && !path.includes('/design-system/'))
    .map((path) => ({ path: relative(ROOT, path), source: readFileSync(path, 'utf8') }));
}

function findings(pattern: RegExp): string[] {
  return productSources().flatMap(({ path, source }) =>
    source
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => pattern.test(line))
      .map(({ line, index }) => `${path}:${index + 1}: ${line.trim()}`),
  );
}

describe('Atlas design-system adherence', () => {
  it('vendors the supplied Atlas package and loads the app bridge globally', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'packages/ui/design-system/atlas/_ds_manifest.json'), 'utf8'),
    ) as { tokens: Array<{ name: string }> };
    const bridge = readFileSync(join(ROOT, 'packages/ui/design-system/app.css'), 'utf8');
    const entrypoint = readFileSync(join(ROOT, 'apps/web/src/index.css'), 'utf8');
    const atlasTokens = new Set(manifest.tokens.map((token) => token.name));

    expect(atlasTokens).toContain('--surface-card');
    expect(atlasTokens).toContain('--text-primary');
    expect(atlasTokens).toContain('--status-danger');
    expect(entrypoint).toContain("@import 'ui/design-system/app.css';");

    const bridgeReferences = [...bridge.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(
      (match) => match[1],
    );
    expect(bridgeReferences.filter((token) => !atlasTokens.has(token))).toEqual([]);
  });

  it('keeps raw visual values out of every product UI surface', () => {
    expect(findings(/(?:['":]|\[)#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(/)).toEqual([]);
    expect(
      findings(
        /\b(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+/,
      ),
    ).toEqual([]);
    expect(findings(/\b[a-z][a-z0-9-]*-\[[^\]]+\]/)).toEqual([]);
  });

  it('allows inline style only for data-driven chart widths', () => {
    const inlineStyles = findings(/\bstyle\s*=/);
    expect(inlineStyles).toEqual([
      'apps/web/src/components/executive/ExecTrends.tsx:200: style={{ width: `${pct.toFixed(1)}%` }}',
      'apps/web/src/components/portal/TierProgress.tsx:55: <div className="h-full bg-accent" style={{ width: `${pct}%` }} />',
    ]);
  });
});

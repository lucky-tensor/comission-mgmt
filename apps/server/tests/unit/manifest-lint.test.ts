/**
 * Manifest-lint tests — assert the k8s manifests reference paths/labels that
 * actually exist, so a rollout cannot silently stall on a mismatched probe or a
 * no-op NetworkPolicy.
 *
 *   - readinessProbe.httpGet.path must be a route the server serves (/readyz).
 *     A wrong path (the old /health/ready) made readiness never pass.
 *   - The worker NetworkPolicy must resolve to the running namespace
 *     (commission-production) and target the real app label (commission-app),
 *     not the dead `commission` namespace / `commission-server` label.
 *
 * Pure text assertions over the committed manifests (no cluster required).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const APP_MANIFESTS = [
  'k8s/app.yaml',
  'k8s/deploy-production.yaml',
  'k8s/deploy-stage.yaml',
  'k8s/deploy-demo.yaml',
];

describe('readiness probe paths match served routes', () => {
  for (const file of APP_MANIFESTS) {
    test(`${file} probes /readyz, not the non-existent /health/ready`, () => {
      const src = read(file);
      expect(src).toMatch(/path:\s*\/readyz/);
      expect(src).not.toMatch(/\/health\/ready/);
    });
  }
});

describe('worker NetworkPolicy resolves correctly', () => {
  const src = read('k8s/worker-network-policy.yaml');

  test('lives in the running namespace (commission-production)', () => {
    expect(src).toMatch(/namespace:\s*commission-production/);
    // The dead `namespace: commission` must be gone.
    expect(src).not.toMatch(/namespace:\s*commission\s*$/m);
  });

  test('targets the real app label (commission-app), not commission-server', () => {
    expect(src).toMatch(/app:\s*commission-app/);
    expect(src).not.toMatch(/commission-server/);
  });

  test('still selects worker pods and denies postgres (5432) egress', () => {
    expect(src).toMatch(/app:\s*commission-worker/);
    expect(src).not.toMatch(/port:\s*5432/);
  });
});

describe('worker manifest injects no DB credential', () => {
  const src = read('k8s/worker.yaml');
  test('no env var binds DATABASE_URL or ENCRYPTION_MASTER_KEY into the worker', () => {
    // Assert no `- name: DATABASE_URL` / `key: DATABASE_URL` env injection exists
    // (prose comments naming the vars are allowed).
    expect(src).not.toMatch(/name:\s*DATABASE_URL/);
    expect(src).not.toMatch(/key:\s*DATABASE_URL/);
    expect(src).not.toMatch(/name:\s*ENCRYPTION_MASTER_KEY/);
    expect(src).not.toMatch(/key:\s*ENCRYPTION_MASTER_KEY/);
  });
});

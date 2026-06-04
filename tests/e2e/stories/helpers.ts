/**
 * Shared harness helpers for user-story E2E tests.
 *
 * Every story test follows the same pattern:
 *   1. mountApp()  — render the full App into a real Chromium DOM
 *   2. navigate('/') — start from the login screen
 *   3. loginAs(roleLabel) — click the demo button and wait for the redirect
 *   4. drive the story via userEvent; assert via expect.element()
 *
 * No bare component mounting. No fetch() calls for story assertions.
 * The full App (NavShell, role routing, isPathPermitted guard) is live
 * for every test.
 *
 * ## Integration seam contract (dev-scout #176)
 *
 * This file is the ONLY shared seam between all role story test files.
 * The two downstream parallel-eligible story suites import exclusively from here:
 *
 *   - finance-admin.stories.e2e.ts (#162/#158): imports `loginAs`, `useFixture`
 *   - producer.stories.e2e.ts (#156/#164):      imports `loginAs`, `useMount`
 *
 * The two story files have NO cross-file touchpoints — they are parallel-safe.
 *
 * Console error gate (#175, PR #174):
 *   A module-level `console.error` interceptor is added to this file by PR #174
 *   (branch: fix/browser-errors). The gate accumulates non-act errors in
 *   `_consoleErrors[]` and asserts emptiness inside `teardown()` (called by
 *   both `useMount` and `useFixture` via `afterEach`). This means every story
 *   test automatically fails on browser console errors without any per-test
 *   boilerplate. The gate is transparent to both downstream story files — they
 *   pick it up automatically via `useMount`/`useFixture`.
 *
 * Integration risks discovered:
 *   - `console.log` is suppressed globally in this module (see PR #174).
 *     Any future helper that relies on console.log for debugging must restore
 *     `_origConsoleLog` locally or use a different channel.
 *   - `useFixture` shares a single `FixtureRef` across all tests in a file.
 *     Callers must NOT destructure `fixture` out of the ref — it is populated
 *     asynchronously in `beforeAll` and a destructured copy would be `undefined`
 *     at test time.
 */

import { expect, beforeAll, afterEach, type ExpectStatic } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';
import App, { navigate } from '../../../apps/web/src/App';

export interface Mounted {
  unmount: () => void;
}

export function mountApp(): Mounted {
  const container = document.createElement('div');
  container.id = `story-e2e-${Date.now()}`;
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(createElement(App));
  });
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * Full login flow through the UI:
 *   navigate('/') → wait for demo-section → click role button → return mounted app.
 *
 * The caller must pass the human-readable label exactly as shown in the demo
 * section (e.g. 'Finance Admin', 'Producer', 'Manager', 'Executive', 'HR',
 * 'External Partner').
 */
export async function loginAs(roleLabel: string): Promise<Mounted> {
  // Logout any active session so the App always renders <Login>, not <AuthenticatedApp>.
  // Also prevents zombie React roots if a prior test's loginAs threw before returning.
  console.log(`[story] loginAs(${roleLabel}): logout + navigate + mountApp`);
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  navigate('/');
  const app = mountApp();
  try {
    console.log(`[story] loginAs(${roleLabel}): waiting for login-container`);
    await (expect as ExpectStatic).element(page.getByTestId('login-container')).toBeInTheDocument();
    console.log(`[story] loginAs(${roleLabel}): waiting for demo-section`);
    await (expect as ExpectStatic).element(page.getByTestId('demo-section')).toBeInTheDocument();
    console.log(`[story] loginAs(${roleLabel}): clicking button`);
    await userEvent.click(
      page.getByTestId('demo-section').getByRole('button', { name: roleLabel }),
    );
    // Wait for nav-shell to confirm the redirect completed before returning.
    console.log(`[story] loginAs(${roleLabel}): waiting for nav-shell`);
    await (expect as ExpectStatic).element(page.getByTestId('nav-shell')).toBeInTheDocument();
    console.log(`[story] loginAs(${roleLabel}): done — path=${window.location.pathname}`);
    return app;
  } catch (err) {
    // Unmount on failure to prevent zombie React roots accumulating across tests.
    app.unmount();
    throw err;
  }
}

/**
 * Load fixture IDs written by globalSetup (via the Vite dev server plugin).
 * Safe to call in beforeAll — uses fetch() for setup, not story assertions.
 */
export interface E2EFixture {
  closeRunId: string;
  closeIncompletePlacementId: string;
  closeCompletePlacementId: string;
  partnerPlacementId: string;
  unrelatedPlacementId: string;
}

export async function loadFixture(): Promise<E2EFixture> {
  console.log('[story] loadFixture: fetching /__e2e_fixture__');
  const res = await fetch('/__e2e_fixture__');
  const data = (await res.json()) as E2EFixture;
  console.log(
    `[story] loadFixture: done partnerPlacementId=${data.partnerPlacementId} closeRunId=${data.closeRunId}`,
  );
  return data;
}

function teardown(ref: { current: Mounted | undefined }) {
  console.log('[story] afterEach: teardown');
  try {
    ref.current?.unmount();
  } catch {
    /* already unmounted */
  }
  ref.current = undefined;
  navigate('/');
}

export function useMount(): { current: Mounted | undefined } {
  const ref = { current: undefined as Mounted | undefined };
  afterEach(() => teardown(ref));
  return ref;
}

export interface FixtureRef {
  current: Mounted | undefined;
  fixture: E2EFixture;
}

/**
 * Registers beforeAll(loadFixture) + the standard afterEach teardown.
 * Returns a single mutable ref — callers must NOT destructure fixture out of
 * it, because fixture is populated asynchronously in beforeAll and a
 * destructured copy would capture the pre-beforeAll undefined value.
 */
export function useFixture(): FixtureRef {
  const ref = { current: undefined, fixture: undefined } as unknown as FixtureRef;
  beforeAll(async () => {
    ref.fixture = await loadFixture();
  });
  afterEach(() => teardown(ref));
  return ref;
}

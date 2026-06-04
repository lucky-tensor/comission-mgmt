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
 */

import { expect, type ExpectStatic } from 'vitest';
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
  navigate('/');
  const app = mountApp();
  await (expect as ExpectStatic).element(page.getByTestId('login-container')).toBeInTheDocument();
  await (expect as ExpectStatic).element(page.getByTestId('demo-section')).toBeInTheDocument();
  await userEvent.click(
    page.getByTestId('demo-section').getByRole('button', { name: roleLabel }),
  );
  return app;
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
  const res = await fetch('/__e2e_fixture__');
  return res.json() as Promise<E2EFixture>;
}

/**
 * Tiny real-browser render helper for component tests.
 *
 * Mounts a React element into a fresh container in the live document with
 * react-dom/client (no test renderer, no mock DOM — this runs in real headless
 * Chromium). Returns an unmount cleanup. Queries are done with the locators
 * from `@vitest/browser/context`, which operate on the same real DOM.
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactElement } from 'react';

export interface Mounted {
  container: HTMLElement;
  unmount: () => void;
}

/** Mount `ui` into a fresh div appended to document.body. */
export function renderInBrowser(ui: ReactElement): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

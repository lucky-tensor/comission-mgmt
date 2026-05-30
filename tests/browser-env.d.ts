/**
 * Ambient type references for the Vitest browser-mode harness.
 *
 * Pulls in the `@vitest/browser` matcher augmentation (`expect.element`,
 * `toBeInTheDocument`, `toHaveTextContent`, …) and the Playwright provider's
 * `userEvent` / `page` typings so the component and E2E tests typecheck under
 * the repo-wide `tsc --noEmit`.
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

/// <reference types="@vitest/browser/matchers" />
/// <reference types="@vitest/browser/providers/playwright" />

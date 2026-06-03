/**
 * Ambient type references for the Vitest browser-mode harness.
 *
 * Pulls in the `@vitest/browser` matcher augmentation (`expect.element`,
 * `toBeInTheDocument`, `toHaveTextContent`, …) and the Playwright provider's
 * `userEvent` / `page` typings so the component and E2E tests typecheck under
 * the repo-wide `tsc --noEmit`.
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 * Issue: test: E2E — Manager split-approval and dispute resolution (#118)
 */

/// <reference types="@vitest/browser/matchers" />
/// <reference types="@vitest/browser/providers/playwright" />

// Extend Vitest's ProvidedContext with the seeded placement IDs that
// global-setup.ts returns from its setup() function (issue #118).
// This lets manager-flow.e2e.ts call inject('pendingPlacementId') etc.
declare module 'vitest' {
  export interface ProvidedContext {
    pendingPlacementId: string;
    disputedPlacementId: string;
    disputedRecordId: string;
    disputeId: string;
    isolationPlacementId: string;
  }
}

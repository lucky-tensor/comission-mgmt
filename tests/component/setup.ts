/**
 * Browser-test setup: mark the environment as a React `act` environment so
 * createRoot renders flush synchronously inside `act(...)` without warnings.
 * Runs in the browser context before each test file.
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};

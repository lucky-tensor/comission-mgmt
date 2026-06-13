/**
 * Browser-test setup: mark the environment as a React `act` environment so
 * createRoot renders flush synchronously inside `act(...)` without warnings.
 * Runs in the browser context before each test file.
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

// Load the global stylesheet (Tailwind + @theme) so browser-mode tests render
// with the real visual system, mirroring the production app entry (main.tsx).
import '../../apps/web/src/index.css';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};

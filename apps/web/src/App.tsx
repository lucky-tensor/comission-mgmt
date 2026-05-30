/**
 * Root application component.
 *
 * Renders the Login page for authentication. Post-login product UI is
 * implemented in later phase issues.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 * Issue: feat: sign-in page and WebAuthn passkey UX with demo bypass
 */

import Login from './components/Login';

export default function App() {
  return <Login />;
}

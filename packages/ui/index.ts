/**
 * Shared React component library — public API.
 *
 * Phase 1 Foundation: blank shell. Components are implemented in later
 * UI issues once the data layer and auth are in place.
 *
 * Architecture constraints:
 *   - Only imported by apps/web (browser bundle)
 *   - Must never import from apps/server, apps/worker, packages/db, or packages/auth
 *   - Shared types only flow from packages/core (ARCH-D-001)
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 */

export { Button } from './Button';

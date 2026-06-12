/**
 * Shared React component library — public API.
 *
 * The design-system layer: the three-variant Button and the semantic StatusChip
 * with its status→variant mapping. NavShell and every web surface render from
 * Tailwind utilities driven by the `@theme` in apps/web/src/index.css (the former
 * JS token module, packages/ui/tokens.ts, has been retired) instead of inventing
 * local hex values.
 *
 * Architecture constraints:
 *   - Only imported by apps/web (browser bundle)
 *   - Must never import from apps/server, apps/worker, packages/db, or packages/auth
 *   - Shared types only flow from packages/core (ARCH-D-001)
 *
 * Canonical docs: docs/ux-review.md §5; docs/architecture.md — Phase 1 Foundation
 */

export { Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';

export { StatusChip, statusVariant } from './StatusChip';
export type { StatusChipProps, StatusVariant } from './StatusChip';

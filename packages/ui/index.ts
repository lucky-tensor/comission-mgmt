/**
 * Shared React component library — public API.
 *
 * The design-system layer (#203): a token module (colors, spacing, radius,
 * typography, container width), the three-variant Button, and the semantic
 * StatusChip with its status→variant mapping. NavShell and every web surface
 * anchor to these instead of inventing local hex values.
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

export { colors, space, radius, font, layout } from './tokens';

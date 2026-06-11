/**
 * Design tokens — the single source of truth for the web app's visual system.
 *
 * Before this layer existed every surface invented its own hex values, button
 * styles, chip colors and page widths (see docs/ux-review.md §5). NavShell,
 * Button, StatusChip and the page container all anchor to these tokens so the
 * product reads as one designed system rather than a stack of API panels.
 *
 * Architecture constraints (packages/ui):
 *   - Only imported by apps/web (browser bundle)
 *   - Never imports from apps/server, apps/worker, packages/db, packages/auth
 *
 * Canonical docs: docs/ux-review.md §5 (Visual system); docs/architecture.md
 * Issue: feat: webapp — UX overhaul: design-system pass (#203)
 */

/** Semantic + neutral color palette. */
export const colors = {
  // Brand / interactive
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primarySoft: '#eff6ff',

  // Neutrals
  ink: '#111827',
  inkMuted: '#374151',
  inkSubtle: '#6b7280',
  inkFaint: '#9ca3af',
  border: '#e5e7eb',
  borderStrong: '#d1d5db',
  surface: '#ffffff',
  surfaceMuted: '#f9fafb',
  surfaceSunken: '#f3f4f6',

  // Nav shell (dark bar)
  navBg: '#111827',
  navFg: '#ffffff',
  navFgMuted: '#9ca3af',
  navActiveBg: 'rgba(255,255,255,0.1)',

  // Semantic status palette (see statusVariant mapping in StatusChip)
  // green = paid/complete, amber = held/pending, gray = neutral/closed,
  // red = disputed/blocked
  greenBg: '#dcfce7',
  greenFg: '#166534',
  amberBg: '#fef3c7',
  amberFg: '#92400e',
  grayBg: '#f3f4f6',
  grayFg: '#374151',
  redBg: '#fee2e2',
  redFg: '#991b1b',
} as const;

/** Spacing scale (rem). */
export const space = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '0.75rem',
  lg: '1rem',
  xl: '1.5rem',
  '2xl': '2rem',
} as const;

/** Border radius scale. */
export const radius = {
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  pill: '9999px',
} as const;

/** Typography. One deliberate font family across the product shell. */
export const font = {
  family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/**
 * Standard content container width. The UX review found pages ranging from a
 * narrow 640px column to full-bleed 1400px; one container fixes that drift.
 */
export const layout = {
  containerMaxWidth: '1140px',
  containerPadding: '1.5rem',
} as const;

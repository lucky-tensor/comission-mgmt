/**
 * Button — the one interactive button for the product shell.
 *
 * The UX review (docs/ux-review.md §5) found "button anarchy": blue primary,
 * black buttons, a purple "Escalate", green/red pills and a red-outlined
 * "Log out" that read as an error. This component defines exactly three
 * styles, anchored to the design tokens, and every surface uses them:
 *
 *   primary     — the main affirmative action (blue fill)
 *   secondary   — supporting / neutral action (subtle fill)
 *   destructive — irreversible / negative action (red fill)
 *
 * Canonical docs: docs/ux-review.md §5 (Button variants)
 * Issue: feat: webapp — UX overhaul: design-system pass (#203)
 */

import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import { colors, radius } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT_STYLE: Record<ButtonVariant, CSSProperties> = {
  primary: { background: colors.primary, color: '#ffffff', border: 'none' },
  secondary: {
    background: colors.surfaceSunken,
    color: colors.ink,
    border: `1px solid ${colors.borderStrong}`,
  },
  destructive: { background: colors.redFg, color: '#ffffff', border: 'none' },
};

export function Button({ variant = 'primary', children, style, disabled, ...props }: ButtonProps) {
  const base: CSSProperties = {
    padding: '0.5rem 1rem',
    borderRadius: radius.sm,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 500,
    fontSize: '0.875rem',
    opacity: disabled ? 0.55 : 1,
  };

  return (
    <button
      data-variant={variant}
      disabled={disabled}
      style={{ ...base, ...VARIANT_STYLE[variant], ...style }}
      {...props}
    >
      {children}
    </button>
  );
}

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

import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const BASE_CLASS =
  'inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium ' +
  'cursor-pointer transition-colors disabled:opacity-55 disabled:cursor-not-allowed';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white border border-transparent hover:bg-ink-muted',
  secondary: 'bg-surface-sunken text-ink border border-border-strong hover:bg-border',
  destructive: 'bg-bad-fg text-white border border-transparent hover:opacity-90',
};

export function Button({ variant = 'primary', children, className, ...props }: ButtonProps) {
  return (
    <button
      data-variant={variant}
      className={[BASE_CLASS, VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}

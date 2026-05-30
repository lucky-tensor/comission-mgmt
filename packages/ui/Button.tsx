/**
 * Button — base interactive component.
 *
 * Phase 1 shell: minimal implementation so the component library compiles.
 * Full styling (Tailwind tokens) and variant support are added in UI issues.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 */

import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({ variant = 'primary', children, style, ...props }: ButtonProps) {
  const base: React.CSSProperties = {
    padding: '0.5rem 1rem',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: '0.875rem',
    ...style,
  };

  const variants: Record<string, React.CSSProperties> = {
    primary: { background: '#2563eb', color: '#fff' },
    secondary: { background: '#e5e7eb', color: '#111827' },
    ghost: { background: 'transparent', color: '#374151' },
  };

  return (
    <button style={{ ...base, ...variants[variant] }} {...props}>
      {children}
    </button>
  );
}

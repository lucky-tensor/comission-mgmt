import React from 'react';

const sizes = {
  sm: { height: 28, padding: '0 10px', font: 'var(--text-sm)', gap: 6, icon: 15 },
  md: { height: 34, padding: '0 14px', font: 'var(--text-body)', gap: 7, icon: 16 },
  lg: { height: 40, padding: '0 18px', font: 'var(--text-body)', gap: 8, icon: 18 },
};

const variants = {
  primary: {
    background: 'var(--action-primary)', color: 'var(--action-primary-fg)',
    border: '1px solid var(--action-primary)',
    '--hover-bg': 'var(--action-primary-hover)', '--hover-bd': 'var(--action-primary-hover)',
  },
  secondary: {
    background: 'var(--surface-card)', color: 'var(--text-primary)',
    border: '1px solid var(--border-strong)',
    '--hover-bg': 'var(--surface-hover)', '--hover-bd': 'var(--border-strong)',
  },
  ghost: {
    background: 'transparent', color: 'var(--text-secondary)',
    border: '1px solid transparent',
    '--hover-bg': 'var(--surface-hover)', '--hover-bd': 'transparent',
  },
  accent: {
    background: 'var(--accent)', color: 'var(--accent-fg)',
    border: '1px solid var(--accent)',
    '--hover-bg': 'var(--accent-hover)', '--hover-bd': 'var(--accent-hover)',
  },
  danger: {
    background: 'var(--status-danger)', color: 'var(--gray-0)',
    border: '1px solid var(--status-danger)',
    '--hover-bg': 'var(--red-700)', '--hover-bd': 'var(--red-700)',
  },
};

/**
 * Atlas Button — the primary action control.
 * Primary defaults to ink (near-black); use accent sparingly for the single
 * most important affirmative action, danger for destructive ones.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  iconLeft = null,
  iconRight = null,
  type = 'button',
  children,
  style,
  ...rest
}) {
  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.secondary;

  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = v['--hover-bg']; e.currentTarget.style.borderColor = v['--hover-bd']; } }}
      onMouseLeave={(e) => { e.currentTarget.style.background = v.background; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.border = v.border; }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: s.gap, height: s.height, padding: s.padding,
        width: fullWidth ? '100%' : 'auto',
        font: `var(--weight-medium) ${s.font}/1 var(--font-sans)`,
        letterSpacing: 'var(--tracking-snug)',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap', userSelect: 'none',
        transition: 'background 120ms ease, border-color 120ms ease',
        background: v.background, color: v.color, border: v.border,
        ...style,
      }}
      {...rest}
    >
      {iconLeft && <span style={{ display: 'inline-flex', width: s.icon, height: s.icon }}>{iconLeft}</span>}
      {children}
      {iconRight && <span style={{ display: 'inline-flex', width: s.icon, height: s.icon }}>{iconRight}</span>}
    </button>
  );
}

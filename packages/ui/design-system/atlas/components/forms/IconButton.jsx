import React from 'react';

const dim = { sm: 28, md: 34, lg: 40 };
const icon = { sm: 15, md: 16, lg: 18 };

/**
 * Atlas IconButton — a square button for a single icon action.
 * Used in toolbars, table rows, dialog close affordances.
 */
export function IconButton({
  variant = 'ghost',
  size = 'md',
  disabled = false,
  label,
  children,
  style,
  ...rest
}) {
  const d = dim[size] || dim.md;
  const isGhost = variant === 'ghost';
  const base = {
    background: isGhost ? 'transparent' : 'var(--surface-card)',
    color: 'var(--text-secondary)',
    border: isGhost ? '1px solid transparent' : '1px solid var(--border-default)',
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
      onMouseLeave={(e) => { e.currentTarget.style.background = base.background; e.currentTarget.style.color = 'var(--text-secondary)'; }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: d, height: d, flex: '0 0 auto',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 120ms ease, color 120ms ease',
        ...base, ...style,
      }}
      {...rest}
    >
      <span style={{ display: 'inline-flex', width: icon[size] || 16, height: icon[size] || 16 }}>{children}</span>
    </button>
  );
}

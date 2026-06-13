import React from 'react';

const sizes = {
  sm: { height: 30, font: 'var(--text-sm)', pad: 8 },
  md: { height: 34, font: 'var(--text-body)', pad: 10 },
  lg: { height: 40, font: 'var(--text-body)', pad: 12 },
};

/**
 * Atlas Input — single-line text field.
 * Supports label, hint, error, and inline leading/trailing adornments.
 */
export function Input({
  size = 'md',
  label,
  hint,
  error,
  required = false,
  iconLeft = null,
  trailing = null,
  id,
  style,
  ...rest
}) {
  const s = sizes[size] || sizes.md;
  const inputId = id || (label ? `in-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const invalid = !!error;
  const [focused, setFocused] = React.useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {label && (
        <label htmlFor={inputId} style={{ font: `var(--weight-medium) var(--text-sm)/1 var(--font-sans)`, color: 'var(--text-secondary)' }}>
          {label}{required && <span style={{ color: 'var(--status-danger)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: s.height, padding: `0 ${s.pad}px`,
          background: 'var(--surface-card)',
          border: `1px solid ${invalid ? 'var(--status-danger)' : focused ? 'var(--focus-ring)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius-sm)',
          boxShadow: focused ? (invalid ? 'var(--ring-danger)' : 'var(--ring-focus)') : 'none',
          transition: 'border-color 120ms ease, box-shadow 120ms ease',
        }}
      >
        {iconLeft && <span style={{ display: 'inline-flex', width: 16, height: 16, color: 'var(--text-tertiary)', flex: '0 0 auto' }}>{iconLeft}</span>}
        <input
          id={inputId}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-invalid={invalid}
          style={{
            flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
            font: `var(--weight-regular) ${s.font}/1.2 var(--font-sans)`,
            color: 'var(--text-primary)', padding: 0, ...style,
          }}
          {...rest}
        />
        {trailing && <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-tertiary)', flex: '0 0 auto' }}>{trailing}</span>}
      </div>
      {(hint || error) && (
        <span style={{ font: `var(--text-xs)/1.4 var(--font-sans)`, color: invalid ? 'var(--status-danger)' : 'var(--text-tertiary)' }}>
          {error || hint}
        </span>
      )}
    </div>
  );
}

import React from 'react';

/**
 * Atlas Textarea — multi-line text input with label/hint/error.
 */
export function Textarea({ label, hint, error, required = false, rows = 4, id, style, ...rest }) {
  const taId = id || (label ? `ta-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const invalid = !!error;
  const [focused, setFocused] = React.useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {label && <label htmlFor={taId} style={{ font: 'var(--weight-medium) var(--text-sm)/1 var(--font-sans)', color: 'var(--text-secondary)' }}>{label}{required && <span style={{ color: 'var(--status-danger)', marginLeft: 2 }}>*</span>}</label>}
      <textarea
        id={taId}
        rows={rows}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-invalid={invalid}
        style={{
          width: '100%', padding: '8px 10px', resize: 'vertical',
          font: 'var(--weight-regular) var(--text-body)/1.5 var(--font-sans)',
          color: 'var(--text-primary)', background: 'var(--surface-card)',
          border: `1px solid ${invalid ? 'var(--status-danger)' : focused ? 'var(--focus-ring)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius-sm)',
          boxShadow: focused ? (invalid ? 'var(--ring-danger)' : 'var(--ring-focus)') : 'none',
          outline: 'none', transition: 'border-color 120ms ease, box-shadow 120ms ease',
          ...style,
        }}
        {...rest}
      />
      {(hint || error) && <span style={{ font: 'var(--text-xs)/1.4 var(--font-sans)', color: invalid ? 'var(--status-danger)' : 'var(--text-tertiary)' }}>{error || hint}</span>}
    </div>
  );
}

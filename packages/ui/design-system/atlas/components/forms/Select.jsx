import React from 'react';

const sizes = {
  sm: { height: 30, font: 'var(--text-sm)', pad: 8 },
  md: { height: 34, font: 'var(--text-body)', pad: 10 },
  lg: { height: 40, font: 'var(--text-body)', pad: 12 },
};

/**
 * Atlas Select — styled native <select> for short, known option sets.
 * Keeps native a11y + keyboard behavior; restyles the chrome only.
 */
export function Select({ size = 'md', label, hint, error, options = [], placeholder, id, style, ...rest }) {
  const s = sizes[size] || sizes.md;
  const selId = id || (label ? `sel-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const invalid = !!error;
  const [focused, setFocused] = React.useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {label && <label htmlFor={selId} style={{ font: 'var(--weight-medium) var(--text-sm)/1 var(--font-sans)', color: 'var(--text-secondary)' }}>{label}</label>}
      <div style={{ position: 'relative', display: 'flex' }}>
        <select
          id={selId}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            appearance: 'none', WebkitAppearance: 'none',
            width: '100%', height: s.height, padding: `0 32px 0 ${s.pad}px`,
            font: `var(--weight-regular) ${s.font}/1 var(--font-sans)`,
            color: 'var(--text-primary)', background: 'var(--surface-card)',
            border: `1px solid ${invalid ? 'var(--status-danger)' : focused ? 'var(--focus-ring)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--radius-sm)',
            boxShadow: focused ? (invalid ? 'var(--ring-danger)' : 'var(--ring-focus)') : 'none',
            outline: 'none', cursor: 'pointer', transition: 'border-color 120ms ease, box-shadow 120ms ease',
            ...style,
          }}
          {...rest}
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map((o) => {
            const val = typeof o === 'string' ? o : o.value;
            const lbl = typeof o === 'string' ? o : o.label;
            return <option key={val} value={val}>{lbl}</option>;
          })}
        </select>
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)', display: 'inline-flex' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
      </div>
      {(hint || error) && <span style={{ font: 'var(--text-xs)/1.4 var(--font-sans)', color: invalid ? 'var(--status-danger)' : 'var(--text-tertiary)' }}>{error || hint}</span>}
    </div>
  );
}

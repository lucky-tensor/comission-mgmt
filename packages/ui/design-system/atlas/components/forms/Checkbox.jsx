import React from 'react';

/**
 * Atlas Checkbox — multi-select / boolean form input.
 * Square control with an ink fill and optional label + description.
 */
export function Checkbox({ checked = false, indeterminate = false, onChange, disabled = false, label, description, id, ...rest }) {
  const cbId = id || (label ? `cb-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const active = checked || indeterminate;
  const box = (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 17, height: 17, flex: '0 0 auto', marginTop: description ? 1 : 0,
        borderRadius: 'var(--radius-xs)',
        border: `1.5px solid ${active ? 'var(--action-primary)' : 'var(--border-strong)'}`,
        background: active ? 'var(--action-primary)' : 'var(--surface-card)',
        color: 'var(--gray-0)', transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      {indeterminate ? (
        <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      ) : checked ? (
        <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6.2l2.2 2.3 4.8-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
      ) : null}
    </span>
  );
  return (
    <label htmlFor={cbId} style={{ display: 'inline-flex', alignItems: description ? 'flex-start' : 'center', gap: 9, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" id={cbId} checked={checked} disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} {...rest} />
      {box}
      {(label || description) && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {label && <span style={{ font: 'var(--text-body)/1.3 var(--font-sans)', color: 'var(--text-primary)' }}>{label}</span>}
          {description && <span style={{ font: 'var(--text-xs)/1.4 var(--font-sans)', color: 'var(--text-tertiary)' }}>{description}</span>}
        </span>
      )}
    </label>
  );
}

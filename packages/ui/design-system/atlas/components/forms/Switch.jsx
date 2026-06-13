import React from 'react';

/**
 * Atlas Switch — binary on/off toggle for instant settings.
 * Use for state that applies immediately; use Checkbox for form submission.
 */
export function Switch({ checked = false, onChange, disabled = false, label, id, ...rest }) {
  const switchId = id || (label ? `sw-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const control = (
    <button
      type="button"
      role="switch"
      id={switchId}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
        position: 'relative', width: 36, height: 20, flex: '0 0 auto',
        borderRadius: 'var(--radius-full)', border: 'none', padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        background: checked ? 'var(--action-primary)' : 'var(--gray-300)',
        transition: 'background 140ms ease',
      }}
      {...rest}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2,
        width: 16, height: 16, borderRadius: 'var(--radius-full)',
        background: 'var(--gray-0)', boxShadow: 'var(--shadow-xs)',
        transition: 'left 140ms cubic-bezier(0.34,1.4,0.5,1)',
      }} />
    </button>
  );
  if (!label) return control;
  return (
    <label htmlFor={switchId} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      {control}
      <span style={{ font: 'var(--text-body)/1 var(--font-sans)', color: 'var(--text-primary)' }}>{label}</span>
    </label>
  );
}

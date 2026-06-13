import React from 'react';

/**
 * Atlas Tabs — underline tab bar for switching views within a page.
 * items: [{ value, label, count? }]. Controlled via value/onChange.
 */
export function Tabs({ items = [], value, onChange, style, ...rest }) {
  return (
    <div role="tablist"
      style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-default)', ...style }} {...rest}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button key={it.value} role="tab" aria-selected={active}
            onClick={() => onChange && onChange(it.value)}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)'; }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0 4px', height: 36, marginBottom: -1,
              background: 'transparent', border: 'none', cursor: 'pointer',
              font: `var(--weight-medium) var(--text-sm)/1 var(--font-sans)`,
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${active ? 'var(--action-primary)' : 'transparent'}`,
              marginRight: 14, transition: 'color 120ms ease',
            }}>
            {it.label}
            {it.count != null && (
              <span style={{
                font: 'var(--weight-medium) var(--text-2xs)/1 var(--font-mono)',
                padding: '2px 5px', borderRadius: 'var(--radius-xs)',
                background: active ? 'var(--gray-150)' : 'var(--surface-sunken)',
                color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums',
              }}>{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

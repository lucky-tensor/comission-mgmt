import React from 'react';

/**
 * Atlas Card — bordered content surface. Atlas cards rely on a 1px
 * border, not shadow. Optional header (title + actions) and padding control.
 */
export function Card({ title, subtitle, actions, padding = 'md', children, style, ...rest }) {
  const pad = padding === 'none' ? 0 : padding === 'sm' ? 12 : padding === 'lg' ? 24 : 16;
  return (
    <section
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden', ...style,
      }}
      {...rest}
    >
      {(title || actions) && (
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {title && <h3 style={{ font: 'var(--weight-semibold) var(--text-h3)/1.2 var(--font-sans)', letterSpacing: 'var(--tracking-snug)' }}>{title}</h3>}
            {subtitle && <span style={{ font: 'var(--text-sm)/1.3 var(--font-sans)', color: 'var(--text-tertiary)' }}>{subtitle}</span>}
          </div>
          {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>{actions}</div>}
        </header>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </section>
  );
}

import React from 'react';

/**
 * Atlas Breadcrumb — location trail for nested CRUD records.
 * items: [{ label, href? }]. The last item renders as the current page.
 */
export function Breadcrumb({ items = [], style, ...rest }) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, ...style }} {...rest}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {last || !it.href ? (
              <span style={{ font: `${last ? 'var(--weight-medium)' : 'var(--weight-regular)'} var(--text-sm)/1 var(--font-sans)`, color: last ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{it.label}</span>
            ) : (
              <a href={it.href}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                style={{ font: 'var(--text-sm)/1 var(--font-sans)', color: 'var(--text-tertiary)', textDecoration: 'none', transition: 'color 120ms ease' }}>{it.label}</a>
            )}
            {!last && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--gray-300)' }}><path d="M6.5 4l3.5 4-3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
          </span>
        );
      })}
    </nav>
  );
}

import React from 'react';

/**
 * Atlas Pagination — page controls for tables and lists.
 * Shows a range summary plus prev/next; emits onPageChange(nextPage).
 */
export function Pagination({ page = 1, pageSize = 25, total = 0, onPageChange, style, ...rest }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const arrow = (dir, disabled, target) => (
    <button type="button" disabled={disabled} onClick={() => !disabled && onPageChange && onPageChange(target)}
      aria-label={dir === 'prev' ? 'Previous page' : 'Next page'}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-card)'; }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, background: 'var(--surface-card)',
        border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
        color: 'var(--text-secondary)', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1, transition: 'background 120ms ease',
      }}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d={dir === 'prev' ? 'M10 4L6 8l4 4' : 'M6 4l4 4-4 4'} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, ...style }} {...rest}>
      <span style={{ font: 'var(--text-sm)/1 var(--font-sans)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {arrow('prev', page <= 1, page - 1)}
        <span style={{ font: 'var(--text-sm)/1 var(--font-sans)', color: 'var(--text-secondary)', padding: '0 4px', fontVariantNumeric: 'tabular-nums' }}>Page {page} of {pages}</span>
        {arrow('next', page >= pages, page + 1)}
      </div>
    </div>
  );
}

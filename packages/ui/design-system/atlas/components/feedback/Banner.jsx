import React from 'react';

const tones = {
  info:    { bg: 'var(--gray-100)', bd: 'var(--gray-200)', fg: 'var(--gray-800)', icon: 'var(--gray-600)' },
  success: { bg: 'var(--status-success-soft)', bd: 'var(--green-100)', fg: 'var(--green-700)', icon: 'var(--green-600)' },
  warning: { bg: 'var(--gray-100)', bd: 'var(--gray-200)', fg: 'var(--gray-800)', icon: 'var(--gray-600)' },
  danger:  { bg: 'var(--status-danger-soft)', bd: 'var(--red-100)', fg: 'var(--red-700)', icon: 'var(--red-600)' },
};

const glyphs = {
  info: 'M8 7.5v4M8 5.2v.2', success: 'M5 8.3l2 2 4-4.4', warning: 'M8 5v3.5M8 11v.1', danger: 'M5.5 5.5l5 5M10.5 5.5l-5 5',
};

/**
 * Atlas Banner — inline contextual message at the top of a view or form.
 */
export function Banner({ tone = 'info', title, children, onDismiss, action, style, ...rest }) {
  const t = tones[tone] || tones.info;
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '11px 12px', background: t.bg,
        border: `1px solid ${t.bd}`, borderRadius: 'var(--radius-sm)', ...style,
      }}
      {...rest}
    >
      <span style={{ display: 'inline-flex', width: 16, height: 16, flex: '0 0 auto', marginTop: 1, color: t.icon }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" opacity="0.45"/><path d={glyphs[tone]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {title && <span style={{ font: 'var(--weight-semibold) var(--text-sm)/1.3 var(--font-sans)', color: t.fg }}>{title}</span>}
        {children && <span style={{ font: 'var(--text-sm)/1.45 var(--font-sans)', color: 'var(--text-secondary)' }}>{children}</span>}
        {action && <div style={{ marginTop: 6 }}>{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss"
          style={{ display: 'inline-flex', width: 18, height: 18, border: 'none', background: 'transparent', color: t.fg, cursor: 'pointer', opacity: 0.7, flex: '0 0 auto' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      )}
    </div>
  );
}

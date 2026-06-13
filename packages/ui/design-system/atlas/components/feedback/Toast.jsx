import React from 'react';

const tones = {
  neutral: 'var(--gray-500)', success: 'var(--green-500)',
  danger: 'var(--red-500)', warning: 'var(--gray-500)', info: 'var(--gray-500)',
};

/**
 * Atlas Toast — transient confirmation. Render a single toast; manage a
 * stack yourself by mapping several into a fixed bottom-right container.
 */
export function Toast({ tone = 'neutral', title, message, onDismiss, style, ...rest }) {
  return (
    <div role="status"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, width: 320,
        padding: '12px 12px 12px 14px', background: 'var(--surface-card)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)', ...style,
      }}
      {...rest}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: tones[tone] || tones.neutral, flex: '0 0 auto', marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {title && <span style={{ font: 'var(--weight-semibold) var(--text-sm)/1.3 var(--font-sans)', color: 'var(--text-primary)' }}>{title}</span>}
        {message && <span style={{ font: 'var(--text-sm)/1.4 var(--font-sans)', color: 'var(--text-tertiary)' }}>{message}</span>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss"
          style={{ display: 'inline-flex', width: 18, height: 18, border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', flex: '0 0 auto' }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      )}
    </div>
  );
}

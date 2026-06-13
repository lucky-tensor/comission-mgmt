import React from 'react';

const tones = {
  neutral: { bg: 'var(--gray-100)', fg: 'var(--gray-700)', dot: 'var(--gray-500)' },
  info:    { bg: 'var(--gray-100)', fg: 'var(--gray-700)', dot: 'var(--gray-500)' },
  success: { bg: 'var(--status-success-soft)', fg: 'var(--green-700)', dot: 'var(--green-500)' },
  warning: { bg: 'var(--gray-100)', fg: 'var(--gray-700)', dot: 'var(--gray-500)' },
  danger:  { bg: 'var(--status-danger-soft)', fg: 'var(--red-700)', dot: 'var(--red-500)' },
};

/**
 * Atlas Badge — compact status / category label.
 * `dot` shows a leading status dot (great for record state: Active, Paused…).
 */
export function Badge({ tone = 'neutral', dot = false, children, style, ...rest }) {
  const t = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 20, padding: dot ? '0 8px 0 7px' : '0 8px',
        background: t.bg, color: t.fg,
        font: 'var(--weight-medium) var(--text-xs)/1 var(--font-sans)',
        letterSpacing: 'var(--tracking-snug)',
        borderRadius: 'var(--radius-xs)', whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot, flex: '0 0 auto' }} />}
      {children}
    </span>
  );
}

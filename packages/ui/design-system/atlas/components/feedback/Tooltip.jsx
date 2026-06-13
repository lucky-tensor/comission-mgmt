import React from 'react';

/**
 * Atlas Tooltip — hover/focus hint on a single trigger element.
 * Pure CSS-positioned; wraps one child trigger.
 */
export function Tooltip({ content, side = 'top', children }) {
  const [open, setOpen] = React.useState(false);
  const pos = {
    top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 },
    bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 },
    left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 6 },
    right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 6 },
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)} onBlurCapture={() => setOpen(false)}>
      {children}
      <span role="tooltip" style={{
        position: 'absolute', zIndex: 50, ...pos[side],
        padding: '5px 8px', whiteSpace: 'nowrap', pointerEvents: 'none',
        font: 'var(--weight-medium) var(--text-xs)/1.3 var(--font-sans)',
        color: 'var(--text-inverse)', background: 'var(--surface-inverse)',
        borderRadius: 'var(--radius-xs)', boxShadow: 'var(--shadow-sm)',
        opacity: open ? 1 : 0, transform: `${pos[side].transform} translateY(${open ? 0 : side === 'top' ? '2px' : '-2px'})`,
        transition: 'opacity 120ms ease', }}>
        {content}
      </span>
    </span>
  );
}

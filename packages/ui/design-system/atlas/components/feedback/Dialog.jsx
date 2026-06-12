import React from 'react';

/**
 * Atlas Dialog — centered modal for focused tasks and confirmations.
 * Renders nothing when `open` is false. Handles overlay + Esc to close.
 */
export function Dialog({ open, onClose, title, description, children, footer, width = 460 }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        background: 'rgba(14,16,22,0.45)', backdropFilter: 'blur(2px)',
        animation: 'atlas-fade 140ms ease',
      }}
    >
      <div role="dialog" aria-modal="true"
        style={{
          width: '100%', maxWidth: width, maxHeight: '90vh', overflow: 'auto',
          background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-lg)',
          animation: 'atlas-pop 160ms cubic-bezier(0.2,0.9,0.3,1)',
        }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 20px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            {title && <h2 style={{ font: 'var(--weight-semibold) var(--text-h2)/1.2 var(--font-sans)', letterSpacing: 'var(--tracking-tight)' }}>{title}</h2>}
            {description && <p style={{ font: 'var(--text-sm)/1.45 var(--font-sans)', color: 'var(--text-tertiary)' }}>{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ display: 'inline-flex', width: 28, height: 28, alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', flex: '0 0 auto', marginTop: -2 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </header>
        {children && <div style={{ padding: '14px 20px', font: 'var(--text-body)/1.5 var(--font-sans)', color: 'var(--text-secondary)' }}>{children}</div>}
        {footer && <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px 18px', borderTop: '1px solid var(--border-subtle)' }}>{footer}</footer>}
      </div>
      <style>{`@keyframes atlas-fade{from{opacity:0}to{opacity:1}}@keyframes atlas-pop{from{opacity:0;transform:translateY(6px) scale(0.985)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

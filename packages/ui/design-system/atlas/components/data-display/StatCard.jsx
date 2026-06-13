import React from 'react';

const trends = {
  up: { color: 'var(--status-success)', arrow: 'M3 9l4-4 4 4' },
  down: { color: 'var(--status-danger)', arrow: 'M3 5l4 4 4-4' },
  flat: { color: 'var(--text-tertiary)', arrow: 'M3 7h8' },
};

/**
 * Atlas StatCard — a single KPI tile for dashboard overviews.
 */
export function StatCard({ label, value, delta, trend = 'flat', icon, style, ...rest }) {
  const t = trends[trend] || trends.flat;
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: 16, background: 'var(--surface-card)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="atlas-overline">{label}</span>
        {icon && <span style={{ display: 'inline-flex', width: 16, height: 16, color: 'var(--text-tertiary)' }}>{icon}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ font: 'var(--weight-semibold) var(--text-display)/1 var(--font-sans)', letterSpacing: 'var(--tracking-tight)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {delta != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, font: 'var(--weight-medium) var(--text-sm)/1 var(--font-sans)', color: t.color }}>
            <svg width="13" height="12" viewBox="0 0 14 12" fill="none"><path d={t.arrow} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

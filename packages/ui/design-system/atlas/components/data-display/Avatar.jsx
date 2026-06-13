import React from 'react';

const dims = { xs: 20, sm: 24, md: 32, lg: 40 };
const fonts = { xs: 10, sm: 11, md: 13, lg: 15 };

const palette = [
  ['#e6e6ea', '#3d4051'], ['#d6d6db', '#272935'], ['#272935', '#ffffff'],
  ['#55596f', '#ffffff'], ['#f0eff2', '#55596f'],
];

function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function hashIndex(s) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % palette.length;
}

/**
 * Atlas Avatar — user / entity identity chip.
 * Renders an image when `src` is set, otherwise color-seeded initials.
 */
export function Avatar({ name = '', src, size = 'md', style, ...rest }) {
  const d = dims[size] || dims.md;
  const [bg, fg] = palette[hashIndex(name || 'x')];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: d, height: d, flex: '0 0 auto', overflow: 'hidden',
        borderRadius: 'var(--radius-full)', background: src ? 'var(--gray-200)' : bg,
        color: fg, font: `var(--weight-semibold) ${fonts[size] || 13}px/1 var(--font-sans)`,
        userSelect: 'none', ...style,
      }}
      title={name}
      {...rest}
    >
      {src ? <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(name)}
    </span>
  );
}

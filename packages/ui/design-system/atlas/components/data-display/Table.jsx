import React from 'react';

/**
 * Atlas Table — the workhorse of CRUD admin views.
 * Declarative columns + rows, with optional row selection and a hover state.
 * columns: [{ key, header, width, align, render? }]
 */
export function Table({ columns = [], data = [], selectable = false, selected = [], onSelectedChange, rowKey = 'id', empty = 'No records', style, ...rest }) {
  const allChecked = selectable && data.length > 0 && selected.length === data.length;
  const someChecked = selectable && selected.length > 0 && !allChecked;
  const headRef = React.useRef(null);

  const toggleAll = () => {
    if (!onSelectedChange) return;
    onSelectedChange(allChecked ? [] : data.map((r) => r[rowKey]));
  };
  const toggleRow = (id) => {
    if (!onSelectedChange) return;
    onSelectedChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const th = {
    padding: '0 14px', height: 36, textAlign: 'left',
    font: 'var(--weight-semibold) var(--text-2xs)/1 var(--font-sans)',
    letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase',
    color: 'var(--text-tertiary)', background: 'var(--surface-sunken)',
    borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap',
    position: 'sticky', top: 0,
  };
  const td = {
    padding: '10px 14px',
    font: 'var(--text-sm)/1.4 var(--font-sans)', color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle',
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...style }} {...rest}>
      <thead>
        <tr>
          {selectable && (
            <th style={{ ...th, width: 40, paddingRight: 0 }}>
              <input type="checkbox" ref={(el) => { if (el) el.indeterminate = someChecked; }} checked={allChecked} onChange={toggleAll}
                style={{ width: 15, height: 15, accentColor: 'var(--action-primary)', cursor: 'pointer' }} />
            </th>
          )}
          {columns.map((c) => (
            <th key={c.key} style={{ ...th, width: c.width, textAlign: c.align || 'left' }}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr><td colSpan={columns.length + (selectable ? 1 : 0)} style={{ ...td, textAlign: 'center', color: 'var(--text-tertiary)', padding: '32px 14px' }}>{empty}</td></tr>
        ) : data.map((row) => {
          const id = row[rowKey];
          const isSel = selected.includes(id);
          return (
            <tr key={id}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isSel ? 'var(--accent-soft)' : 'transparent'; }}
              style={{ background: isSel ? 'var(--accent-soft)' : 'transparent', transition: 'background 100ms ease' }}>
              {selectable && (
                <td style={{ ...td, width: 40, paddingRight: 0 }}>
                  <input type="checkbox" checked={isSel} onChange={() => toggleRow(id)}
                    style={{ width: 15, height: 15, accentColor: 'var(--action-primary)', cursor: 'pointer' }} />
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} style={{ ...td, textAlign: c.align || 'left' }}>
                  {c.render ? c.render(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

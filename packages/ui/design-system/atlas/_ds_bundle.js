/* @ds-bundle: {"format":3,"namespace":"AtlasDesignSystem_9b7d80","components":[{"name":"Avatar","sourcePath":"components/data-display/Avatar.jsx"},{"name":"Badge","sourcePath":"components/data-display/Badge.jsx"},{"name":"Card","sourcePath":"components/data-display/Card.jsx"},{"name":"StatCard","sourcePath":"components/data-display/StatCard.jsx"},{"name":"Table","sourcePath":"components/data-display/Table.jsx"},{"name":"Banner","sourcePath":"components/feedback/Banner.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"IconButton","sourcePath":"components/forms/IconButton.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Breadcrumb","sourcePath":"components/navigation/Breadcrumb.jsx"},{"name":"Pagination","sourcePath":"components/navigation/Pagination.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/data-display/Avatar.jsx":"f76905660c08","components/data-display/Badge.jsx":"38cb4b607c3e","components/data-display/Card.jsx":"8bd0f4a92dad","components/data-display/StatCard.jsx":"e26045215ece","components/data-display/Table.jsx":"318864fece4c","components/feedback/Banner.jsx":"c33fedaf920a","components/feedback/Dialog.jsx":"d12d6b382e51","components/feedback/Toast.jsx":"74d78ea111ea","components/feedback/Tooltip.jsx":"3870c4aa6d44","components/forms/Button.jsx":"625319608382","components/forms/Checkbox.jsx":"15059c27f584","components/forms/IconButton.jsx":"59e79fa14ae7","components/forms/Input.jsx":"ffae508108cc","components/forms/Select.jsx":"8688465dd4b5","components/forms/Switch.jsx":"928fc4b7e1f5","components/forms/Textarea.jsx":"c2e339ebfffd","components/navigation/Breadcrumb.jsx":"804510c256fd","components/navigation/Pagination.jsx":"ccbdacef1bc5","components/navigation/Tabs.jsx":"8f674a01914d","guidelines/tweaks-panel.jsx":"6591467622ed","ui_kits/admin-console/App.jsx":"f92533ba36df","ui_kits/admin-console/DashboardScreen.jsx":"f51226398d84","ui_kits/admin-console/SettingsScreen.jsx":"2fcdd85b6b26","ui_kits/admin-console/Shell.jsx":"0945e567c0ee","ui_kits/admin-console/UserDetailScreen.jsx":"0c0dc3848d14","ui_kits/admin-console/UsersScreen.jsx":"9451a84cc603","ui_kits/admin-console/kit-lib.jsx":"e5a03325c13b"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AtlasDesignSystem_9b7d80 = window.AtlasDesignSystem_9b7d80 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/data-display/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const dims = {
  xs: 20,
  sm: 24,
  md: 32,
  lg: 40
};
const fonts = {
  xs: 10,
  sm: 11,
  md: 13,
  lg: 15
};
const palette = [['#e6e6ea', '#3d4051'], ['#d6d6db', '#272935'], ['#272935', '#ffffff'], ['#55596f', '#ffffff'], ['#f0eff2', '#55596f']];
function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function hashIndex(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
  return Math.abs(h) % palette.length;
}

/**
 * Atlas Avatar — user / entity identity chip.
 * Renders an image when `src` is set, otherwise color-seeded initials.
 */
function Avatar({
  name = '',
  src,
  size = 'md',
  style,
  ...rest
}) {
  const d = dims[size] || dims.md;
  const [bg, fg] = palette[hashIndex(name || 'x')];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: d,
      height: d,
      flex: '0 0 auto',
      overflow: 'hidden',
      borderRadius: 'var(--radius-full)',
      background: src ? 'var(--gray-200)' : bg,
      color: fg,
      font: `var(--weight-semibold) ${fonts[size] || 13}px/1 var(--font-sans)`,
      userSelect: 'none',
      ...style
    },
    title: name
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials(name));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const tones = {
  neutral: {
    bg: 'var(--gray-100)',
    fg: 'var(--gray-700)',
    dot: 'var(--gray-500)'
  },
  info: {
    bg: 'var(--gray-100)',
    fg: 'var(--gray-700)',
    dot: 'var(--gray-500)'
  },
  success: {
    bg: 'var(--status-success-soft)',
    fg: 'var(--green-700)',
    dot: 'var(--green-500)'
  },
  warning: {
    bg: 'var(--gray-100)',
    fg: 'var(--gray-700)',
    dot: 'var(--gray-500)'
  },
  danger: {
    bg: 'var(--status-danger-soft)',
    fg: 'var(--red-700)',
    dot: 'var(--red-500)'
  }
};

/**
 * Atlas Badge — compact status / category label.
 * `dot` shows a leading status dot (great for record state: Active, Paused…).
 */
function Badge({
  tone = 'neutral',
  dot = false,
  children,
  style,
  ...rest
}) {
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 20,
      padding: dot ? '0 8px 0 7px' : '0 8px',
      background: t.bg,
      color: t.fg,
      font: 'var(--weight-medium) var(--text-xs)/1 var(--font-sans)',
      letterSpacing: 'var(--tracking-snug)',
      borderRadius: 'var(--radius-xs)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: t.dot,
      flex: '0 0 auto'
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atlas Card — bordered content surface. Atlas cards rely on a 1px
 * border, not shadow. Optional header (title + actions) and padding control.
 */
function Card({
  title,
  subtitle,
  actions,
  padding = 'md',
  children,
  style,
  ...rest
}) {
  const pad = padding === 'none' ? 0 : padding === 'sm' ? 12 : padding === 'lg' ? 24 : 16;
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      ...style
    }
  }, rest), (title || actions) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '12px 16px',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--weight-semibold) var(--text-h3)/1.2 var(--font-sans)',
      letterSpacing: 'var(--tracking-snug)'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-sm)/1.3 var(--font-sans)',
      color: 'var(--text-tertiary)'
    }
  }, subtitle)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flex: '0 0 auto'
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: pad
    }
  }, children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Card.jsx", error: String((e && e.message) || e) }); }

// components/data-display/StatCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const trends = {
  up: {
    color: 'var(--status-success)',
    arrow: 'M3 9l4-4 4 4'
  },
  down: {
    color: 'var(--status-danger)',
    arrow: 'M3 5l4 4 4-4'
  },
  flat: {
    color: 'var(--text-tertiary)',
    arrow: 'M3 7h8'
  }
};

/**
 * Atlas StatCard — a single KPI tile for dashboard overviews.
 */
function StatCard({
  label,
  value,
  delta,
  trend = 'flat',
  icon,
  style,
  ...rest
}) {
  const t = trends[trend] || trends.flat;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: 16,
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "atlas-overline"
  }, label), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      width: 16,
      height: 16,
      color: 'var(--text-tertiary)'
    }
  }, icon)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-semibold) var(--text-display)/1 var(--font-sans)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-primary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, value), delta != null && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      font: 'var(--weight-medium) var(--text-sm)/1 var(--font-sans)',
      color: t.color
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "12",
    viewBox: "0 0 14 12",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: t.arrow,
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), delta)));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Table.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atlas Table — the workhorse of CRUD admin views.
 * Declarative columns + rows, with optional row selection and a hover state.
 * columns: [{ key, header, width, align, render? }]
 */
function Table({
  columns = [],
  data = [],
  selectable = false,
  selected = [],
  onSelectedChange,
  rowKey = 'id',
  empty = 'No records',
  style,
  ...rest
}) {
  const allChecked = selectable && data.length > 0 && selected.length === data.length;
  const someChecked = selectable && selected.length > 0 && !allChecked;
  const headRef = React.useRef(null);
  const toggleAll = () => {
    if (!onSelectedChange) return;
    onSelectedChange(allChecked ? [] : data.map(r => r[rowKey]));
  };
  const toggleRow = id => {
    if (!onSelectedChange) return;
    onSelectedChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };
  const th = {
    padding: '0 14px',
    height: 36,
    textAlign: 'left',
    font: 'var(--weight-semibold) var(--text-2xs)/1 var(--font-sans)',
    letterSpacing: 'var(--tracking-wide)',
    textTransform: 'uppercase',
    color: 'var(--text-tertiary)',
    background: 'var(--surface-sunken)',
    borderBottom: '1px solid var(--border-default)',
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0
  };
  const td = {
    padding: '10px 14px',
    font: 'var(--text-sm)/1.4 var(--font-sans)',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border-subtle)',
    verticalAlign: 'middle'
  };
  return /*#__PURE__*/React.createElement("table", _extends({
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, selectable && /*#__PURE__*/React.createElement("th", {
    style: {
      ...th,
      width: 40,
      paddingRight: 0
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    ref: el => {
      if (el) el.indeterminate = someChecked;
    },
    checked: allChecked,
    onChange: toggleAll,
    style: {
      width: 15,
      height: 15,
      accentColor: 'var(--action-primary)',
      cursor: 'pointer'
    }
  })), columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: {
      ...th,
      width: c.width,
      textAlign: c.align || 'left'
    }
  }, c.header)))), /*#__PURE__*/React.createElement("tbody", null, data.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: columns.length + (selectable ? 1 : 0),
    style: {
      ...td,
      textAlign: 'center',
      color: 'var(--text-tertiary)',
      padding: '32px 14px'
    }
  }, empty)) : data.map(row => {
    const id = row[rowKey];
    const isSel = selected.includes(id);
    return /*#__PURE__*/React.createElement("tr", {
      key: id,
      onMouseEnter: e => {
        e.currentTarget.style.background = 'var(--surface-hover)';
      },
      onMouseLeave: e => {
        e.currentTarget.style.background = isSel ? 'var(--accent-soft)' : 'transparent';
      },
      style: {
        background: isSel ? 'var(--accent-soft)' : 'transparent',
        transition: 'background 100ms ease'
      }
    }, selectable && /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        width: 40,
        paddingRight: 0
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: isSel,
      onChange: () => toggleRow(id),
      style: {
        width: 15,
        height: 15,
        accentColor: 'var(--action-primary)',
        cursor: 'pointer'
      }
    })), columns.map(c => /*#__PURE__*/React.createElement("td", {
      key: c.key,
      style: {
        ...td,
        textAlign: c.align || 'left'
      }
    }, c.render ? c.render(row[c.key], row) : row[c.key])));
  })));
}
Object.assign(__ds_scope, { Table });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Table.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Banner.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const tones = {
  info: {
    bg: 'var(--gray-100)',
    bd: 'var(--gray-200)',
    fg: 'var(--gray-800)',
    icon: 'var(--gray-600)'
  },
  success: {
    bg: 'var(--status-success-soft)',
    bd: 'var(--green-100)',
    fg: 'var(--green-700)',
    icon: 'var(--green-600)'
  },
  warning: {
    bg: 'var(--gray-100)',
    bd: 'var(--gray-200)',
    fg: 'var(--gray-800)',
    icon: 'var(--gray-600)'
  },
  danger: {
    bg: 'var(--status-danger-soft)',
    bd: 'var(--red-100)',
    fg: 'var(--red-700)',
    icon: 'var(--red-600)'
  }
};
const glyphs = {
  info: 'M8 7.5v4M8 5.2v.2',
  success: 'M5 8.3l2 2 4-4.4',
  warning: 'M8 5v3.5M8 11v.1',
  danger: 'M5.5 5.5l5 5M10.5 5.5l-5 5'
};

/**
 * Atlas Banner — inline contextual message at the top of a view or form.
 */
function Banner({
  tone = 'info',
  title,
  children,
  onDismiss,
  action,
  style,
  ...rest
}) {
  const t = tones[tone] || tones.info;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "status",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '11px 12px',
      background: t.bg,
      border: `1px solid ${t.bd}`,
      borderRadius: 'var(--radius-sm)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      width: 16,
      height: 16,
      flex: '0 0 auto',
      marginTop: 1,
      color: t.icon
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "8",
    cy: "8",
    r: "7",
    stroke: "currentColor",
    strokeWidth: "1.3",
    opacity: "0.45"
  }), /*#__PURE__*/React.createElement("path", {
    d: glyphs[tone],
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, title && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-semibold) var(--text-sm)/1.3 var(--font-sans)',
      color: t.fg
    }
  }, title), children && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-sm)/1.45 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, children), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6
    }
  }, action)), onDismiss && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onDismiss,
    "aria-label": "Dismiss",
    style: {
      display: 'inline-flex',
      width: 18,
      height: 18,
      border: 'none',
      background: 'transparent',
      color: t.fg,
      cursor: 'pointer',
      opacity: 0.7,
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 4l8 8M12 4l-8 8",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }))));
}
Object.assign(__ds_scope, { Banner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Banner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
/**
 * Atlas Dialog — centered modal for focused tasks and confirmations.
 * Renders nothing when `open` is false. Handles overlay + Esc to close.
 */
function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 460
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onMouseDown: e => {
      if (e.target === e.currentTarget) onClose && onClose();
    },
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'rgba(14,16,22,0.45)',
      backdropFilter: 'blur(2px)',
      animation: 'atlas-fade 140ms ease'
    }
  }, /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    style: {
      width: '100%',
      maxWidth: width,
      maxHeight: '90vh',
      overflow: 'auto',
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-default)',
      boxShadow: 'var(--shadow-lg)',
      animation: 'atlas-pop 160ms cubic-bezier(0.2,0.9,0.3,1)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      padding: '18px 20px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--weight-semibold) var(--text-h2)/1.2 var(--font-sans)',
      letterSpacing: 'var(--tracking-tight)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--text-sm)/1.45 var(--font-sans)',
      color: 'var(--text-tertiary)'
    }
  }, description)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    "aria-label": "Close",
    style: {
      display: 'inline-flex',
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      border: 'none',
      background: 'transparent',
      color: 'var(--text-tertiary)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      flex: '0 0 auto',
      marginTop: -2
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 4l8 8M12 4l-8 8",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  })))), children && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 20px',
      font: 'var(--text-body)/1.5 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, children), footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      padding: '14px 20px 18px',
      borderTop: '1px solid var(--border-subtle)'
    }
  }, footer)), /*#__PURE__*/React.createElement("style", null, `@keyframes atlas-fade{from{opacity:0}to{opacity:1}}@keyframes atlas-pop{from{opacity:0;transform:translateY(6px) scale(0.985)}to{opacity:1;transform:none}}`));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const tones = {
  neutral: 'var(--gray-500)',
  success: 'var(--green-500)',
  danger: 'var(--red-500)',
  warning: 'var(--gray-500)',
  info: 'var(--gray-500)'
};

/**
 * Atlas Toast — transient confirmation. Render a single toast; manage a
 * stack yourself by mapping several into a fixed bottom-right container.
 */
function Toast({
  tone = 'neutral',
  title,
  message,
  onDismiss,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "status",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      width: 320,
      padding: '12px 12px 12px 14px',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: tones[tone] || tones.neutral,
      flex: '0 0 auto',
      marginTop: 5
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, title && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-semibold) var(--text-sm)/1.3 var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, title), message && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-sm)/1.4 var(--font-sans)',
      color: 'var(--text-tertiary)'
    }
  }, message)), onDismiss && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onDismiss,
    "aria-label": "Dismiss",
    style: {
      display: 'inline-flex',
      width: 18,
      height: 18,
      border: 'none',
      background: 'transparent',
      color: 'var(--text-tertiary)',
      cursor: 'pointer',
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 4l8 8M12 4l-8 8",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }))));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
/**
 * Atlas Tooltip — hover/focus hint on a single trigger element.
 * Pure CSS-positioned; wraps one child trigger.
 */
function Tooltip({
  content,
  side = 'top',
  children
}) {
  const [open, setOpen] = React.useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: 6
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginTop: 6
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginRight: 6
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginLeft: 6
    }
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocusCapture: () => setOpen(true),
    onBlurCapture: () => setOpen(false)
  }, children, /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      zIndex: 50,
      ...pos[side],
      padding: '5px 8px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      font: 'var(--weight-medium) var(--text-xs)/1.3 var(--font-sans)',
      color: 'var(--text-inverse)',
      background: 'var(--surface-inverse)',
      borderRadius: 'var(--radius-xs)',
      boxShadow: 'var(--shadow-sm)',
      opacity: open ? 1 : 0,
      transform: `${pos[side].transform} translateY(${open ? 0 : side === 'top' ? '2px' : '-2px'})`,
      transition: 'opacity 120ms ease'
    }
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: {
    height: 28,
    padding: '0 10px',
    font: 'var(--text-sm)',
    gap: 6,
    icon: 15
  },
  md: {
    height: 34,
    padding: '0 14px',
    font: 'var(--text-body)',
    gap: 7,
    icon: 16
  },
  lg: {
    height: 40,
    padding: '0 18px',
    font: 'var(--text-body)',
    gap: 8,
    icon: 18
  }
};
const variants = {
  primary: {
    background: 'var(--action-primary)',
    color: 'var(--action-primary-fg)',
    border: '1px solid var(--action-primary)',
    '--hover-bg': 'var(--action-primary-hover)',
    '--hover-bd': 'var(--action-primary-hover)'
  },
  secondary: {
    background: 'var(--surface-card)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-strong)',
    '--hover-bg': 'var(--surface-hover)',
    '--hover-bd': 'var(--border-strong)'
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid transparent',
    '--hover-bg': 'var(--surface-hover)',
    '--hover-bd': 'transparent'
  },
  accent: {
    background: 'var(--accent)',
    color: 'var(--accent-fg)',
    border: '1px solid var(--accent)',
    '--hover-bg': 'var(--accent-hover)',
    '--hover-bd': 'var(--accent-hover)'
  },
  danger: {
    background: 'var(--status-danger)',
    color: 'var(--gray-0)',
    border: '1px solid var(--status-danger)',
    '--hover-bg': 'var(--red-700)',
    '--hover-bd': 'var(--red-700)'
  }
};

/**
 * Atlas Button — the primary action control.
 * Primary defaults to ink (near-black); use accent sparingly for the single
 * most important affirmative action, danger for destructive ones.
 */
function Button({
  variant = 'secondary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  iconLeft = null,
  iconRight = null,
  type = 'button',
  children,
  style,
  ...rest
}) {
  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.secondary;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onMouseEnter: e => {
      if (!disabled) {
        e.currentTarget.style.background = v['--hover-bg'];
        e.currentTarget.style.borderColor = v['--hover-bd'];
      }
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = v.background;
      e.currentTarget.style.borderColor = 'transparent';
      e.currentTarget.style.border = v.border;
    },
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s.gap,
      height: s.height,
      padding: s.padding,
      width: fullWidth ? '100%' : 'auto',
      font: `var(--weight-medium) ${s.font}/1 var(--font-sans)`,
      letterSpacing: 'var(--tracking-snug)',
      borderRadius: 'var(--radius-sm)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap',
      userSelect: 'none',
      transition: 'background 120ms ease, border-color 120ms ease',
      background: v.background,
      color: v.color,
      border: v.border,
      ...style
    }
  }, rest), iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      width: s.icon,
      height: s.icon
    }
  }, iconLeft), children, iconRight && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      width: s.icon,
      height: s.icon
    }
  }, iconRight));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atlas Checkbox — multi-select / boolean form input.
 * Square control with an ink fill and optional label + description.
 */
function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  disabled = false,
  label,
  description,
  id,
  ...rest
}) {
  const cbId = id || (label ? `cb-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const active = checked || indeterminate;
  const box = /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 17,
      height: 17,
      flex: '0 0 auto',
      marginTop: description ? 1 : 0,
      borderRadius: 'var(--radius-xs)',
      border: `1.5px solid ${active ? 'var(--action-primary)' : 'var(--border-strong)'}`,
      background: active ? 'var(--action-primary)' : 'var(--surface-card)',
      color: 'var(--gray-0)',
      transition: 'background 120ms ease, border-color 120ms ease'
    }
  }, indeterminate ? /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 12 12"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 6h7",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  })) : checked ? /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 12 12"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 6.2l2.2 2.3 4.8-5",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none"
  })) : null);
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: cbId,
    style: {
      display: 'inline-flex',
      alignItems: description ? 'flex-start' : 'center',
      gap: 9,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    id: cbId,
    checked: checked,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.checked),
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), box, (label || description) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-body)/1.3 var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-xs)/1.4 var(--font-sans)',
      color: 'var(--text-tertiary)'
    }
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const dim = {
  sm: 28,
  md: 34,
  lg: 40
};
const icon = {
  sm: 15,
  md: 16,
  lg: 18
};

/**
 * Atlas IconButton — a square button for a single icon action.
 * Used in toolbars, table rows, dialog close affordances.
 */
function IconButton({
  variant = 'ghost',
  size = 'md',
  disabled = false,
  label,
  children,
  style,
  ...rest
}) {
  const d = dim[size] || dim.md;
  const isGhost = variant === 'ghost';
  const base = {
    background: isGhost ? 'transparent' : 'var(--surface-card)',
    color: 'var(--text-secondary)',
    border: isGhost ? '1px solid transparent' : '1px solid var(--border-default)'
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onMouseEnter: e => {
      if (!disabled) {
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = base.background;
      e.currentTarget.style.color = 'var(--text-secondary)';
    },
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: d,
      height: d,
      flex: '0 0 auto',
      borderRadius: 'var(--radius-sm)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'background 120ms ease, color 120ms ease',
      ...base,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      width: icon[size] || 16,
      height: icon[size] || 16
    }
  }, children));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: {
    height: 30,
    font: 'var(--text-sm)',
    pad: 8
  },
  md: {
    height: 34,
    font: 'var(--text-body)',
    pad: 10
  },
  lg: {
    height: 40,
    font: 'var(--text-body)',
    pad: 12
  }
};

/**
 * Atlas Input — single-line text field.
 * Supports label, hint, error, and inline leading/trailing adornments.
 */
function Input({
  size = 'md',
  label,
  hint,
  error,
  required = false,
  iconLeft = null,
  trailing = null,
  id,
  style,
  ...rest
}) {
  const s = sizes[size] || sizes.md;
  const inputId = id || (label ? `in-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const invalid = !!error;
  const [focused, setFocused] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      width: '100%'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      font: `var(--weight-medium) var(--text-sm)/1 var(--font-sans)`,
      color: 'var(--text-secondary)'
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--status-danger)',
      marginLeft: 2
    }
  }, "*")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: s.height,
      padding: `0 ${s.pad}px`,
      background: 'var(--surface-card)',
      border: `1px solid ${invalid ? 'var(--status-danger)' : focused ? 'var(--focus-ring)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focused ? invalid ? 'var(--ring-danger)' : 'var(--ring-focus)' : 'none',
      transition: 'border-color 120ms ease, box-shadow 120ms ease'
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      width: 16,
      height: 16,
      color: 'var(--text-tertiary)',
      flex: '0 0 auto'
    }
  }, iconLeft), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    "aria-invalid": invalid,
    style: {
      flex: 1,
      minWidth: 0,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      font: `var(--weight-regular) ${s.font}/1.2 var(--font-sans)`,
      color: 'var(--text-primary)',
      padding: 0,
      ...style
    }
  }, rest)), trailing && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      color: 'var(--text-tertiary)',
      flex: '0 0 auto'
    }
  }, trailing)), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      font: `var(--text-xs)/1.4 var(--font-sans)`,
      color: invalid ? 'var(--status-danger)' : 'var(--text-tertiary)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: {
    height: 30,
    font: 'var(--text-sm)',
    pad: 8
  },
  md: {
    height: 34,
    font: 'var(--text-body)',
    pad: 10
  },
  lg: {
    height: 40,
    font: 'var(--text-body)',
    pad: 12
  }
};

/**
 * Atlas Select — styled native <select> for short, known option sets.
 * Keeps native a11y + keyboard behavior; restyles the chrome only.
 */
function Select({
  size = 'md',
  label,
  hint,
  error,
  options = [],
  placeholder,
  id,
  style,
  ...rest
}) {
  const s = sizes[size] || sizes.md;
  const selId = id || (label ? `sel-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const invalid = !!error;
  const [focused, setFocused] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      width: '100%'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: selId,
    style: {
      font: 'var(--weight-medium) var(--text-sm)/1 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: selId,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      width: '100%',
      height: s.height,
      padding: `0 32px 0 ${s.pad}px`,
      font: `var(--weight-regular) ${s.font}/1 var(--font-sans)`,
      color: 'var(--text-primary)',
      background: 'var(--surface-card)',
      border: `1px solid ${invalid ? 'var(--status-danger)' : focused ? 'var(--focus-ring)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focused ? invalid ? 'var(--ring-danger)' : 'var(--ring-focus)' : 'none',
      outline: 'none',
      cursor: 'pointer',
      transition: 'border-color 120ms ease, box-shadow 120ms ease',
      ...style
    }
  }, rest), placeholder && /*#__PURE__*/React.createElement("option", {
    value: "",
    disabled: true
  }, placeholder), options.map(o => {
    const val = typeof o === 'string' ? o : o.value;
    const lbl = typeof o === 'string' ? o : o.label;
    return /*#__PURE__*/React.createElement("option", {
      key: val,
      value: val
    }, lbl);
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 10,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 6l4 4 4-4",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })))), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-xs)/1.4 var(--font-sans)',
      color: invalid ? 'var(--status-danger)' : 'var(--text-tertiary)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atlas Switch — binary on/off toggle for instant settings.
 * Use for state that applies immediately; use Checkbox for form submission.
 */
function Switch({
  checked = false,
  onChange,
  disabled = false,
  label,
  id,
  ...rest
}) {
  const switchId = id || (label ? `sw-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const control = /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "switch",
    id: switchId,
    "aria-checked": checked,
    disabled: disabled,
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      position: 'relative',
      width: 36,
      height: 20,
      flex: '0 0 auto',
      borderRadius: 'var(--radius-full)',
      border: 'none',
      padding: 0,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      background: checked ? 'var(--action-primary)' : 'var(--gray-300)',
      transition: 'background 140ms ease'
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: checked ? 18 : 2,
      width: 16,
      height: 16,
      borderRadius: 'var(--radius-full)',
      background: 'var(--gray-0)',
      boxShadow: 'var(--shadow-xs)',
      transition: 'left 140ms cubic-bezier(0.34,1.4,0.5,1)'
    }
  }));
  if (!label) return control;
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: switchId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer'
    }
  }, control, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-body)/1 var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atlas Textarea — multi-line text input with label/hint/error.
 */
function Textarea({
  label,
  hint,
  error,
  required = false,
  rows = 4,
  id,
  style,
  ...rest
}) {
  const taId = id || (label ? `ta-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const invalid = !!error;
  const [focused, setFocused] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      width: '100%'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: taId,
    style: {
      font: 'var(--weight-medium) var(--text-sm)/1 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--status-danger)',
      marginLeft: 2
    }
  }, "*")), /*#__PURE__*/React.createElement("textarea", _extends({
    id: taId,
    rows: rows,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    "aria-invalid": invalid,
    style: {
      width: '100%',
      padding: '8px 10px',
      resize: 'vertical',
      font: 'var(--weight-regular) var(--text-body)/1.5 var(--font-sans)',
      color: 'var(--text-primary)',
      background: 'var(--surface-card)',
      border: `1px solid ${invalid ? 'var(--status-danger)' : focused ? 'var(--focus-ring)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focused ? invalid ? 'var(--ring-danger)' : 'var(--ring-focus)' : 'none',
      outline: 'none',
      transition: 'border-color 120ms ease, box-shadow 120ms ease',
      ...style
    }
  }, rest)), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-xs)/1.4 var(--font-sans)',
      color: invalid ? 'var(--status-danger)' : 'var(--text-tertiary)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Breadcrumb.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atlas Breadcrumb — location trail for nested CRUD records.
 * items: [{ label, href? }]. The last item renders as the current page.
 */
function Breadcrumb({
  items = [],
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("nav", _extends({
    "aria-label": "Breadcrumb",
    style: {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 4,
      ...style
    }
  }, rest), items.map((it, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4
      }
    }, last || !it.href ? /*#__PURE__*/React.createElement("span", {
      style: {
        font: `${last ? 'var(--weight-medium)' : 'var(--weight-regular)'} var(--text-sm)/1 var(--font-sans)`,
        color: last ? 'var(--text-primary)' : 'var(--text-tertiary)'
      }
    }, it.label) : /*#__PURE__*/React.createElement("a", {
      href: it.href,
      onMouseEnter: e => {
        e.currentTarget.style.color = 'var(--text-primary)';
      },
      onMouseLeave: e => {
        e.currentTarget.style.color = 'var(--text-tertiary)';
      },
      style: {
        font: 'var(--text-sm)/1 var(--font-sans)',
        color: 'var(--text-tertiary)',
        textDecoration: 'none',
        transition: 'color 120ms ease'
      }
    }, it.label), !last && /*#__PURE__*/React.createElement("svg", {
      width: "14",
      height: "14",
      viewBox: "0 0 16 16",
      fill: "none",
      style: {
        color: 'var(--gray-300)'
      }
    }, /*#__PURE__*/React.createElement("path", {
      d: "M6.5 4l3.5 4-3.5 4",
      stroke: "currentColor",
      strokeWidth: "1.3",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    })));
  }));
}
Object.assign(__ds_scope, { Breadcrumb });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Breadcrumb.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Pagination.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atlas Pagination — page controls for tables and lists.
 * Shows a range summary plus prev/next; emits onPageChange(nextPage).
 */
function Pagination({
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
  style,
  ...rest
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const arrow = (dir, disabled, target) => /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: disabled,
    onClick: () => !disabled && onPageChange && onPageChange(target),
    "aria-label": dir === 'prev' ? 'Previous page' : 'Next page',
    onMouseEnter: e => {
      if (!disabled) e.currentTarget.style.background = 'var(--surface-hover)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = 'var(--surface-card)';
    },
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 30,
      height: 30,
      background: 'var(--surface-card)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--text-secondary)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'background 120ms ease'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 16 16",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: dir === 'prev' ? 'M10 4L6 8l4 4' : 'M6 4l4 4-4 4',
    stroke: "currentColor",
    strokeWidth: "1.4",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })));
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-sm)/1 var(--font-sans)',
      color: 'var(--text-tertiary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, from, "\u2013", to, " of ", total.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, arrow('prev', page <= 1, page - 1), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-sm)/1 var(--font-sans)',
      color: 'var(--text-secondary)',
      padding: '0 4px',
      fontVariantNumeric: 'tabular-nums'
    }
  }, "Page ", page, " of ", pages), arrow('next', page >= pages, page + 1)));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atlas Tabs — underline tab bar for switching views within a page.
 * items: [{ value, label, count? }]. Controlled via value/onChange.
 */
function Tabs({
  items = [],
  value,
  onChange,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    style: {
      display: 'flex',
      gap: 2,
      borderBottom: '1px solid var(--border-default)',
      ...style
    }
  }, rest), items.map(it => {
    const active = it.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.value,
      role: "tab",
      "aria-selected": active,
      onClick: () => onChange && onChange(it.value),
      onMouseEnter: e => {
        if (!active) e.currentTarget.style.color = 'var(--text-primary)';
      },
      onMouseLeave: e => {
        if (!active) e.currentTarget.style.color = 'var(--text-secondary)';
      },
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 4px',
        height: 36,
        marginBottom: -1,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        font: `var(--weight-medium) var(--text-sm)/1 var(--font-sans)`,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderBottom: `2px solid ${active ? 'var(--action-primary)' : 'transparent'}`,
        marginRight: 14,
        transition: 'color 120ms ease'
      }
    }, it.label, it.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--weight-medium) var(--text-2xs)/1 var(--font-mono)',
        padding: '2px 5px',
        borderRadius: 'var(--radius-xs)',
        background: active ? 'var(--gray-150)' : 'var(--surface-sunken)',
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, it.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// guidelines/tweaks-panel.jsx
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)

/* BEGIN USAGE */
// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
// Exports (to window): useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider,
//   TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// TweakRadio is the segmented control for 2–3 short options (auto-falls-back to
// TweakSelect past ~16/~10 chars per label); reach for TweakSelect directly when
// options are many or long. For color tweaks always curate 3-4 options rather than
// a free picker; an option can also be a whole 2–5 color palette (the stored value
// is the array). The Tweak* controls are a floor, not a ceiling — build custom
// controls inside the panel if a tweak calls for UI they don't cover.
/* END USAGE */
// ─────────────────────────────────────────────────────────────────────────────

const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;box-sizing:border-box;min-width:0;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
`;

// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk).
function useTweaks(defaults) {
  const [values, setValues] = React.useState(defaults);
  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null ? keyOrEdits : {
      [keyOrEdits]: val
    };
    setValues(prev => ({
      ...prev,
      ...edits
    }));
    window.parent.postMessage({
      type: '__edit_mode_set_keys',
      edits
    }, '*');
    // Same-window signal so in-page listeners (deck-stage rail thumbnails)
    // can react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', {
      detail: edits
    }));
  }, []);
  return [values, setTweak];
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({
  title = 'Tweaks',
  children
}) {
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef(null);
  const offsetRef = React.useRef({
    x: 16,
    y: 16
  });
  const PAD = 16;
  const clampToViewport = React.useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth,
      h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y))
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);
  React.useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);
  React.useEffect(() => {
    const onMsg = e => {
      const t = e?.data?.type;
      if (t === '__activate_edit_mode') setOpen(true);else if (t === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({
      type: '__edit_mode_available'
    }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const dismiss = () => {
    setOpen(false);
    window.parent.postMessage({
      type: '__edit_mode_dismissed'
    }, '*');
  };
  const onDragStart = e => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX,
      sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = ev => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy)
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  if (!open) return null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("style", null, __TWEAKS_STYLE), /*#__PURE__*/React.createElement("div", {
    ref: dragRef,
    className: "twk-panel",
    "data-omelette-chrome": "",
    style: {
      right: offsetRef.current.x,
      bottom: offsetRef.current.y
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-hd",
    onMouseDown: onDragStart
  }, /*#__PURE__*/React.createElement("b", null, title), /*#__PURE__*/React.createElement("button", {
    className: "twk-x",
    "aria-label": "Close tweaks",
    onMouseDown: e => e.stopPropagation(),
    onClick: dismiss
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "twk-body"
  }, children)));
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function TweakSection({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "twk-sect"
  }, label), children);
}
function TweakRow({
  label,
  value,
  children,
  inline = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: inline ? 'twk-row twk-row-h' : 'twk-row'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label), value != null && /*#__PURE__*/React.createElement("span", {
    className: "twk-val"
  }, value)), children);
}

// ── Controls ────────────────────────────────────────────────────────────────

function TweakSlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label,
    value: `${value}${unit}`
  }, /*#__PURE__*/React.createElement("input", {
    type: "range",
    className: "twk-slider",
    min: min,
    max: max,
    step: step,
    value: value,
    onChange: e => onChange(Number(e.target.value))
  }));
}
function TweakToggle({
  label,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-row twk-row-h"
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "twk-toggle",
    "data-on": value ? '1' : '0',
    role: "switch",
    "aria-checked": !!value,
    onClick: () => onChange(!value)
  }, /*#__PURE__*/React.createElement("i", null)));
}
function TweakRadio({
  label,
  value,
  options,
  onChange
}) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  // The active value is read by pointer-move handlers attached for the lifetime
  // of a drag — ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
  // to its own padding, and 11.5px system-ui averages ~6.3px/char — so 2
  // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = o => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({
    2: 16,
    3: 10
  }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings — map back to the original option value so the
    // fallback stays type-preserving (numbers, booleans) like the segment path.
    const resolve = s => {
      const m = options.find(o => String(typeof o === 'object' ? o.value : o) === s);
      return m === undefined ? s : typeof m === 'object' ? m.value : m;
    };
    return /*#__PURE__*/React.createElement(TweakSelect, {
      label: label,
      value: value,
      options: options,
      onChange: s => onChange(resolve(s))
    });
  }
  const opts = options.map(o => typeof o === 'object' ? o : {
    value: o,
    label: o
  });
  const idx = Math.max(0, opts.findIndex(o => o.value === value));
  const n = opts.length;
  const segAt = clientX => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor((clientX - r.left - 2) / inner * n);
    return opts[Math.max(0, Math.min(n - 1, i))].value;
  };
  const onPointerDown = e => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = ev => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    ref: trackRef,
    role: "radiogroup",
    onPointerDown: onPointerDown,
    className: dragging ? 'twk-seg dragging' : 'twk-seg'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-seg-thumb",
    style: {
      left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
      width: `calc((100% - 4px) / ${n})`
    }
  }), opts.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    type: "button",
    role: "radio",
    "aria-checked": o.value === value
  }, o.label))));
}
function TweakSelect({
  label,
  value,
  options,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("select", {
    className: "twk-field",
    value: value,
    onChange: e => onChange(e.target.value)
  }, options.map(o => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, l);
  })));
}
function TweakText({
  label,
  value,
  placeholder,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("input", {
    className: "twk-field",
    type: "text",
    value: value,
    placeholder: placeholder,
    onChange: e => onChange(e.target.value)
  }));
}
function TweakNumber({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange
}) {
  const clamp = n => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const startRef = React.useRef({
    x: 0,
    val: 0
  });
  const onScrubStart = e => {
    e.preventDefault();
    startRef.current = {
      x: e.clientX,
      val: value
    };
    const decimals = (String(step).split('.')[1] || '').length;
    const move = ev => {
      const dx = ev.clientX - startRef.current.x;
      const raw = startRef.current.val + dx * step;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(Number(snapped.toFixed(decimals))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-num"
  }, /*#__PURE__*/React.createElement("span", {
    className: "twk-num-lbl",
    onPointerDown: onScrubStart
  }, label), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: value,
    min: min,
    max: max,
    step: step,
    onChange: e => onChange(clamp(Number(e.target.value)))
  }), unit && /*#__PURE__*/React.createElement("span", {
    className: "twk-num-unit"
  }, unit));
}

// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, c => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = n >> 16 & 255,
    g = n >> 8 & 255,
    b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}
const __TwkCheck = ({
  light
}) => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 14 14",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M3 7.2 5.8 10 11 4.2",
  fill: "none",
  strokeWidth: "2.2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  stroke: light ? 'rgba(0,0,0,.78)' : '#fff'
}));

// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({
  label,
  value,
  options,
  onChange
}) {
  if (!options || !options.length) {
    return /*#__PURE__*/React.createElement("div", {
      className: "twk-row twk-row-h"
    }, /*#__PURE__*/React.createElement("div", {
      className: "twk-lbl"
    }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("input", {
      type: "color",
      className: "twk-swatch",
      value: value,
      onChange: e => onChange(e.target.value)
    }));
  }
  // Native <input type=color> emits lowercase hex per the HTML spec, so
  // compare case-insensitively. String() guards JSON.stringify(undefined),
  // which returns the primitive undefined (no .toLowerCase).
  const key = o => String(JSON.stringify(o)).toLowerCase();
  const cur = key(value);
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-chips",
    role: "radiogroup"
  }, options.map((o, i) => {
    const colors = Array.isArray(o) ? o : [o];
    const [hero, ...rest] = colors;
    const sup = rest.slice(0, 4);
    const on = key(o) === cur;
    return /*#__PURE__*/React.createElement("button", {
      key: i,
      type: "button",
      className: "twk-chip",
      role: "radio",
      "aria-checked": on,
      "data-on": on ? '1' : '0',
      "aria-label": colors.join(', '),
      title: colors.join(' · '),
      style: {
        background: hero
      },
      onClick: () => onChange(o)
    }, sup.length > 0 && /*#__PURE__*/React.createElement("span", null, sup.map((c, j) => /*#__PURE__*/React.createElement("i", {
      key: j,
      style: {
        background: c
      }
    }))), on && /*#__PURE__*/React.createElement(__TwkCheck, {
      light: __twkIsLight(hero)
    }));
  })));
}
function TweakButton({
  label,
  onClick,
  secondary = false
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: secondary ? 'twk-btn secondary' : 'twk-btn',
    onClick: onClick
  }, label);
}
Object.assign(window, {
  useTweaks,
  TweaksPanel,
  TweakSection,
  TweakRow,
  TweakSlider,
  TweakToggle,
  TweakRadio,
  TweakSelect,
  TweakText,
  TweakNumber,
  TweakColor,
  TweakButton
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "guidelines/tweaks-panel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/App.jsx
try { (() => {
// Atlas Admin Console — app wiring.

function App() {
  const [route, setRoute] = React.useState('dashboard');
  const [activeUser, setActiveUser] = React.useState(null);
  const go = r => {
    setRoute(r);
  };
  const openUser = u => {
    setActiveUser(u);
    setRoute('user-detail');
  };
  return /*#__PURE__*/React.createElement(Shell, {
    route: route,
    go: go
  }, route === 'dashboard' && /*#__PURE__*/React.createElement(DashboardScreen, {
    go: go
  }), route === 'users' && /*#__PURE__*/React.createElement(UsersScreen, {
    go: go,
    openUser: openUser
  }), route === 'user-detail' && /*#__PURE__*/React.createElement(UserDetailScreen, {
    user: activeUser,
    go: go
  }), route === 'settings' && /*#__PURE__*/React.createElement(SettingsScreen, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/DashboardScreen.jsx
try { (() => {
// Atlas Admin Console — Dashboard / overview screen.

function DashboardScreen({
  go
}) {
  const {
    StatCard,
    Card,
    Table,
    Badge,
    Button
  } = window.AtlasDesignSystem_9b7d80;
  const recent = ATLAS_USERS.slice(0, 5);
  const cols = [{
    key: 'name',
    header: 'User',
    render: (v, r) => /*#__PURE__*/React.createElement(Identity, {
      name: v,
      email: r.email
    })
  }, {
    key: 'team',
    header: 'Team'
  }, {
    key: 'status',
    header: 'Status',
    render: v => /*#__PURE__*/React.createElement(Badge, {
      tone: STATUS_TONE[v],
      dot: true
    }, v)
  }, {
    key: 'seen',
    header: 'Last seen',
    align: 'right',
    render: v => /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--text-xs) var(--font-mono)',
        color: 'var(--text-tertiary)'
      }
    }, v)
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Dashboard",
    subtitle: "Workspace activity for the last 30 days."
  }, /*#__PURE__*/React.createElement("span", {
    className: "atlas-overline"
  }, "Acme Inc \xB7 Overview")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Total users",
    value: "248",
    delta: "+18",
    trend: "up",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "users",
      size: 16
    })
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Active today",
    value: "86",
    delta: "+4%",
    trend: "up",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "activity",
      size: 16
    })
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Pending invites",
    value: "12",
    delta: "-3",
    trend: "down",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "mail",
      size: 16
    })
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "API requests",
    value: "1.2M",
    delta: "+9%",
    trend: "up",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "zap",
      size: 16
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.6fr 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Recent sign-ups",
    subtitle: "Newest members across all teams",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary",
      iconRight: /*#__PURE__*/React.createElement(Icon, {
        name: "arrow-right",
        size: 15
      }),
      onClick: () => go('users')
    }, "View all"),
    padding: "none"
  }, /*#__PURE__*/React.createElement(Table, {
    columns: cols,
    data: recent,
    rowKey: "id"
  })), /*#__PURE__*/React.createElement(Card, {
    title: "System status"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, [['API', 'Operational', 'success', '142ms'], ['Database', 'Operational', 'success', '8ms'], ['Webhooks', 'Degraded', 'warning', '1.4s'], ['Background jobs', 'Operational', 'success', '320 queued']].map(([label, state, tone, meta]) => /*#__PURE__*/React.createElement("div", {
    key: label,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: `var(--status-${tone})`
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-medium) var(--text-sm) var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, label)), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-xs) var(--font-mono)',
      color: 'var(--text-tertiary)'
    }
  }, meta), /*#__PURE__*/React.createElement(Badge, {
    tone: tone
  }, state))))))));
}
Object.assign(window, {
  DashboardScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/DashboardScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/SettingsScreen.jsx
try { (() => {
// Atlas Admin Console — Workspace settings screen.

function SettingsScreen() {
  const {
    Card,
    Button,
    Input,
    Select,
    Textarea,
    Banner
  } = window.AtlasDesignSystem_9b7d80;
  const [section, setSection] = React.useState('general');
  const nav = [['general', 'General', 'settings'], ['members', 'Members', 'users'], ['security', 'Security', 'shield'], ['billing', 'Billing', 'credit-card'], ['api', 'API & webhooks', 'webhook']];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Settings",
    subtitle: "Configure your workspace defaults and security."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '190px 1fr',
      gap: 24,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      position: 'sticky',
      top: 0
    }
  }, nav.map(([id, label, icon]) => {
    const active = id === section;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => setSection(id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '7px 10px',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        textAlign: 'left',
        background: active ? 'var(--surface-active)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        font: `var(--weight-medium) var(--text-sm)/1 var(--font-sans)`
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 16,
      style: {
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)'
      }
    }), label);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      maxWidth: 640
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Workspace",
    subtitle: "How your workspace appears across Atlas"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Workspace name",
    defaultValue: "Acme Inc"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "URL slug",
    defaultValue: "acme",
    trailing: /*#__PURE__*/React.createElement("span", {
      style: {
        font: '12px var(--font-mono)',
        color: 'var(--text-tertiary)'
      }
    }, ".atlas.app")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: '1 / -1'
    }
  }, /*#__PURE__*/React.createElement(Textarea, {
    label: "Description",
    rows: 3,
    defaultValue: "Internal admin workspace for Acme product operations."
  })), /*#__PURE__*/React.createElement(Select, {
    label: "Default role for new members",
    options: ['Member', 'Viewer', 'Admin'],
    defaultValue: "Member"
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Default timezone",
    options: ['UTC', 'America/Los_Angeles', 'Europe/Berlin'],
    defaultValue: "UTC"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 18,
      paddingTop: 14,
      borderTop: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Save changes"))), /*#__PURE__*/React.createElement(Card, {
    title: "Session policy"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ToggleRow, {
    label: "Require two-factor authentication",
    desc: "Enforce 2FA for all members",
    defaultOn: true
  }), /*#__PURE__*/React.createElement(ToggleRow, {
    label: "Single sign-on (SSO)",
    desc: "Allow login via your identity provider"
  }), /*#__PURE__*/React.createElement(ToggleRow, {
    label: "Idle timeout",
    desc: "Sign out after 30 minutes of inactivity",
    defaultOn: true
  }))), /*#__PURE__*/React.createElement(Card, {
    title: "Danger zone",
    style: {
      borderColor: 'var(--red-100)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Banner, {
    tone: "danger",
    title: "Deleting a workspace is permanent"
  }, "All users, records, and API keys will be removed immediately."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "trash-2",
      size: 15
    })
  }, "Delete workspace")))))));
}
Object.assign(window, {
  SettingsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/Shell.jsx
try { (() => {
// Atlas Admin Console — application shell (sidebar + topbar).

function NavItem({
  icon,
  label,
  active,
  badge,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      height: 34,
      padding: '0 10px',
      border: 'none',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      textAlign: 'left',
      font: `var(--weight-medium) var(--text-sm)/1 var(--font-sans)`,
      background: active ? 'var(--surface-active)' : hover ? 'var(--surface-hover)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      transition: 'background 120ms ease, color 120ms ease'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 17,
    strokeWidth: active ? 2 : 1.7,
    style: {
      color: active ? 'var(--text-primary)' : 'var(--text-tertiary)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, label), badge != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-medium) 11px/1 var(--font-mono)',
      color: 'var(--text-tertiary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, badge));
}
function Sidebar({
  route,
  go
}) {
  const NavGroup = ({
    label,
    children
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "atlas-overline",
    style: {
      padding: '0 10px',
      margin: '14px 0 6px'
    }
  }, label), children);
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 'var(--layout-sidebar)',
      flex: '0 0 auto',
      height: '100%',
      background: 'var(--surface-card)',
      borderRight: '1px solid var(--border-default)',
      display: 'flex',
      flexDirection: 'column',
      padding: '14px 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      padding: '4px 8px 10px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/atlas-mark.svg",
    width: "26",
    height: "26",
    alt: "Atlas"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-semibold) 17px/1 var(--font-sans)',
      letterSpacing: '-0.03em'
    }
  }, "Atlas"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      font: '10px var(--font-mono)',
      color: 'var(--text-disabled)'
    }
  }, "v2.4")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: 'auto'
    },
    className: "atlas-scroll"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement(NavItem, {
    icon: "layout-dashboard",
    label: "Dashboard",
    active: route === 'dashboard',
    onClick: () => go('dashboard')
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: "users",
    label: "Users",
    active: route === 'users' || route === 'user-detail',
    badge: "248",
    onClick: () => go('users')
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: "folder",
    label: "Teams",
    onClick: () => go('users')
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: "key",
    label: "API keys",
    onClick: () => go('users')
  })), /*#__PURE__*/React.createElement(NavGroup, {
    label: "Operations"
  }, /*#__PURE__*/React.createElement(NavItem, {
    icon: "credit-card",
    label: "Billing",
    onClick: () => go('users')
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: "scroll-text",
    label: "Audit log",
    badge: "12",
    onClick: () => go('users')
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: "bell",
    label: "Alerts",
    onClick: () => go('users')
  })), /*#__PURE__*/React.createElement(NavGroup, {
    label: "Workspace"
  }, /*#__PURE__*/React.createElement(NavItem, {
    icon: "settings",
    label: "Settings",
    active: route === 'settings',
    onClick: () => go('settings')
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: "shield",
    label: "Security",
    onClick: () => go('settings')
  }))), /*#__PURE__*/React.createElement("button", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      width: '100%',
      marginTop: 8,
      padding: '8px 8px',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-card)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 26,
      height: 26,
      borderRadius: 'var(--radius-sm)',
      background: 'var(--gray-900)',
      color: '#fff',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: 'var(--weight-semibold) 12px var(--font-sans)',
      flex: '0 0 auto'
    }
  }, "AC"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      textAlign: 'left',
      lineHeight: 1.25,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-medium) var(--text-sm) var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, "Acme Inc"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '11px var(--font-sans)',
      color: 'var(--text-tertiary)'
    }
  }, "Pro plan")), /*#__PURE__*/React.createElement(Icon, {
    name: "chevrons-up-down",
    size: 15,
    style: {
      color: 'var(--text-tertiary)'
    }
  })));
}
function Topbar({
  title
}) {
  const {
    IconButton,
    Avatar
  } = window.AtlasDesignSystem_9b7d80;
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 'var(--layout-topbar)',
      flex: '0 0 auto',
      borderBottom: '1px solid var(--border-default)',
      background: 'var(--surface-card)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '0 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      flex: 1,
      maxWidth: 360
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 10,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 15
  })), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search users, teams, keys\u2026",
    style: {
      width: '100%',
      height: 34,
      padding: '0 10px 0 32px',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-page)',
      font: 'var(--text-sm) var(--font-sans)',
      color: 'var(--text-primary)',
      outline: 'none'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 8,
      top: '50%',
      transform: 'translateY(-50%)',
      font: '11px var(--font-mono)',
      color: 'var(--text-disabled)',
      border: '1px solid var(--border-default)',
      borderRadius: 4,
      padding: '1px 5px'
    }
  }, "\u2318K")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    label: "Help"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "circle-help",
    size: 17
  })), /*#__PURE__*/React.createElement(IconButton, {
    label: "Notifications"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 17
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      height: 22,
      background: 'var(--border-default)',
      margin: '0 6px'
    }
  }), /*#__PURE__*/React.createElement(Avatar, {
    name: "You Admin",
    size: "sm"
  })));
}
function Shell({
  route,
  go,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    route: route,
    go: go
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Topbar, null), /*#__PURE__*/React.createElement("main", {
    className: "atlas-scroll",
    style: {
      flex: 1,
      overflow: 'auto',
      padding: 'var(--layout-gutter)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--layout-page-max)',
      margin: '0 auto'
    }
  }, children))));
}
Object.assign(window, {
  Shell
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/Shell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/UserDetailScreen.jsx
try { (() => {
// Atlas Admin Console — User detail / edit record screen.

function UserDetailScreen({
  user,
  go
}) {
  const {
    Card,
    Badge,
    Button,
    IconButton,
    Tabs,
    Breadcrumb,
    Input,
    Select,
    Switch,
    Avatar,
    Banner
  } = window.AtlasDesignSystem_9b7d80;
  const u = user || ATLAS_USERS[0];
  const [tab, setTab] = React.useState('profile');
  const [dirty, setDirty] = React.useState(false);
  const markDirty = () => setDirty(true);
  const Field = ({
    children
  }) => /*#__PURE__*/React.createElement("div", null, children);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Breadcrumb, {
    items: [{
      label: 'Users',
      href: '#'
    }, {
      label: u.team,
      href: '#'
    }, {
      label: u.name
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      margin: '14px 0 18px'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: u.name,
    size: "lg"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--weight-semibold) var(--text-h1)/1 var(--font-sans)',
      letterSpacing: 'var(--tracking-tight)'
    }
  }, u.name), /*#__PURE__*/React.createElement(Badge, {
    tone: STATUS_TONE[u.status],
    dot: true
  }, u.status)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-sm) var(--font-mono)',
      color: 'var(--text-tertiary)'
    }
  }, u.email, " \xB7 ", u.id)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "mail",
      size: 15
    })
  }, "Email"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => go('users')
  }, "Back"), /*#__PURE__*/React.createElement(IconButton, {
    label: "More actions",
    variant: "outline"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "ellipsis",
    size: 16
  })))), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    items: [{
      value: 'profile',
      label: 'Profile'
    }, {
      value: 'permissions',
      label: 'Permissions'
    }, {
      value: 'activity',
      label: 'Activity'
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18
    }
  }, dirty && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Banner, {
    tone: "warning",
    title: "Unsaved changes",
    onDismiss: () => setDirty(false)
  }, "Save your edits before leaving this page.")), tab === 'profile' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.5fr 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Profile",
    subtitle: "Basic account information"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Full name",
    defaultValue: u.name,
    onChange: markDirty
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Email",
    defaultValue: u.email,
    onChange: markDirty
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Role",
    options: ['Owner', 'Admin', 'Member', 'Viewer'],
    defaultValue: u.role,
    onChange: markDirty
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Team",
    options: ['Leadership', 'Engineering', 'Design', 'Support', 'Finance'],
    defaultValue: u.team,
    onChange: markDirty
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: '1 / -1'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Title",
    placeholder: "e.g. Staff Engineer",
    onChange: markDirty
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 18,
      paddingTop: 14,
      borderTop: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => setDirty(false)
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => setDirty(false)
  }, "Save changes"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Access"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ToggleRow, {
    label: "Two-factor auth",
    desc: "Require 2FA at sign-in",
    defaultOn: true,
    onToggle: markDirty
  }), /*#__PURE__*/React.createElement(ToggleRow, {
    label: "API access",
    desc: "Can create personal keys",
    defaultOn: true,
    onToggle: markDirty
  }), /*#__PURE__*/React.createElement(ToggleRow, {
    label: "Billing access",
    desc: "View invoices & plan",
    onToggle: markDirty
  }))), /*#__PURE__*/React.createElement(Card, {
    title: "Danger zone",
    style: {
      borderColor: 'var(--red-100)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-sm) var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, "Suspend this user's access."), /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "ban",
      size: 15
    })
  }, "Suspend"))))), tab === 'permissions' && /*#__PURE__*/React.createElement(Card, {
    title: "Permissions",
    subtitle: "Scopes granted to this user"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, [['users:read', 'Read user records', true], ['users:write', 'Create and edit users', true], ['billing:read', 'View billing', false], ['audit:read', 'View audit log', true], ['keys:write', 'Manage API keys', false]].map(([scope, desc, on], i) => /*#__PURE__*/React.createElement("div", {
    key: scope,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 0',
      borderTop: i ? '1px solid var(--border-subtle)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-medium) var(--text-sm) var(--font-mono)',
      color: 'var(--text-primary)'
    }
  }, scope), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-xs) var(--font-sans)',
      color: 'var(--text-tertiary)'
    }
  }, desc)), /*#__PURE__*/React.createElement(DefaultSwitch, {
    on: on,
    onToggle: markDirty
  }))))), tab === 'activity' && /*#__PURE__*/React.createElement(Card, {
    title: "Recent activity"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, [['Signed in', 'web · San Francisco', '2m ago', 'log-in'], ['Updated role to Admin', 'by Dana Reyes', '3h ago', 'user-cog'], ['Created API key', 'prod-deploy-key', '1d ago', 'key'], ['Password changed', 'web', '4d ago', 'lock'], ['Account created', 'invited by Dana Reyes', '2w ago', 'user-plus']].map(([title, meta, time, icon], i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '11px 0',
      borderTop: i ? '1px solid var(--border-subtle)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 'var(--radius-full)',
      background: 'var(--surface-sunken)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-tertiary)',
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 15
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-medium) var(--text-sm) var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-xs) var(--font-sans)',
      color: 'var(--text-tertiary)'
    }
  }, meta)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-xs) var(--font-mono)',
      color: 'var(--text-tertiary)'
    }
  }, time)))))));
}
function ToggleRow({
  label,
  desc,
  defaultOn,
  onToggle
}) {
  const {
    Switch
  } = window.AtlasDesignSystem_9b7d80;
  const [on, setOn] = React.useState(!!defaultOn);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-medium) var(--text-sm) var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-xs) var(--font-sans)',
      color: 'var(--text-tertiary)'
    }
  }, desc)), /*#__PURE__*/React.createElement(DefaultSwitch, {
    on: on,
    onToggle: v => {
      setOn(v);
      onToggle && onToggle();
    }
  }));
}
function DefaultSwitch({
  on,
  onToggle
}) {
  const {
    Switch
  } = window.AtlasDesignSystem_9b7d80;
  const [v, setV] = React.useState(!!on);
  return /*#__PURE__*/React.createElement(Switch, {
    checked: v,
    onChange: nv => {
      setV(nv);
      onToggle && onToggle(nv);
    }
  });
}
Object.assign(window, {
  UserDetailScreen,
  ToggleRow,
  DefaultSwitch
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/UserDetailScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/UsersScreen.jsx
try { (() => {
// Atlas Admin Console — Users list (core CRUD list view).

function UsersScreen({
  go,
  openUser
}) {
  const {
    Card,
    Table,
    Badge,
    Button,
    IconButton,
    Tabs,
    Pagination,
    Select,
    Dialog,
    Input
  } = window.AtlasDesignSystem_9b7d80;
  const [tab, setTab] = React.useState('all');
  const [sel, setSel] = React.useState([]);
  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const filtered = ATLAS_USERS.filter(u => {
    const matchTab = tab === 'all' || u.status.toLowerCase() === tab;
    const matchQ = !query || (u.name + u.email + u.team).toLowerCase().includes(query.toLowerCase());
    return matchTab && matchQ;
  });
  const counts = {
    all: ATLAS_USERS.length,
    active: ATLAS_USERS.filter(u => u.status === 'Active').length,
    pending: ATLAS_USERS.filter(u => u.status === 'Pending').length
  };
  const cols = [{
    key: 'name',
    header: 'User',
    render: (v, r) => /*#__PURE__*/React.createElement("button", {
      onClick: () => openUser(r),
      style: {
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        textAlign: 'left'
      }
    }, /*#__PURE__*/React.createElement(Identity, {
      name: v,
      email: r.email
    }))
  }, {
    key: 'role',
    header: 'Role',
    render: v => /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--text-sm) var(--font-sans)',
        color: 'var(--text-secondary)'
      }
    }, v)
  }, {
    key: 'team',
    header: 'Team'
  }, {
    key: 'status',
    header: 'Status',
    render: v => /*#__PURE__*/React.createElement(Badge, {
      tone: STATUS_TONE[v],
      dot: true
    }, v)
  }, {
    key: 'id',
    header: 'ID',
    render: v => /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--text-xs) var(--font-mono)',
        color: 'var(--text-tertiary)'
      }
    }, v)
  }, {
    key: 'seen',
    header: 'Last seen',
    align: 'right',
    render: v => /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--text-xs) var(--font-mono)',
        color: 'var(--text-tertiary)'
      }
    }, v)
  }, {
    key: '_a',
    header: '',
    width: 44,
    align: 'right',
    render: (_, r) => /*#__PURE__*/React.createElement(IconButton, {
      label: "Row actions",
      onClick: () => openUser(r)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "ellipsis",
      size: 16
    }))
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Users",
    subtitle: "Manage members, roles, and access across your workspace.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "download",
        size: 15
      })
    }, "Export"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "plus",
        size: 15
      }),
      onClick: () => setCreating(true)
    }, "Invite user"))
  }), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: v => {
      setTab(v);
      setSel([]);
    },
    items: [{
      value: 'all',
      label: 'All',
      count: counts.all
    }, {
      value: 'active',
      label: 'Active',
      count: counts.active
    }, {
      value: 'pending',
      label: 'Pending',
      count: counts.pending
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      margin: '14px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: 280
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 10,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 15
  })), /*#__PURE__*/React.createElement("input", {
    value: query,
    onChange: e => setQuery(e.target.value),
    placeholder: "Filter by name, email, team\u2026",
    style: {
      width: '100%',
      height: 34,
      padding: '0 10px 0 32px',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-card)',
      font: 'var(--text-sm) var(--font-sans)',
      outline: 'none',
      color: 'var(--text-primary)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 150
    }
  }, /*#__PURE__*/React.createElement(Select, {
    size: "md",
    options: ['All roles', 'Owner', 'Admin', 'Member', 'Viewer'],
    defaultValue: "All roles"
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "filter",
      size: 15
    })
  }, "Filters"), sel.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-sm) var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, sel.length, " selected"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "user-cog",
      size: 15
    })
  }, "Change role"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "danger",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "trash-2",
      size: 15
    })
  }, "Remove"))), /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement(Table, {
    columns: cols,
    data: filtered,
    rowKey: "id",
    selectable: true,
    selected: sel,
    onSelectedChange: setSel,
    empty: "No users match this filter."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 14px',
      borderTop: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement(Pagination, {
    page: 1,
    pageSize: 8,
    total: 248,
    onPageChange: () => {}
  }))), /*#__PURE__*/React.createElement(Dialog, {
    open: creating,
    onClose: () => setCreating(false),
    width: 460,
    title: "Invite a user",
    description: "They'll get an email with a link to join Acme Inc.",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: () => setCreating(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      onClick: () => setCreating(false)
    }, "Send invite"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Email address",
    placeholder: "name@acme.com",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "mail",
      size: 15
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Select, {
    label: "Role",
    options: ['Owner', 'Admin', 'Member', 'Viewer'],
    defaultValue: "Member"
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Team",
    options: ['Engineering', 'Design', 'Support', 'Finance'],
    defaultValue: "Engineering"
  })))));
}
Object.assign(window, {
  UsersScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/UsersScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/kit-lib.jsx
try { (() => {
// Shared helpers for the Atlas Admin Console UI kit.
// Loaded as a Babel script; exports to window for sibling screens.

// Lucide icon wrapper. Renders an <i data-lucide> then lets lucide replace it.
function Icon({
  name,
  size = 16,
  strokeWidth = 1.6,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    host.appendChild(i);
    if (window.lucide) window.lucide.createIcons({
      attrs: {
        width: size,
        height: size,
        'stroke-width': strokeWidth
      }
    });
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      ...style
    }
  });
}

// Page header used across screens.
function PageHeader({
  title,
  subtitle,
  actions,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0
    }
  }, children, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--weight-semibold) var(--text-h1)/1.1 var(--font-sans)',
      letterSpacing: 'var(--tracking-tight)'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--text-sm)/1.4 var(--font-sans)',
      color: 'var(--text-tertiary)'
    }
  }, subtitle)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flex: '0 0 auto'
    }
  }, actions));
}

// A labelled identity cell for tables.
function Identity({
  name,
  email
}) {
  const {
    Avatar
  } = window.AtlasDesignSystem_9b7d80;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: name,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      lineHeight: 1.25
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 500,
      color: 'var(--text-primary)'
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--text-tertiary)'
    }
  }, email)));
}

// Seed data shared across screens.
const ATLAS_USERS = [{
  id: 'usr_8Kp2',
  name: 'Dana Reyes',
  email: 'dana@acme.com',
  role: 'Owner',
  team: 'Leadership',
  status: 'Active',
  seen: '2m ago'
}, {
  id: 'usr_3Lm9',
  name: 'Liam Okafor',
  email: 'liam@acme.com',
  role: 'Admin',
  team: 'Engineering',
  status: 'Active',
  seen: '1h ago'
}, {
  id: 'usr_7Qr4',
  name: 'Priya Shah',
  email: 'priya@acme.com',
  role: 'Member',
  team: 'Engineering',
  status: 'Active',
  seen: '3h ago'
}, {
  id: 'usr_2Zt6',
  name: 'Marco Bianchi',
  email: 'marco@acme.com',
  role: 'Member',
  team: 'Design',
  status: 'Pending',
  seen: 'Invited'
}, {
  id: 'usr_5Yw1',
  name: 'Aisha Khan',
  email: 'aisha@acme.com',
  role: 'Admin',
  team: 'Support',
  status: 'Active',
  seen: '5h ago'
}, {
  id: 'usr_9Bn3',
  name: 'Tom Fisher',
  email: 'tom@acme.com',
  role: 'Viewer',
  team: 'Finance',
  status: 'Suspended',
  seen: '6d ago'
}, {
  id: 'usr_4Hd8',
  name: 'Sofia Mendez',
  email: 'sofia@acme.com',
  role: 'Member',
  team: 'Design',
  status: 'Active',
  seen: '1d ago'
}, {
  id: 'usr_1Gk5',
  name: 'Noah Becker',
  email: 'noah@acme.com',
  role: 'Member',
  team: 'Support',
  status: 'Pending',
  seen: 'Invited'
}];
const STATUS_TONE = {
  Active: 'success',
  Pending: 'warning',
  Suspended: 'danger',
  Invited: 'neutral'
};
Object.assign(window, {
  Icon,
  PageHeader,
  Identity,
  ATLAS_USERS,
  STATUS_TONE
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/kit-lib.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.Table = __ds_scope.Table;

__ds_ns.Banner = __ds_scope.Banner;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Breadcrumb = __ds_scope.Breadcrumb;

__ds_ns.Pagination = __ds_scope.Pagination;

__ds_ns.Tabs = __ds_scope.Tabs;

})();

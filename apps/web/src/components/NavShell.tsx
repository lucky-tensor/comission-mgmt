/**
 * NavShell — application navigation shell.
 *
 * Renders the top navigation bar with only the routes permitted for the active
 * role (sourced from roleRoutes.ts) and wraps page content in one standard
 * content container.
 *
 * Rebuild (#203) per docs/ux-review.md "NavShell / menu-system assessment":
 *   - Nav items render as real <a href> anchors (middle-click / copy-link /
 *     hover-preview work); left-click is intercepted for SPA navigation.
 *   - Active + permitted matching is prefix-based (activeNavPath), so detail
 *     routes highlight their parent nav item.
 *   - More than five items collapse into a "More" overflow menu so the bar
 *     never overflows off-screen.
 *   - All styling comes from the ui package design tokens — no local hex.
 *   - The header shows the persona name and the human role label
 *     ("Jordan Lee · Finance Admin"), not the raw enum.
 *   - aria-current="page", the nav aria-label, and per-item test IDs are
 *     preserved.
 *
 * Route gating: the nav only shows items in the role's `navItems` list — no
 * component re-implements role gating.
 *
 * Canonical docs: docs/prd.md §3 (User Roles); docs/ux-review.md
 * Issue: feat: web app shell — role-based routing and navigation (#100);
 *        feat: webapp — UX overhaul: NavShell rebuild (#203)
 */

import type { AppRole } from 'core/auth';
import { ROLE_ROUTES, activeNavPath, roleLabel, type NavItem } from '../lib/roleRoutes';
import { colors, radius, font, layout } from 'ui';
import { useState, type ReactNode, type CSSProperties, type MouseEvent } from 'react';

interface NavShellProps {
  role: AppRole;
  currentPath: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  /** Persona display name shown beside the role label; optional. */
  personaName?: string | null;
  children: ReactNode;
}

/** Items beyond this count collapse into an overflow ("More") menu. */
export const MAX_VISIBLE_ITEMS = 5;

/**
 * Split nav items into the inline row and the overflow ("More") menu. When the
 * total is within the cap everything stays inline; past it, the trailing items
 * (and one slot for the More toggle) fold into the overflow. Exported so the
 * overflow contract can be unit-tested without a six-item role in the route map.
 */
export function splitNavItems<T>(
  items: T[],
  cap: number = MAX_VISIBLE_ITEMS,
): {
  visible: T[];
  overflow: T[];
} {
  if (items.length <= cap) return { visible: items, overflow: [] };
  return { visible: items.slice(0, cap - 1), overflow: items.slice(cap - 1) };
}

const navStyle: CSSProperties = {
  background: colors.navBg,
  color: colors.navFg,
  padding: '0 1.5rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  height: '3.25rem',
  fontFamily: font.family,
  position: 'sticky',
  top: 0,
  zIndex: 100,
};

const brandStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: '0.9375rem',
  color: colors.navFg,
  marginRight: '1rem',
  whiteSpace: 'nowrap',
};

function navItemStyle(active: boolean): CSSProperties {
  return {
    padding: '0.4375rem 0.75rem',
    borderRadius: radius.sm,
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 400,
    color: active ? colors.navFg : colors.navFgMuted,
    background: active ? colors.navActiveBg : 'transparent',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  };
}

const spacerStyle: CSSProperties = { flex: 1 };

const logoutButtonStyle: CSSProperties = {
  padding: '0.4375rem 0.75rem',
  borderRadius: radius.sm,
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: colors.navFgMuted,
  cursor: 'pointer',
  border: `1px solid ${colors.navActiveBg}`,
  background: 'transparent',
};

const roleBadgeStyle: CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 500,
  color: colors.navFgMuted,
  padding: '0.25rem 0.625rem',
  background: 'rgba(255,255,255,0.06)',
  borderRadius: radius.pill,
  whiteSpace: 'nowrap',
};

const contentStyle: CSSProperties = {
  maxWidth: layout.containerMaxWidth,
  margin: '0 auto',
  padding: layout.containerPadding,
  fontFamily: font.family,
};

/** Stable per-item test id derived from the route path. */
function navTestId(path: string): string {
  return `nav-item-${path.replace(/\//g, '-').replace(/^-/, '')}`;
}

/** Render one nav item as an intercepted anchor link. */
function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: (path: string) => void;
}) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle modified clicks (new tab, download, etc.).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    onNavigate(item.path);
  }

  return (
    <a
      key={item.path}
      href={item.path}
      data-testid={navTestId(item.path)}
      style={navItemStyle(active)}
      aria-current={active ? 'page' : undefined}
      onClick={handleClick}
    >
      {item.label}
    </a>
  );
}

/** Overflow menu housing nav items beyond the visible cap. */
function OverflowMenu({
  items,
  activePath,
  onNavigate,
}: {
  items: NavItem[];
  activePath: string | null;
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containsActive = items.some((i) => i.path === activePath);

  return (
    <div style={{ position: 'relative' }} data-testid="nav-overflow">
      <button
        type="button"
        data-testid="nav-overflow-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ ...navItemStyle(containsActive), border: 'none', background: 'transparent' }}
        onClick={() => setOpen((o) => !o)}
      >
        More ▾
      </button>
      {open && (
        <div
          role="menu"
          data-testid="nav-overflow-menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '0.25rem',
            background: colors.navBg,
            borderRadius: radius.md,
            padding: '0.25rem',
            minWidth: '11rem',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            zIndex: 200,
          }}
        >
          {items.map((item) => (
            <a
              key={item.path}
              href={item.path}
              data-testid={navTestId(item.path)}
              role="menuitem"
              style={{ ...navItemStyle(item.path === activePath), display: 'block' }}
              aria-current={item.path === activePath ? 'page' : undefined}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                setOpen(false);
                onNavigate(item.path);
              }}
            >
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function NavShell({
  role,
  currentPath,
  onNavigate,
  onLogout,
  personaName,
  children,
}: NavShellProps) {
  const config = ROLE_ROUTES[role];
  const active = activeNavPath(role, currentPath);

  // Split into a visible row and an overflow menu once past the cap.
  const { visible, overflow } = splitNavItems(config.navItems);

  const roleText = roleLabel(role);
  const badgeText = personaName ? `${personaName} · ${roleText}` : roleText;

  return (
    <div data-testid="nav-shell">
      <nav style={navStyle} data-testid="nav-bar" aria-label="Main navigation">
        <span style={brandStyle}>Commission Management</span>

        {visible.map((item) => (
          <NavLink
            key={item.path}
            item={item}
            active={item.path === active}
            onNavigate={onNavigate}
          />
        ))}
        {overflow.length > 0 && (
          <OverflowMenu items={overflow} activePath={active} onNavigate={onNavigate} />
        )}

        <div style={spacerStyle} />
        <span style={roleBadgeStyle} data-testid="nav-role-badge">
          {badgeText}
        </span>
        <button
          type="button"
          style={logoutButtonStyle}
          data-testid="nav-logout-button"
          onClick={onLogout}
        >
          Log out
        </button>
      </nav>

      <main style={contentStyle}>{children}</main>
    </div>
  );
}

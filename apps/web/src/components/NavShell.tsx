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
 *   - All styling comes from Tailwind utilities driven by the @theme in
 *     apps/web/src/index.css — no local hex.
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
import { useState, type ReactNode, type MouseEvent } from 'react';

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

const NAV_CLASS = 'sticky top-0 z-[100] flex items-center gap-2 h-13 px-6 bg-ink text-white';

const BRAND_CLASS = 'font-bold text-[0.9375rem] text-white mr-4 whitespace-nowrap';

const NAV_ITEM_BASE =
  'px-3 py-[0.4375rem] rounded-md text-sm whitespace-nowrap no-underline cursor-pointer';

/** Tailwind classes for a nav item, by active state. */
function navItemClass(active: boolean): string {
  return [
    NAV_ITEM_BASE,
    active ? 'font-semibold text-white bg-white/10' : 'font-normal text-ink-faint hover:text-white',
  ].join(' ');
}

const LOGOUT_CLASS =
  'px-3 py-[0.4375rem] rounded-md text-[0.8125rem] font-medium text-ink-faint cursor-pointer ' +
  'border border-white/10 bg-transparent hover:text-white';

const ROLE_BADGE_CLASS =
  'text-xs font-medium text-ink-faint px-2.5 py-1 bg-white/[0.06] rounded-full whitespace-nowrap';

const CONTENT_CLASS = 'mx-auto max-w-[1140px] p-6';

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
      className={navItemClass(active)}
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
    <div className="relative" data-testid="nav-overflow">
      <button
        type="button"
        data-testid="nav-overflow-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${navItemClass(containsActive)} border-none bg-transparent`}
        onClick={() => setOpen((o) => !o)}
      >
        More ▾
      </button>
      {open && (
        <div
          role="menu"
          data-testid="nav-overflow-menu"
          className="absolute top-full left-0 mt-1 flex min-w-[11rem] flex-col rounded-lg bg-ink p-1 shadow-[0_6px_20px_rgba(0,0,0,0.35)] z-[200]"
        >
          {items.map((item) => (
            <a
              key={item.path}
              href={item.path}
              data-testid={navTestId(item.path)}
              role="menuitem"
              className={`${navItemClass(item.path === activePath)} block`}
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
      <nav className={NAV_CLASS} data-testid="nav-bar" aria-label="Main navigation">
        <span className={BRAND_CLASS}>Commission Management</span>

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

        <div className="flex-1" />
        <span className={ROLE_BADGE_CLASS} data-testid="nav-role-badge">
          {badgeText}
        </span>
        <button
          type="button"
          className={LOGOUT_CLASS}
          data-testid="nav-logout-button"
          onClick={onLogout}
        >
          Log out
        </button>
      </nav>

      <main className={CONTENT_CLASS}>{children}</main>
    </div>
  );
}

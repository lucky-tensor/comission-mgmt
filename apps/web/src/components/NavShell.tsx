/**
 * NavShell — application navigation shell with left sidebar.
 *
 * Implements the Atlas design system layout: a single left sidebar holds the
 * brand, the nav items, and the user-account menu (which contains Sign out),
 * with the page content filling the rest of the viewport. There is deliberately
 * no second top bar — the Atlas admin shell carries account/session controls in
 * the sidebar's account button, not a separate chrome strip.
 *
 * Layout is responsive but the sidebar is always visible (no mobile collapse).
 *
 * Canonical docs: Atlas design system (packages/ui/design-system/atlas/, see
 *                 ui_kits/admin-console/Shell.jsx); docs/web-app-ux.md (routing seam)
 */

import type { AppRole } from 'core/auth';
import {
  ROLE_ROUTES,
  activeNavPath,
  roleLabel,
  type NavItem,
  type RoleRouteConfig,
} from '../lib/roleRoutes';
import { useState, type ReactNode, type MouseEvent } from 'react';

interface NavShellProps {
  role: AppRole;
  currentPath: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  personaName?: string | null;
  children: ReactNode;
}

/**
 * Simple inline SVG icon component. Maps icon names to basic SVG paths.
 * Uses a subset of Lucide icons for nav items.
 */
const ICON_SVGS: Record<string, string> = {
  'layout-dashboard':
    '<circle cx="6" cy="6" r="1"/><circle cx="18" cy="6" r="1"/><circle cx="6" cy="18" r="1"/><circle cx="18" cy="18" r="1"/>',
  wallet: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><path d="M1 8h22"/>',
  'check-circle':
    '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  users:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'trending-up':
    '<polyline points="23 6 13.5 15.5 8.5 10.5 1 17"/><polyline points="17 6 23 6 23 12"/>',
  'line-chart':
    '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/><polyline points="22 19 20 21 18 19"/>',
  briefcase:
    '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 3h-4a2 2 0 0 0-2 2v2H8V5a2 2 0 0 0-2-2H2v2h2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7h2V5a2 2 0 0 0-2-2z"/>',
  'book-open':
    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'chevrons-up-down': '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  'log-out':
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const path = ICON_SVGS[name] || ICON_SVGS['book-open'];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
    >
      {path && <g dangerouslySetInnerHTML={{ __html: path }} />}
    </svg>
  );
}

/**
 * Render a single nav item as an intercepted anchor link.
 */
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
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    onNavigate(item.path);
  }

  return (
    <a
      href={item.path}
      data-testid={`nav-item-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
      onClick={handleClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 px-2.5 py-2 rounded-sm no-underline cursor-pointer transition-colors duration-120 ${
        active ? 'bg-surface-active text-ink font-medium' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <Icon name={item.icon} size={17} />
      <span className="flex-1 text-sm">{item.label}</span>
    </a>
  );
}

/** Up-to-two-letter initials for the account avatar. */
function initialsFor(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'U'
  );
}

/**
 * Account button at the bottom of the sidebar. Click toggles a small menu that
 * holds the Sign out action — the Atlas admin shell keeps session controls here
 * rather than in a separate top bar.
 *
 * Persona vs role is shown without repetition: when a distinct persona name is
 * known it is the primary line and the role is the secondary line; otherwise the
 * role alone is shown once. The role line always carries the `nav-role-badge`
 * test id so role-based assertions have a single stable target.
 */
function UserMenu({
  personaName,
  roleText,
  onLogout,
}: {
  personaName?: string | null;
  roleText: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const showPersona = !!personaName && personaName !== roleText;
  const primary = showPersona ? (personaName as string) : roleText;

  return (
    <div className="relative border-t border-border pt-3">
      {open && (
        <div
          role="menu"
          data-testid="nav-account-menu"
          className="absolute bottom-full left-0 right-0 mb-1 flex flex-col rounded-sm border border-border bg-surface p-1 shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="nav-logout-button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex items-center gap-2 px-2 py-2 rounded-sm text-sm font-medium text-ink-muted text-left cursor-pointer transition-colors duration-120 hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="log-out" size={16} />
            <span>Sign out</span>
          </button>
        </div>
      )}

      <button
        type="button"
        data-testid="nav-account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2 py-2 rounded-sm border border-border bg-surface text-left cursor-pointer transition-colors duration-120 hover:bg-surface-hover"
      >
        <div className="w-8 h-8 rounded-sm bg-ink text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
          {initialsFor(primary)}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-xs font-medium text-ink truncate"
            data-testid={showPersona ? undefined : 'nav-role-badge'}
          >
            {primary}
          </div>
          {showPersona && (
            <div className="text-xs text-ink-subtle truncate" data-testid="nav-role-badge">
              {roleText}
            </div>
          )}
        </div>
        <Icon name="chevrons-up-down" size={15} />
      </button>
    </div>
  );
}

/**
 * Left sidebar: brand, nav items, and the account menu (with Sign out).
 */
function Sidebar({
  config,
  activePath,
  onNavigate,
  personaName,
  roleText,
  onLogout,
}: {
  config: RoleRouteConfig;
  activePath: string | null;
  onNavigate: (path: string) => void;
  personaName?: string | null;
  roleText: string;
  onLogout: () => void;
}) {
  return (
    <aside
      data-testid="nav-sidebar"
      className="flex flex-col h-screen w-44 flex-shrink-0 bg-surface border-r border-border p-3"
    >
      {/* Brand — product only; the role lives in the account menu below so it is
          never shown twice. */}
      <div className="flex items-center gap-2 px-2 pb-3 mb-2 border-b border-border">
        <div className="font-semibold text-base text-ink">Commission Mgmt</div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-auto" aria-label="Sidebar navigation">
        <div className="flex flex-col gap-1">
          {config.navItems.map((item) => (
            <NavLink
              key={item.path}
              item={item}
              active={item.path === activePath}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>

      <UserMenu personaName={personaName} roleText={roleText} onLogout={onLogout} />
    </aside>
  );
}

/**
 * Application shell: a single left sidebar plus the page content. No top bar —
 * session controls live in the sidebar account menu (see UserMenu).
 */
export function NavShell({
  role,
  currentPath,
  onNavigate,
  onLogout,
  personaName,
  children,
}: NavShellProps) {
  const config = ROLE_ROUTES[role];
  const activePath = activeNavPath(role, currentPath);
  const roleText = roleLabel(role);

  return (
    <div data-testid="nav-shell" className="flex h-screen bg-surface-muted overflow-hidden">
      <Sidebar
        config={config}
        activePath={activePath}
        onNavigate={onNavigate}
        personaName={personaName}
        roleText={roleText}
        onLogout={onLogout}
      />

      <main className="flex-1 min-w-0 overflow-auto p-6">
        <div className="max-w-screen-2xl mx-auto">{children}</div>
      </main>
    </div>
  );
}

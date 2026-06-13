/**
 * NavShell — application navigation shell with left sidebar.
 *
 * Implements the Atlas design system layout: left sidebar with nav items,
 * top bar with page title and user info, and main content area.
 *
 * Layout is responsive but sidebar is always visible (no mobile collapse).
 *
 * Canonical docs: Atlas design system (packages/ui/design-system/atlas/);
 *                 docs/web-app-ux.md (routing seam)
 */

import type { AppRole } from 'core/auth';
import {
  ROLE_ROUTES,
  activeNavPath,
  roleLabel,
  type NavItem,
  type RoleRouteConfig,
} from '../lib/roleRoutes';
import { type ReactNode, type MouseEvent } from 'react';

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
      strokeWidth="2"
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
        active
          ? 'bg-color-surface-hover text-color-ink font-medium'
          : 'text-color-ink-muted hover:text-color-ink'
      }`}
    >
      <Icon name={item.icon} size={17} />
      <span className="flex-1 text-sm">{item.label}</span>
    </a>
  );
}

/**
 * Left sidebar with branding, nav items, and user account info.
 */
function Sidebar({
  config,
  activePath,
  onNavigate,
  personaName,
  roleText,
}: {
  config: RoleRouteConfig;
  activePath: string | null;
  onNavigate: (path: string) => void;
  personaName?: string | null;
  roleText: string;
}) {
  return (
    <aside
      data-testid="nav-sidebar"
      className="flex flex-col h-screen w-44 flex-shrink-0 bg-color-surface border-r border-color-border p-3"
    >
      {/* Brand */}
      <div className="flex items-center gap-2 px-2 pb-3 mb-2 border-b border-color-border">
        <div className="flex-1">
          <div className="font-semibold text-base text-color-ink">Commission Mgmt</div>
          <div className="text-xs text-color-ink-subtle mt-0.5">{roleText}</div>
        </div>
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

      {/* User account info */}
      <div className="border-t border-color-border pt-3">
        <button
          className="w-full flex items-center gap-2 px-2 py-2 rounded-sm border border-color-border bg-color-surface text-left cursor-pointer transition-colors duration-120 hover:bg-color-surface-hover"
          onClick={() => {}}
        >
          <div className="w-8 h-8 rounded-sm bg-color-ink text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
            {personaName
              ?.split(' ')
              .slice(0, 2)
              .map((n) => n[0])
              .join('')
              .toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-color-ink truncate">
              {personaName || roleText}
            </div>
            <div className="text-xs text-color-ink-subtle truncate">{roleText}</div>
          </div>
        </button>
      </div>
    </aside>
  );
}

/**
 * Top bar with page title, user badge, and logout.
 */
function TopBar({
  personaName,
  roleText,
  onLogout,
}: {
  personaName?: string | null;
  roleText: string;
  onLogout: () => void;
}) {
  return (
    <header
      data-testid="nav-topbar"
      className="h-13 flex-shrink-0 border-b border-color-border bg-color-surface flex items-center px-6 gap-4"
    >
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <div
          data-testid="nav-role-badge"
          className="text-xs font-medium text-color-ink-muted px-2.5 py-1 bg-color-surface-muted rounded-xs whitespace-nowrap"
        >
          {personaName ? `${personaName} · ${roleText}` : roleText}
        </div>
        <button
          type="button"
          data-testid="nav-logout-button"
          onClick={onLogout}
          className="px-3 py-2 rounded-sm text-sm font-medium text-color-ink-muted border border-color-border cursor-pointer transition-colors duration-120 hover:text-color-ink"
        >
          Log out
        </button>
      </div>
    </header>
  );
}

/**
 * Main layout container with sidebar and main content area.
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
    <div data-testid="nav-shell" className="flex h-screen bg-color-surface-muted overflow-hidden">
      {/* Left sidebar */}
      <Sidebar
        config={config}
        activePath={activePath}
        onNavigate={onNavigate}
        personaName={personaName}
        roleText={roleText}
      />

      {/* Main area: topbar + content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar personaName={personaName} roleText={roleText} onLogout={onLogout} />

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-screen-2xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}

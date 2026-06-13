// Atlas Admin Console — application shell (sidebar + topbar).

function NavItem({ icon, label, active, badge, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        height: 34, padding: '0 10px', border: 'none', cursor: 'pointer',
        borderRadius: 'var(--radius-sm)', textAlign: 'left',
        font: `var(--weight-medium) var(--text-sm)/1 var(--font-sans)`,
        background: active ? 'var(--surface-active)' : hover ? 'var(--surface-hover)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        transition: 'background 120ms ease, color 120ms ease',
      }}>
      <Icon name={icon} size={17} strokeWidth={active ? 2 : 1.7} style={{ color: active ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && <span style={{ font: 'var(--weight-medium) 11px/1 var(--font-mono)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{badge}</span>}
    </button>
  );
}

function Sidebar({ route, go }) {
  const NavGroup = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="atlas-overline" style={{ padding: '0 10px', margin: '14px 0 6px' }}>{label}</div>
      {children}
    </div>
  );
  return (
    <aside style={{
      width: 'var(--layout-sidebar)', flex: '0 0 auto', height: '100%',
      background: 'var(--surface-card)', borderRight: '1px solid var(--border-default)',
      display: 'flex', flexDirection: 'column', padding: '14px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 8px 10px' }}>
        <img src="../../assets/atlas-mark.svg" width="26" height="26" alt="Atlas" />
        <span style={{ font: 'var(--weight-semibold) 17px/1 var(--font-sans)', letterSpacing: '-0.03em' }}>Atlas</span>
        <span style={{ marginLeft: 'auto', font: '10px var(--font-mono)', color: 'var(--text-disabled)' }}>v2.4</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }} className="atlas-scroll">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NavItem icon="layout-dashboard" label="Dashboard" active={route === 'dashboard'} onClick={() => go('dashboard')} />
          <NavItem icon="users" label="Users" active={route === 'users' || route === 'user-detail'} badge="248" onClick={() => go('users')} />
          <NavItem icon="folder" label="Teams" onClick={() => go('users')} />
          <NavItem icon="key" label="API keys" onClick={() => go('users')} />
        </div>
        <NavGroup label="Operations">
          <NavItem icon="credit-card" label="Billing" onClick={() => go('users')} />
          <NavItem icon="scroll-text" label="Audit log" badge="12" onClick={() => go('users')} />
          <NavItem icon="bell" label="Alerts" onClick={() => go('users')} />
        </NavGroup>
        <NavGroup label="Workspace">
          <NavItem icon="settings" label="Settings" active={route === 'settings'} onClick={() => go('settings')} />
          <NavItem icon="shield" label="Security" onClick={() => go('settings')} />
        </NavGroup>
      </div>

      <button style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', marginTop: 8,
        padding: '8px 8px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-card)', cursor: 'pointer',
      }}>
        <span style={{ width: 26, height: 26, borderRadius: 'var(--radius-sm)', background: 'var(--gray-900)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: 'var(--weight-semibold) 12px var(--font-sans)', flex: '0 0 auto' }}>AC</span>
        <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.25, flex: 1, minWidth: 0 }}>
          <span style={{ font: 'var(--weight-medium) var(--text-sm) var(--font-sans)', color: 'var(--text-primary)' }}>Acme Inc</span>
          <span style={{ font: '11px var(--font-sans)', color: 'var(--text-tertiary)' }}>Pro plan</span>
        </span>
        <Icon name="chevrons-up-down" size={15} style={{ color: 'var(--text-tertiary)' }} />
      </button>
    </aside>
  );
}

function Topbar({ title }) {
  const { IconButton, Avatar } = window.AtlasDesignSystem_9b7d80;
  return (
    <header style={{
      height: 'var(--layout-topbar)', flex: '0 0 auto',
      borderBottom: '1px solid var(--border-default)', background: 'var(--surface-card)',
      display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px',
    }}>
      <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', display: 'inline-flex' }}><Icon name="search" size={15} /></span>
        <input placeholder="Search users, teams, keys…" style={{
          width: '100%', height: 34, padding: '0 10px 0 32px',
          border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-page)', font: 'var(--text-sm) var(--font-sans)', color: 'var(--text-primary)', outline: 'none',
        }} />
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', font: '11px var(--font-mono)', color: 'var(--text-disabled)', border: '1px solid var(--border-default)', borderRadius: 4, padding: '1px 5px' }}>⌘K</span>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton label="Help"><Icon name="circle-help" size={17} /></IconButton>
        <IconButton label="Notifications"><Icon name="bell" size={17} /></IconButton>
        <span style={{ width: 1, height: 22, background: 'var(--border-default)', margin: '0 6px' }} />
        <Avatar name="You Admin" size="sm" />
      </div>
    </header>
  );
}

function Shell({ route, go, children }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--surface-page)' }}>
      <Sidebar route={route} go={go} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar />
        <main className="atlas-scroll" style={{ flex: 1, overflow: 'auto', padding: 'var(--layout-gutter)' }}>
          <div style={{ maxWidth: 'var(--layout-page-max)', margin: '0 auto' }}>{children}</div>
        </main>
      </div>
    </div>
  );
}

Object.assign(window, { Shell });

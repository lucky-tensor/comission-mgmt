// Atlas Admin Console — User detail / edit record screen.

function UserDetailScreen({ user, go }) {
  const { Card, Badge, Button, IconButton, Tabs, Breadcrumb, Input, Select, Switch, Avatar, Banner } = window.AtlasDesignSystem_9b7d80;
  const u = user || ATLAS_USERS[0];
  const [tab, setTab] = React.useState('profile');
  const [dirty, setDirty] = React.useState(false);
  const markDirty = () => setDirty(true);

  const Field = ({ children }) => <div>{children}</div>;

  return (
    <div>
      <Breadcrumb items={[{ label: 'Users', href: '#' }, { label: u.team, href: '#' }, { label: u.name }]} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '14px 0 18px' }}>
        <Avatar name={u.name} size="lg" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ font: 'var(--weight-semibold) var(--text-h1)/1 var(--font-sans)', letterSpacing: 'var(--tracking-tight)' }}>{u.name}</h1>
            <Badge tone={STATUS_TONE[u.status]} dot>{u.status}</Badge>
          </div>
          <span style={{ font: 'var(--text-sm) var(--font-mono)', color: 'var(--text-tertiary)' }}>{u.email} · {u.id}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="secondary" iconLeft={<Icon name="mail" size={15} />}>Email</Button>
          <Button variant="secondary" onClick={() => go('users')}>Back</Button>
          <IconButton label="More actions" variant="outline"><Icon name="ellipsis" size={16} /></IconButton>
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { value: 'profile', label: 'Profile' },
        { value: 'permissions', label: 'Permissions' },
        { value: 'activity', label: 'Activity' },
      ]} />

      <div style={{ marginTop: 18 }}>
        {dirty && (
          <div style={{ marginBottom: 14 }}>
            <Banner tone="warning" title="Unsaved changes" onDismiss={() => setDirty(false)}>Save your edits before leaving this page.</Banner>
          </div>
        )}

        {tab === 'profile' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
            <Card title="Profile" subtitle="Basic account information">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Input label="Full name" defaultValue={u.name} onChange={markDirty} />
                <Input label="Email" defaultValue={u.email} onChange={markDirty} />
                <Select label="Role" options={['Owner', 'Admin', 'Member', 'Viewer']} defaultValue={u.role} onChange={markDirty} />
                <Select label="Team" options={['Leadership', 'Engineering', 'Design', 'Support', 'Finance']} defaultValue={u.team} onChange={markDirty} />
                <div style={{ gridColumn: '1 / -1' }}>
                  <Input label="Title" placeholder="e.g. Staff Engineer" onChange={markDirty} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
                <Button variant="secondary" onClick={() => setDirty(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setDirty(false)}>Save changes</Button>
              </div>
            </Card>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card title="Access">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <ToggleRow label="Two-factor auth" desc="Require 2FA at sign-in" defaultOn onToggle={markDirty} />
                  <ToggleRow label="API access" desc="Can create personal keys" defaultOn onToggle={markDirty} />
                  <ToggleRow label="Billing access" desc="View invoices & plan" onToggle={markDirty} />
                </div>
              </Card>
              <Card title="Danger zone" style={{ borderColor: 'var(--red-100)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ font: 'var(--text-sm) var(--font-sans)', color: 'var(--text-secondary)' }}>Suspend this user's access.</span>
                  <Button variant="danger" size="sm" iconLeft={<Icon name="ban" size={15} />}>Suspend</Button>
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === 'permissions' && (
          <Card title="Permissions" subtitle="Scopes granted to this user">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[
                ['users:read', 'Read user records', true],
                ['users:write', 'Create and edit users', true],
                ['billing:read', 'View billing', false],
                ['audit:read', 'View audit log', true],
                ['keys:write', 'Manage API keys', false],
              ].map(([scope, desc, on], i) => (
                <div key={scope} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ font: 'var(--weight-medium) var(--text-sm) var(--font-mono)', color: 'var(--text-primary)' }}>{scope}</span>
                    <span style={{ font: 'var(--text-xs) var(--font-sans)', color: 'var(--text-tertiary)' }}>{desc}</span>
                  </span>
                  <DefaultSwitch on={on} onToggle={markDirty} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab === 'activity' && (
          <Card title="Recent activity">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[
                ['Signed in', 'web · San Francisco', '2m ago', 'log-in'],
                ['Updated role to Admin', 'by Dana Reyes', '3h ago', 'user-cog'],
                ['Created API key', 'prod-deploy-key', '1d ago', 'key'],
                ['Password changed', 'web', '4d ago', 'lock'],
                ['Account created', 'invited by Dana Reyes', '2w ago', 'user-plus'],
              ].map(([title, meta, time, icon], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ width: 30, height: 30, borderRadius: 'var(--radius-full)', background: 'var(--surface-sunken)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', flex: '0 0 auto' }}><Icon name={icon} size={15} /></span>
                  <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ font: 'var(--weight-medium) var(--text-sm) var(--font-sans)', color: 'var(--text-primary)' }}>{title}</span>
                    <span style={{ font: 'var(--text-xs) var(--font-sans)', color: 'var(--text-tertiary)' }}>{meta}</span>
                  </span>
                  <span style={{ font: 'var(--text-xs) var(--font-mono)', color: 'var(--text-tertiary)' }}>{time}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, defaultOn, onToggle }) {
  const { Switch } = window.AtlasDesignSystem_9b7d80;
  const [on, setOn] = React.useState(!!defaultOn);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: 'var(--weight-medium) var(--text-sm) var(--font-sans)', color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ font: 'var(--text-xs) var(--font-sans)', color: 'var(--text-tertiary)' }}>{desc}</span>
      </span>
      <DefaultSwitch on={on} onToggle={(v) => { setOn(v); onToggle && onToggle(); }} />
    </div>
  );
}

function DefaultSwitch({ on, onToggle }) {
  const { Switch } = window.AtlasDesignSystem_9b7d80;
  const [v, setV] = React.useState(!!on);
  return <Switch checked={v} onChange={(nv) => { setV(nv); onToggle && onToggle(nv); }} />;
}

Object.assign(window, { UserDetailScreen, ToggleRow, DefaultSwitch });

// Atlas Admin Console — Workspace settings screen.

function SettingsScreen() {
  const { Card, Button, Input, Select, Textarea, Banner } = window.AtlasDesignSystem_9b7d80;
  const [section, setSection] = React.useState('general');
  const nav = [
    ['general', 'General', 'settings'],
    ['members', 'Members', 'users'],
    ['security', 'Security', 'shield'],
    ['billing', 'Billing', 'credit-card'],
    ['api', 'API & webhooks', 'webhook'],
  ];
  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure your workspace defaults and security." />
      <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 24, alignItems: 'start' }}>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'sticky', top: 0 }}>
          {nav.map(([id, label, icon]) => {
            const active = id === section;
            return (
              <button key={id} onClick={() => setSection(id)} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', border: 'none', cursor: 'pointer',
                borderRadius: 'var(--radius-sm)', textAlign: 'left',
                background: active ? 'var(--surface-active)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                font: `var(--weight-medium) var(--text-sm)/1 var(--font-sans)`,
              }}>
                <Icon name={icon} size={16} style={{ color: active ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
                {label}
              </button>
            );
          })}
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
          <Card title="Workspace" subtitle="How your workspace appears across Atlas">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Input label="Workspace name" defaultValue="Acme Inc" />
              <Input label="URL slug" defaultValue="acme" trailing={<span style={{ font: '12px var(--font-mono)', color: 'var(--text-tertiary)' }}>.atlas.app</span>} />
              <div style={{ gridColumn: '1 / -1' }}>
                <Textarea label="Description" rows={3} defaultValue="Internal admin workspace for Acme product operations." />
              </div>
              <Select label="Default role for new members" options={['Member', 'Viewer', 'Admin']} defaultValue="Member" />
              <Select label="Default timezone" options={['UTC', 'America/Los_Angeles', 'Europe/Berlin']} defaultValue="UTC" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
              <Button variant="secondary">Cancel</Button>
              <Button variant="primary">Save changes</Button>
            </div>
          </Card>

          <Card title="Session policy">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <ToggleRow label="Require two-factor authentication" desc="Enforce 2FA for all members" defaultOn />
              <ToggleRow label="Single sign-on (SSO)" desc="Allow login via your identity provider" />
              <ToggleRow label="Idle timeout" desc="Sign out after 30 minutes of inactivity" defaultOn />
            </div>
          </Card>

          <Card title="Danger zone" style={{ borderColor: 'var(--red-100)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Banner tone="danger" title="Deleting a workspace is permanent">All users, records, and API keys will be removed immediately.</Banner>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="danger" iconLeft={<Icon name="trash-2" size={15} />}>Delete workspace</Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsScreen });

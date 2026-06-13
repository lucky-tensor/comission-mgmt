// Atlas Admin Console — Dashboard / overview screen.

function DashboardScreen({ go }) {
  const { StatCard, Card, Table, Badge, Button } = window.AtlasDesignSystem_9b7d80;
  const recent = ATLAS_USERS.slice(0, 5);
  const cols = [
    { key: 'name', header: 'User', render: (v, r) => <Identity name={v} email={r.email} /> },
    { key: 'team', header: 'Team' },
    { key: 'status', header: 'Status', render: (v) => <Badge tone={STATUS_TONE[v]} dot>{v}</Badge> },
    { key: 'seen', header: 'Last seen', align: 'right', render: (v) => <span style={{ font: 'var(--text-xs) var(--font-mono)', color: 'var(--text-tertiary)' }}>{v}</span> },
  ];
  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Workspace activity for the last 30 days.">
        <span className="atlas-overline">Acme Inc · Overview</span>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard label="Total users" value="248" delta="+18" trend="up" icon={<Icon name="users" size={16} />} />
        <StatCard label="Active today" value="86" delta="+4%" trend="up" icon={<Icon name="activity" size={16} />} />
        <StatCard label="Pending invites" value="12" delta="-3" trend="down" icon={<Icon name="mail" size={16} />} />
        <StatCard label="API requests" value="1.2M" delta="+9%" trend="up" icon={<Icon name="zap" size={16} />} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, alignItems: 'start' }}>
        <Card title="Recent sign-ups" subtitle="Newest members across all teams"
          actions={<Button size="sm" variant="secondary" iconRight={<Icon name="arrow-right" size={15} />} onClick={() => go('users')}>View all</Button>}
          padding="none">
          <Table columns={cols} data={recent} rowKey="id" />
        </Card>

        <Card title="System status">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              ['API', 'Operational', 'success', '142ms'],
              ['Database', 'Operational', 'success', '8ms'],
              ['Webhooks', 'Degraded', 'warning', '1.4s'],
              ['Background jobs', 'Operational', 'success', '320 queued'],
            ].map(([label, state, tone, meta]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: `var(--status-${tone})` }} />
                  <span style={{ font: 'var(--weight-medium) var(--text-sm) var(--font-sans)', color: 'var(--text-primary)' }}>{label}</span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ font: 'var(--text-xs) var(--font-mono)', color: 'var(--text-tertiary)' }}>{meta}</span>
                  <Badge tone={tone}>{state}</Badge>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { DashboardScreen });

// Atlas Admin Console — Users list (core CRUD list view).

function UsersScreen({ go, openUser }) {
  const { Card, Table, Badge, Button, IconButton, Tabs, Pagination, Select, Dialog, Input } = window.AtlasDesignSystem_9b7d80;
  const [tab, setTab] = React.useState('all');
  const [sel, setSel] = React.useState([]);
  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const filtered = ATLAS_USERS.filter((u) => {
    const matchTab = tab === 'all' || u.status.toLowerCase() === tab;
    const matchQ = !query || (u.name + u.email + u.team).toLowerCase().includes(query.toLowerCase());
    return matchTab && matchQ;
  });

  const counts = {
    all: ATLAS_USERS.length,
    active: ATLAS_USERS.filter((u) => u.status === 'Active').length,
    pending: ATLAS_USERS.filter((u) => u.status === 'Pending').length,
  };

  const cols = [
    { key: 'name', header: 'User', render: (v, r) => (
      <button onClick={() => openUser(r)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
        <Identity name={v} email={r.email} />
      </button>
    ) },
    { key: 'role', header: 'Role', render: (v) => <span style={{ font: 'var(--text-sm) var(--font-sans)', color: 'var(--text-secondary)' }}>{v}</span> },
    { key: 'team', header: 'Team' },
    { key: 'status', header: 'Status', render: (v) => <Badge tone={STATUS_TONE[v]} dot>{v}</Badge> },
    { key: 'id', header: 'ID', render: (v) => <span style={{ font: 'var(--text-xs) var(--font-mono)', color: 'var(--text-tertiary)' }}>{v}</span> },
    { key: 'seen', header: 'Last seen', align: 'right', render: (v) => <span style={{ font: 'var(--text-xs) var(--font-mono)', color: 'var(--text-tertiary)' }}>{v}</span> },
    { key: '_a', header: '', width: 44, align: 'right', render: (_, r) => (
      <IconButton label="Row actions" onClick={() => openUser(r)}><Icon name="ellipsis" size={16} /></IconButton>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Users" subtitle="Manage members, roles, and access across your workspace."
        actions={<>
          <Button variant="secondary" iconLeft={<Icon name="download" size={15} />}>Export</Button>
          <Button variant="primary" iconLeft={<Icon name="plus" size={15} />} onClick={() => setCreating(true)}>Invite user</Button>
        </>} />

      <Tabs value={tab} onChange={(v) => { setTab(v); setSel([]); }} items={[
        { value: 'all', label: 'All', count: counts.all },
        { value: 'active', label: 'Active', count: counts.active },
        { value: 'pending', label: 'Pending', count: counts.pending },
      ]} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
        <div style={{ position: 'relative', width: 280 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', display: 'inline-flex' }}><Icon name="search" size={15} /></span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, email, team…"
            style={{ width: '100%', height: 34, padding: '0 10px 0 32px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-card)', font: 'var(--text-sm) var(--font-sans)', outline: 'none', color: 'var(--text-primary)' }} />
        </div>
        <div style={{ width: 150 }}><Select size="md" options={['All roles', 'Owner', 'Admin', 'Member', 'Viewer']} defaultValue="All roles" /></div>
        <Button variant="secondary" iconLeft={<Icon name="filter" size={15} />}>Filters</Button>
        {sel.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: 'var(--text-sm) var(--font-sans)', color: 'var(--text-secondary)' }}>{sel.length} selected</span>
            <Button size="sm" variant="secondary" iconLeft={<Icon name="user-cog" size={15} />}>Change role</Button>
            <Button size="sm" variant="danger" iconLeft={<Icon name="trash-2" size={15} />}>Remove</Button>
          </div>
        )}
      </div>

      <Card padding="none">
        <Table columns={cols} data={filtered} rowKey="id" selectable selected={sel} onSelectedChange={setSel}
          empty="No users match this filter." />
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-subtle)' }}>
          <Pagination page={1} pageSize={8} total={248} onPageChange={() => {}} />
        </div>
      </Card>

      <Dialog open={creating} onClose={() => setCreating(false)} width={460}
        title="Invite a user"
        description="They'll get an email with a link to join Acme Inc."
        footer={<>
          <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => setCreating(false)}>Send invite</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Email address" placeholder="name@acme.com" iconLeft={<Icon name="mail" size={15} />} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select label="Role" options={['Owner', 'Admin', 'Member', 'Viewer']} defaultValue="Member" />
            <Select label="Team" options={['Engineering', 'Design', 'Support', 'Finance']} defaultValue="Engineering" />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

Object.assign(window, { UsersScreen });

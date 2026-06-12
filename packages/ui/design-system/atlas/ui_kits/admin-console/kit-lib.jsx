// Shared helpers for the Atlas Admin Console UI kit.
// Loaded as a Babel script; exports to window for sibling screens.

// Lucide icon wrapper. Renders an <i data-lucide> then lets lucide replace it.
function Icon({ name, size = 16, strokeWidth = 1.6, style }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    host.appendChild(i);
    if (window.lucide) window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': strokeWidth } });
  }, [name, size, strokeWidth]);
  return <span ref={ref} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, ...style }} />;
}

// Page header used across screens.
function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {children}
        <h1 style={{ font: 'var(--weight-semibold) var(--text-h1)/1.1 var(--font-sans)', letterSpacing: 'var(--tracking-tight)' }}>{title}</h1>
        {subtitle && <p style={{ font: 'var(--text-sm)/1.4 var(--font-sans)', color: 'var(--text-tertiary)' }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>{actions}</div>}
    </div>
  );
}

// A labelled identity cell for tables.
function Identity({ name, email }) {
  const { Avatar } = window.AtlasDesignSystem_9b7d80;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <Avatar name={name} size="sm" />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name}</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{email}</span>
      </span>
    </span>
  );
}

// Seed data shared across screens.
const ATLAS_USERS = [
  { id: 'usr_8Kp2', name: 'Dana Reyes', email: 'dana@acme.com', role: 'Owner', team: 'Leadership', status: 'Active', seen: '2m ago' },
  { id: 'usr_3Lm9', name: 'Liam Okafor', email: 'liam@acme.com', role: 'Admin', team: 'Engineering', status: 'Active', seen: '1h ago' },
  { id: 'usr_7Qr4', name: 'Priya Shah', email: 'priya@acme.com', role: 'Member', team: 'Engineering', status: 'Active', seen: '3h ago' },
  { id: 'usr_2Zt6', name: 'Marco Bianchi', email: 'marco@acme.com', role: 'Member', team: 'Design', status: 'Pending', seen: 'Invited' },
  { id: 'usr_5Yw1', name: 'Aisha Khan', email: 'aisha@acme.com', role: 'Admin', team: 'Support', status: 'Active', seen: '5h ago' },
  { id: 'usr_9Bn3', name: 'Tom Fisher', email: 'tom@acme.com', role: 'Viewer', team: 'Finance', status: 'Suspended', seen: '6d ago' },
  { id: 'usr_4Hd8', name: 'Sofia Mendez', email: 'sofia@acme.com', role: 'Member', team: 'Design', status: 'Active', seen: '1d ago' },
  { id: 'usr_1Gk5', name: 'Noah Becker', email: 'noah@acme.com', role: 'Member', team: 'Support', status: 'Pending', seen: 'Invited' },
];

const STATUS_TONE = { Active: 'success', Pending: 'warning', Suspended: 'danger', Invited: 'neutral' };

Object.assign(window, { Icon, PageHeader, Identity, ATLAS_USERS, STATUS_TONE });

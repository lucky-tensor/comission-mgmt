// Atlas Admin Console — app wiring.

function App() {
  const [route, setRoute] = React.useState('dashboard');
  const [activeUser, setActiveUser] = React.useState(null);

  const go = (r) => { setRoute(r); };
  const openUser = (u) => { setActiveUser(u); setRoute('user-detail'); };

  return (
    <Shell route={route} go={go}>
      {route === 'dashboard' && <DashboardScreen go={go} />}
      {route === 'users' && <UsersScreen go={go} openUser={openUser} />}
      {route === 'user-detail' && <UserDetailScreen user={activeUser} go={go} />}
      {route === 'settings' && <SettingsScreen />}
    </Shell>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

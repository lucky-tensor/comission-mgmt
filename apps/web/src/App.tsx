/**
 * Root application component with minimal client-side routing.
 *
 * Routes:
 *   /portal — Producer Payout Portal (the first built role surface)
 *   /       — on load, probe the session; if authenticated redirect to /portal,
 *             otherwise render the Login screen (login no longer dead-ends at /).
 *
 * Routing is intentionally tiny (no router dependency): the app reads
 * window.location.pathname and navigates with history.pushState. The portal
 * itself redirects back to / on a 401.
 *
 * Canonical docs: docs/prd.md §5.8 — Producer Payout Portal
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { useState, useEffect } from 'react';
import Login from './components/Login';
import { ProducerPortal } from './components/portal/ProducerPortal';
import { ApiError, apiGet } from './lib/apiClient';

/** Navigate to a path and notify listeners (pushState doesn't emit popstate). */
export function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // On the root path, probe the session and redirect authenticated producers
  // straight to the portal so login no longer dead-ends at /.
  useEffect(() => {
    if (path !== '/') return;
    let active = true;
    apiGet('/me/commission-records')
      .then(() => {
        if (active) navigate('/portal');
      })
      .catch((err: unknown) => {
        // 401 → stay on login. Any other outcome means the session is valid
        // (e.g. a producer with no records still returns 200), so go to portal.
        if (active && (!(err instanceof ApiError) || err.status !== 401)) {
          navigate('/portal');
        }
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (path === '/portal') {
    return <ProducerPortal onUnauthenticated={() => navigate('/')} />;
  }
  return <Login />;
}

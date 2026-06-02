/**
 * Root application component with role-based client-side routing.
 *
 * Routes (six role surfaces + login):
 *   /          — probes session; redirects to role landing or stays on login
 *   /portal    — Producer Payout Portal
 *   /finance   — Finance Admin home (data-gap queue + commission run review)
 *   /manager   — Manager home (placeholder)
 *   /executive — Executive dashboard (placeholder)
 *   /hr        — HR home (placeholder)
 *   /partner   — External Partner home (placeholder)
 *
 * Routing is intentionally tiny (no router dependency): the app reads
 * window.location.pathname and navigates with history.pushState.
 *
 * Role-gating: routes outside a user's permission set render the 403/Forbidden
 * surface rather than another role's data. The role→routes map lives in a
 * single module (lib/roleRoutes.ts).
 *
 * Canonical docs: docs/prd.md §3 (User Roles)
 * Issues: feat: web app shell — role-based routing, navigation, and per-role
 *         landing (#100)
 *         feat: Finance Admin UI — data-gap / completeness review queue (#101)
 *         feat: Finance Admin UI — commission run review and batch approval (#102)
 */

import { useState, useEffect } from 'react';
import Login from './components/Login';
import { ProducerPortal } from './components/portal/ProducerPortal';
import { DataGapQueue } from './components/finance/DataGapQueue';
import { CommissionRunReview } from './components/finance/CommissionRunReview';
import { NavShell } from './components/NavShell';
import { Forbidden } from './components/Forbidden';
import { ManagerHome, ExecutiveHome, HrHome, PartnerHome } from './components/PlaceholderSurface';
import { useSession } from './lib/useSession';
import { isPathPermitted, landingPathForRole, ROUTES } from './lib/roleRoutes';

/** Navigate to a path and notify listeners (pushState doesn't emit popstate). */
export function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// ---------------------------------------------------------------------------
// Authenticated shell — rendered once session is known
// ---------------------------------------------------------------------------

interface AuthenticatedAppProps {
  role: import('core/auth').AppRole;
  path: string;
}

function AuthenticatedApp({ role, path }: AuthenticatedAppProps) {
  const permitted = isPathPermitted(role, path);

  function renderSurface() {
    if (!permitted) {
      return <Forbidden role={role} onNavigate={navigate} />;
    }
    switch (path) {
      case ROUTES.PORTAL:
        return <ProducerPortal onUnauthenticated={() => navigate(ROUTES.LOGIN)} />;
      case ROUTES.FINANCE:
        return (
          <>
            <DataGapQueue />
            <CommissionRunReview />
          </>
        );
      case ROUTES.MANAGER:
        return <ManagerHome />;
      case ROUTES.EXECUTIVE:
        return <ExecutiveHome />;
      case ROUTES.HR:
        return <HrHome />;
      case ROUTES.PARTNER:
        return <PartnerHome />;
      default:
        return <Forbidden role={role} onNavigate={navigate} />;
    }
  }

  return (
    <NavShell role={role} currentPath={path} onNavigate={navigate}>
      {renderSurface()}
    </NavShell>
  );
}

// ---------------------------------------------------------------------------
// Root app
// ---------------------------------------------------------------------------

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const { session, loading, unauthenticated } = useSession();

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Once session is resolved and user is authenticated, redirect from '/' to
  // the role's landing page.
  useEffect(() => {
    if (loading || unauthenticated || !session) return;
    if (path === ROUTES.LOGIN) {
      navigate(landingPathForRole(session.role));
    }
  }, [loading, unauthenticated, session, path]);

  // Not yet resolved — render nothing (brief flash prevention).
  if (loading) {
    return null;
  }

  // No session — show login.
  if (unauthenticated || !session) {
    return <Login />;
  }

  // Authenticated — render the role-aware shell.
  return <AuthenticatedApp role={session.role} path={path} />;
}

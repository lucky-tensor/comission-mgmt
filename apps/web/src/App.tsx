/**
 * Root application component with role-based client-side routing.
 *
 * Routes (six role surfaces + login):
 *   /          — probes session; redirects to role landing or stays on login
 *   /portal    — Producer Payout Portal
 *   /finance   — Finance Admin home (data-gap queue + commission run review + invoice tracking)
 *   /manager   — Manager home (split approval + attribution timeline, team commission view, cross-team split escalation / tiebreaker)
 *   /executive              — Executive dashboard (firm financial position + escalated dispute final-approval)
 *   /executive/profitability — Executive profitability analytics (by client/recruiter/team/practice)
 *   /executive/trends        — Executive exception & dispute rate trends
 *   /hr        — HR home (commission plan acknowledgment + draw balance and recovery schedule)
 *   /partner   — External Partner home (scoped payout view)
 *   /docs      — In-app documentation viewer (all roles; ExternalPartner sees partner guide + glossary only)
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
 *         feat: Finance Admin UI — invoice and collection tracking (per billing phase) (#103)
 *         feat: Manager UI — split approval and attribution timeline (#107)
 *         feat: Manager UI — team commission view (#108)
 *         feat: Manager UI — cross-team split escalation / tiebreaker (#109)
 *         feat: Executive UI — firm financial position dashboard (#110)
 *         feat: Executive UI — profitability analytics surface (#111)
 *         feat: Executive UI — exception and dispute-rate trends (#112)
 *         feat: Executive UI — escalated dispute final-approval (#113)
 *         feat: HR/People Ops UI — draw balance and recovery schedule view (#115)
 */

import { useState, useEffect, useRef } from 'react';
import Login from './components/Login';
import { ProducerPortal } from './components/portal/ProducerPortal';
import { ReconciliationReport } from './components/finance/ReconciliationReport';
import { NavShell } from './components/NavShell';
import { Forbidden } from './components/Forbidden';
import { ExecTrends } from './components/executive/ExecTrends';
import { FinancePage } from './components/finance/FinancePage';
import { ManagerHome } from './components/manager/ManagerHome';
import { ExecFinancialPosition } from './components/executive/ExecFinancialPosition';
import { ExecProfitability } from './components/ExecProfitability';
import { ExecDisputeApproval } from './components/executive/ExecDisputeApproval';
import { PlanAcknowledgment } from './components/hr/PlanAcknowledgment';
import { DrawBalanceView } from './components/hr/DrawBalanceView';
import { PartnerPayoutView } from './components/partner/PartnerPayoutView';
import { DocsView } from './components/DocsView';
import { useSession } from './lib/useSession';
import { apiPost } from './lib/apiClient';
import { isPathPermitted, landingPathForRole, ROUTES } from './lib/roleRoutes';
import { colors, font } from 'ui';

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
  personaName?: string | null;
  onLogout: () => void;
}

function AuthenticatedApp({ role, path, personaName, onLogout }: AuthenticatedAppProps) {
  const permitted = isPathPermitted(role, path);

  function renderSurface() {
    if (!permitted) {
      return <Forbidden role={role} onNavigate={navigate} />;
    }
    switch (path) {
      case ROUTES.PORTAL:
        return <ProducerPortal onUnauthenticated={() => navigate(ROUTES.LOGIN)} />;
      case ROUTES.FINANCE:
        return <FinancePage />;
      case ROUTES.RECONCILIATION:
        return <ReconciliationReport />;
      case ROUTES.MANAGER:
        return <ManagerHome />;
      case ROUTES.EXECUTIVE:
        return (
          <>
            <ExecFinancialPosition />
            <ExecDisputeApproval role={role} />
          </>
        );
      case ROUTES.EXEC_PROFITABILITY:
        return <ExecProfitability />;
      case ROUTES.EXEC_TRENDS:
        return <ExecTrends />;
      case ROUTES.HR:
        return (
          <>
            <PlanAcknowledgment />
            <DrawBalanceView />
          </>
        );
      case ROUTES.PARTNER:
        return <PartnerPayoutView onUnauthenticated={() => navigate(ROUTES.LOGIN)} />;
      case ROUTES.DOCS:
        return <DocsView role={role} />;
      default:
        return <Forbidden role={role} onNavigate={navigate} />;
    }
  }

  return (
    <NavShell
      role={role}
      currentPath={path}
      personaName={personaName}
      onNavigate={navigate}
      onLogout={onLogout}
    >
      {renderSurface()}
    </NavShell>
  );
}

// ---------------------------------------------------------------------------
// Session skeleton — shown while the /me probe is in flight, instead of a
// blank frame (docs/ux-review.md §6: blank-screen flashes during session load).
// ---------------------------------------------------------------------------

function SessionSkeleton() {
  return (
    <div
      data-testid="session-skeleton"
      aria-busy="true"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: font.family,
        color: colors.inkSubtle,
        fontSize: '0.875rem',
      }}
    >
      Loading your workspace…
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root app
// ---------------------------------------------------------------------------

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const { session, loading, unauthenticated, refreshSession } = useSession();

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Track the previously resolved role so we can detect demo account switches.
  const prevRoleRef = useRef<import('core/auth').AppRole | null>(null);

  // Redirect to the role's landing when on the login path, or when the role
  // changes (e.g. after a demo account switch). Manual navigation to an
  // unauthorized route intentionally shows the Forbidden surface instead.
  useEffect(() => {
    if (loading || unauthenticated || !session) return;
    const roleChanged = prevRoleRef.current !== null && prevRoleRef.current !== session.role;
    prevRoleRef.current = session.role;
    if (path === ROUTES.LOGIN || roleChanged) {
      navigate(landingPathForRole(session.role));
    }
  }, [loading, unauthenticated, session, path]);

  // Session not yet resolved — show a skeleton instead of a blank frame.
  if (loading) {
    return <SessionSkeleton />;
  }

  // No session — show login.
  if (unauthenticated || !session) {
    return <Login onSuccess={refreshSession} />;
  }

  // Authenticated — render the role-aware shell.
  const handleLogout = () => {
    apiPost('/auth/logout', {}).finally(() => {
      navigate(ROUTES.LOGIN);
      refreshSession();
    });
  };

  // Still on the login path — the redirect effect hasn't fired yet; show the
  // skeleton (not a blank frame) until it redirects to the role landing.
  if (path === ROUTES.LOGIN) return <SessionSkeleton />;

  return (
    <AuthenticatedApp
      role={session.role}
      path={path}
      personaName={session.display_name}
      onLogout={handleLogout}
    />
  );
}

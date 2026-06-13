/**
 * ExecutiveDashboard — Executive surface with tabbed interface.
 *
 * Consolidates four previously separate routes into one page with tabs:
 *
 *   1. Dashboard (default)
 *      - Firm financial position (headline metrics)
 *      - Escalated dispute final approval
 *
 *   2. Profitability
 *      - Profitability analytics by client/recruiter/team/practice
 *
 *   3. Trends
 *      - Exception rate and dispute rate trends over time
 *
 *   4. Finance (read-only)
 *      - Read-only view of finance operations (same data as FinanceAdmin)
 *
 * Canonical docs: docs/prd.md §4 (Executive)
 * Issue: feat: Executive UI — multiple analytics surfaces (#110–#113)
 */

import { Tabs } from '../Tabs';
import { ExecFinancialPosition } from './ExecFinancialPosition';
import { ExecDisputeApproval } from './ExecDisputeApproval';
import { ExecProfitability } from '../ExecProfitability';
import { ExecTrends } from './ExecTrends';
import { FinancePage } from '../finance/FinancePage';
import { ROUTES, tabFromPath, pathForTab } from '../../lib/roleRoutes';
import { navigate } from '../../lib/navigation';
import type { AppRole } from 'core/auth';

/** Default tab shown at the bare /executive path. */
const EXEC_DEFAULT_TAB = 'dashboard';

interface ExecutiveDashboardProps {
  role: AppRole;
  /**
   * Current location. The active tab is derived from the path and tab changes
   * update the URL, so the sidebar highlight and the page stay in sync.
   */
  currentPath?: string;
}

export function ExecutiveDashboard({ role, currentPath }: ExecutiveDashboardProps) {
  const urlSynced = currentPath !== undefined;
  const activeTab = urlSynced
    ? tabFromPath(currentPath, ROUTES.EXECUTIVE, EXEC_DEFAULT_TAB)
    : EXEC_DEFAULT_TAB;

  return (
    <div data-testid="executive-dashboard" className="space-y-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink m-0">Executive Dashboard</h1>
        <p className="text-sm text-ink-subtle mt-1 mb-0">
          Monitor firm financial position, profitability, trends, and operations.
        </p>
      </header>

      {/* key remounts Tabs when the URL-derived tab changes (e.g. a sidebar
          click), so the path stays the single source of truth for tab state. */}
      <Tabs
        key={activeTab}
        defaultTab={activeTab}
        onTabChange={
          urlSynced
            ? (tab) => navigate(pathForTab(tab, ROUTES.EXECUTIVE, EXEC_DEFAULT_TAB))
            : undefined
        }
      >
        <Tabs.Tab id="dashboard" label="Dashboard">
          <div className="space-y-6">
            <ExecFinancialPosition />
            <ExecDisputeApproval role={role} />
          </div>
        </Tabs.Tab>

        <Tabs.Tab id="profitability" label="Profitability">
          <ExecProfitability />
        </Tabs.Tab>

        <Tabs.Tab id="trends" label="Trends">
          <ExecTrends />
        </Tabs.Tab>

        <Tabs.Tab id="finance" label="Finance (read-only)">
          <FinancePage role={role} />
        </Tabs.Tab>
      </Tabs>
    </div>
  );
}

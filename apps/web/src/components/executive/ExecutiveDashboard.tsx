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
import type { AppRole } from 'core/auth';

interface ExecutiveDashboardProps {
  role: AppRole;
}

export function ExecutiveDashboard({ role }: ExecutiveDashboardProps) {
  return (
    <div data-testid="executive-dashboard" className="space-y-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink m-0">Executive Dashboard</h1>
        <p className="text-sm text-ink-subtle mt-1 mb-0">
          Monitor firm financial position, profitability, trends, and operations.
        </p>
      </header>

      <Tabs defaultTab="dashboard">
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
          <FinancePage />
        </Tabs.Tab>
      </Tabs>
    </div>
  );
}

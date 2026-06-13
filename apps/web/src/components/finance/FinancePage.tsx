/**
 * FinancePage — Finance Admin surface with tabbed interface.
 *
 * UX overhaul (#203, docs/ux-review.md §2): consolidates the Finance surfaces
 * into one page with tabs. Each tab is an addressable sub-path so the sidebar
 * links straight to it and deep-links work:
 *
 *   1. Cases                — /finance/cases
 *      - PlacementLedger — cross-role placement management surface
 *
 *   2. Processing (default) — /finance
 *      - Data Gap Queue              — placements missing commission-required data
 *      - Commission Runs             — open / review / approve / finalize runs
 *      - Invoice & Collection Tracking — per-placement billing phases & invoices
 *
 *   3. Adjustments & Payroll — /finance/adjustments
 *      - Adjustments & Payroll Export  — adjustment ledger + payroll-ready export
 *
 *   4. Reconciliation        — /finance/reconciliation
 *      - Reconciliation Report
 *
 * When `currentPath` is supplied (the standalone Finance Admin surface), the
 * active tab is derived from the URL and tab clicks push a new path — so the
 * sidebar highlight and the page stay in sync. When omitted (the read-only
 * instance embedded in the Executive dashboard) the tabs use local state only
 * and never change the URL.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin); docs/ux-review.md §2
 * Issue: feat: webapp — UX overhaul: page composition (#203)
 */

import type { ReactNode } from 'react';
import { Tabs } from '../Tabs';
import { DataGapQueue } from './DataGapQueue';
import { CommissionRunReview } from './CommissionRunReview';
import { InvoiceCollectionSection } from './FinanceAdmin';
import { FinanceAdminSurface } from './FinanceAdminSurface';
import { ReconciliationReport } from './ReconciliationReport';
import { PlacementLedger } from '../placements/PlacementLedger';
import { ROUTES, tabFromPath, pathForTab } from '../../lib/roleRoutes';
import { navigate } from '../../lib/navigation';
import type { AppRole } from 'core/auth';

/** Default tab shown at the bare /finance path. */
const FINANCE_DEFAULT_TAB = 'processing';

function Section({
  id,
  title,
  testId,
  children,
}: {
  id: string;
  /**
   * Section heading. Omit when the composed child already renders its own
   * matching task heading, so the page never shows the same heading twice.
   */
  title?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      className="bg-surface border border-border rounded-md p-6 mb-6"
      aria-labelledby={title ? id : undefined}
      data-testid={testId}
    >
      {title && (
        <h2 id={id} className="text-lg font-bold text-ink m-0 mb-4">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function FinancePage({
  role = 'FinanceAdmin',
  currentPath,
}: {
  role?: AppRole;
  /**
   * Current location. When provided, the active tab is read from the path and
   * tab changes update the URL. When omitted, tabs are local-state only (used
   * for the read-only Finance view embedded in the Executive dashboard).
   */
  currentPath?: string;
}) {
  const urlSynced = currentPath !== undefined;
  const activeTab = urlSynced
    ? tabFromPath(currentPath, ROUTES.FINANCE, FINANCE_DEFAULT_TAB)
    : FINANCE_DEFAULT_TAB;

  return (
    <div data-testid="finance-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink m-0">Finance Home</h1>
        <p className="text-sm text-ink-subtle mt-1 mb-0">
          Close the period: clear data gaps, run and approve commissions, track collection, and
          export payroll.
        </p>
      </header>

      {/* key remounts Tabs when the URL-derived tab changes (e.g. a sidebar
          click), so the path stays the single source of truth for tab state. */}
      <Tabs
        key={activeTab}
        defaultTab={activeTab}
        onTabChange={
          urlSynced
            ? (tab) => navigate(pathForTab(tab, ROUTES.FINANCE, FINANCE_DEFAULT_TAB))
            : undefined
        }
      >
        <Tabs.Tab id="cases" label="Cases">
          <PlacementLedger role={role} />
        </Tabs.Tab>

        <Tabs.Tab id="processing" label="Processing">
          <div className="space-y-6">
            {/* The Data Gap Queue child renders its own "Data Gap Queue" heading, so
                this section omits a second one (avoids duplicate heading text). */}
            <Section id="finance-data-gap" testId="finance-section-data-gap">
              <DataGapQueue embedded />
            </Section>

            <Section id="finance-runs" testId="finance-section-runs">
              <CommissionRunReview embedded />
            </Section>

            <Section
              id="finance-invoices"
              title="Invoice & Collection Tracking"
              testId="finance-section-invoices"
            >
              <InvoiceCollectionSection />
            </Section>
          </div>
        </Tabs.Tab>

        <Tabs.Tab id="adjustments" label="Adjustments & Payroll">
          <Section
            id="finance-adjustments"
            title="Adjustments & Payroll Export"
            testId="finance-section-adjustments"
          >
            <FinanceAdminSurface />
          </Section>
        </Tabs.Tab>

        <Tabs.Tab id="reconciliation" label="Reconciliation">
          <Section id="finance-reconciliation" testId="finance-section-reconciliation">
            <ReconciliationReport embedded />
          </Section>
        </Tabs.Tab>
      </Tabs>
    </div>
  );
}

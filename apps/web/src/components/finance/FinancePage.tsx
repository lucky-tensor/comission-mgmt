/**
 * FinancePage — Finance Admin surface with tabbed interface.
 *
 * UX overhaul (#203, docs/ux-review.md §2): consolidates separate routes
 * (/finance and /reconciliation) into one page with tabs:
 *
 *   1. Processing (default)
 *      - Data Gap Queue              — placements missing commission-required data
 *      - Commission Runs             — open / review / approve / finalize runs
 *      - Invoice & Collection Tracking — per-placement billing phases & invoices
 *
 *   2. Adjustments & Payroll
 *      - Adjustments & Payroll Export  — adjustment ledger + payroll-ready export
 *
 *   3. Reconciliation
 *      - Reconciliation Report
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
import type { AppRole } from 'core/auth';

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

export function FinancePage({ role = 'FinanceAdmin' }: { role?: AppRole }) {
  return (
    <div data-testid="finance-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink m-0">Finance Home</h1>
        <p className="text-sm text-ink-subtle mt-1 mb-0">
          Close the period: clear data gaps, run and approve commissions, track collection, and
          export payroll.
        </p>
      </header>

      <Tabs defaultTab="processing">
        <Tabs.Tab id="placements" label="Placements">
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

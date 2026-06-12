/**
 * FinancePage — the single composed Finance Home page.
 *
 * UX overhaul (#203, docs/ux-review.md §2): the /finance route used to render
 * four full-height components stacked on top of each other, two of which were
 * both titled "Finance Admin" (the viewer, not the task), producing a page
 * seven screens tall with content in 25% of it. This composes them into ONE
 * page with four task-named sections inside a standard content container, with
 * no duplicate headings and no viewport-height gaps:
 *
 *   1. Data Gap Queue              — placements missing commission-required data
 *   2. Commission Runs             — open / review / approve / finalize runs
 *   3. Invoice & Collection Tracking — per-placement billing phases & invoices
 *   4. Adjustments & Payroll Export  — adjustment ledger + payroll-ready export
 *
 * Each child renders its own controls and states; this page owns only the
 * section frame and headings.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin); docs/ux-review.md §2
 * Issue: feat: webapp — UX overhaul: page composition (#203)
 */

import type { ReactNode } from 'react';
import { DataGapQueue } from './DataGapQueue';
import { CommissionRunReview } from './CommissionRunReview';
import { InvoiceCollectionSection } from './FinanceAdmin';
import { FinanceAdminSurface } from './FinanceAdminSurface';

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
      className="bg-surface border border-border rounded-lg p-6 mb-6"
      aria-labelledby={title ? id : undefined}
      data-testid={testId}
    >
      {title && (
        <h2 id={id} className="text-[1.0625rem] font-bold text-ink m-0 mb-4">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function FinancePage() {
  return (
    <div data-testid="finance-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink m-0">Finance Home</h1>
        <p className="text-sm text-ink-subtle mt-1 mb-0">
          Close the period: clear data gaps, run and approve commissions, track collection, and
          export payroll.
        </p>
      </header>

      {/* The Data Gap Queue child renders its own "Data Gap Queue" heading, so
          this page omits a second one (avoids duplicate heading text). */}
      <Section id="finance-data-gap" testId="finance-section-data-gap">
        <DataGapQueue />
      </Section>

      <Section id="finance-runs" title="Commission Runs" testId="finance-section-runs">
        <CommissionRunReview />
      </Section>

      <Section
        id="finance-invoices"
        title="Invoice & Collection Tracking"
        testId="finance-section-invoices"
      >
        <InvoiceCollectionSection />
      </Section>

      <Section
        id="finance-adjustments"
        title="Adjustments & Payroll Export"
        testId="finance-section-adjustments"
      >
        <FinanceAdminSurface />
      </Section>
    </div>
  );
}

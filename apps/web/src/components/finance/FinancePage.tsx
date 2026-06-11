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

import type { CSSProperties, ReactNode } from 'react';
import { colors, radius } from 'ui';
import { DataGapQueue } from './DataGapQueue';
import { CommissionRunReview } from './CommissionRunReview';
import { InvoiceCollectionSection } from './FinanceAdmin';
import { FinanceAdminSurface } from './FinanceAdminSurface';

const sectionStyle: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: '1.5rem',
  marginBottom: '1.5rem',
};

const sectionHeadingStyle: CSSProperties = {
  fontSize: '1.0625rem',
  fontWeight: 700,
  color: colors.ink,
  margin: '0 0 1rem',
};

function Section({
  id,
  title,
  testId,
  children,
}: {
  id: string;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section style={sectionStyle} aria-labelledby={id} data-testid={testId}>
      <h2 id={id} style={sectionHeadingStyle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function FinancePage() {
  return (
    <div data-testid="finance-page">
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: colors.ink, margin: 0 }}>
          Finance Home
        </h1>
        <p style={{ fontSize: '0.875rem', color: colors.inkSubtle, margin: '0.25rem 0 0' }}>
          Close the period: clear data gaps, run and approve commissions, track collection, and
          export payroll.
        </p>
      </header>

      <Section id="finance-data-gap" title="Data Gap Queue" testId="finance-section-data-gap">
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

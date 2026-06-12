/**
 * PlaceholderSurface — empty-state surface for role home pages that have not
 * yet been implemented in their own issue.
 *
 * Each role surface issue registers a real component here; until then the
 * placeholder keeps routing functional and provides meaningful feedback.
 *
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
 */

export { FinanceAdminSurface as FinanceHome } from './finance/FinanceAdminSurface';

interface PlaceholderSurfaceProps {
  title: string;
  description: string;
  /** data-testid attribute for the wrapper (used in tests). */
  testId: string;
}

export function PlaceholderSurface({ title, description, testId }: PlaceholderSurfaceProps) {
  return (
    <div
      className="min-h-surface bg-surface-muted flex flex-col justify-center items-center p-8"
      data-testid={testId}
    >
      <div className="bg-surface p-10 rounded-xl border border-border text-center max-w-empty w-full">
        <h1 className="text-xl font-bold text-ink mb-3">{title}</h1>
        <p className="text-sm text-ink-subtle m-0">{description}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Named placeholder surfaces for each role home
// ---------------------------------------------------------------------------

export function ExecutiveHome() {
  return (
    <PlaceholderSurface
      testId="executive-home"
      title="Executive Dashboard"
      description="Firm-wide margin, liability, disputes, and producer concentration analytics. Coming soon."
    />
  );
}

export { PlanAcknowledgment as HrHome } from './hr/PlanAcknowledgment';

export function PartnerHome() {
  return (
    <PlaceholderSurface
      testId="partner-home"
      title="Partner Portal"
      description="Your credited placements and payout visibility. Coming soon."
    />
  );
}

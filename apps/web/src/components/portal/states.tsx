/**
 * Shared loading / error / empty state blocks for portal surfaces.
 *
 * Each portal component renders exactly one of: <LoadingState>, <ErrorState>,
 * <EmptyState>, or its data view — giving the three required non-data states a
 * single, test-targetable implementation (each carries a stable data-testid).
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

const BOX_CLASS = 'p-5 rounded-md text-sm';

/** Spinner-free loading placeholder. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div data-testid="loading-state" className={`${BOX_CLASS} text-ink-subtle`}>
      Loading {label}…
    </div>
  );
}

/** Error banner shown when a loader rejects. */
export function ErrorState({ message }: { message: string }) {
  return (
    <div
      data-testid="error-state"
      role="alert"
      className={`${BOX_CLASS} bg-bad-bg border border-bad-fg/30 text-bad-fg`}
    >
      {message}
    </div>
  );
}

/** Empty placeholder shown when a loader returns no rows. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div
      data-testid="empty-state"
      className={`${BOX_CLASS} bg-surface-muted border border-dashed border-border-strong text-ink-subtle`}
    >
      {message}
    </div>
  );
}

/** Card wrapper with a heading used by every portal panel. */
export function PortalCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-md p-6 mb-6">
      <h2 className="text-lg font-semibold text-ink mt-0">{title}</h2>
      {children}
    </section>
  );
}

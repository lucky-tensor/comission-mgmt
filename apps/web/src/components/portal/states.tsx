/**
 * Shared loading / error / empty state blocks for portal surfaces.
 *
 * Each portal component renders exactly one of: <LoadingState>, <ErrorState>,
 * <EmptyState>, or its data view — giving the three required non-data states a
 * single, test-targetable implementation (each carries a stable data-testid).
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

const boxStyle: React.CSSProperties = {
  padding: '1.25rem',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
};

/** Spinner-free loading placeholder. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div data-testid="loading-state" style={{ ...boxStyle, color: '#6b7280' }}>
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
      style={{ ...boxStyle, background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c' }}
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
      style={{ ...boxStyle, background: '#f9fafb', border: '1px dashed #d1d5db', color: '#6b7280' }}
    >
      {message}
    </div>
  );
}

/** Card wrapper with a heading used by every portal panel. */
export function PortalCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '0.75rem',
        padding: '1.5rem',
        marginBottom: '1.5rem',
      }}
    >
      <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827', marginTop: 0 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * TierProgress — the producer's progress toward the next commission-rate tier,
 * from GET /me/tier-progress.
 *
 * Pure view + container split. Renders current production, current rate, the
 * next-tier threshold, and a progress bar. A producer at the top tier (null
 * threshold) shows a "top tier" message instead of a bar. A 404 (no active plan
 * assignment) surfaces as the empty state.
 *
 * Canonical docs: docs/prd.md §5.3 — Producer tier progress
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import type { TierProgress } from 'core/producer-portal';
import { ApiError, apiGet } from '../../lib/apiClient';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import { formatCurrency, formatRate } from '../../lib/format';
import { PortalCard, LoadingState, ErrorState, EmptyState } from './states';

/** Pure presentational view — renders one of loading/error/empty/data. */
export function TierProgressView({ state }: { state: AsyncState<TierProgress | null> }) {
  return (
    <PortalCard title="Tier progress">
      {state.loading ? (
        <LoadingState label="tier progress" />
      ) : state.error ? (
        <ErrorState message={state.error} />
      ) : !state.data ? (
        <EmptyState message="No active plan assignment — tier progress is unavailable." />
      ) : (
        <TierProgressBody data={state.data} />
      )}
    </PortalCard>
  );
}

function TierProgressBody({ data }: { data: TierProgress }) {
  const atTop = data.next_tier_threshold === null;
  const pct = atTop
    ? 100
    : Math.min(
        100,
        Math.round((data.current_period_production / (data.next_tier_threshold || 1)) * 100),
      );
  return (
    <div data-testid="tier-progress">
      <p className="text-sm text-ink-muted mt-0 mb-3">
        Current production:{' '}
        <strong data-testid="tier-production">
          {formatCurrency(data.current_period_production)}
        </strong>{' '}
        at <strong>{formatRate(data.current_tier_rate)}</strong>
      </p>
      <div className="h-2 bg-border rounded-full overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      {atTop ? (
        <p data-testid="tier-at-cap" className="text-sm text-ok-fg mt-3 mb-0">
          You&apos;ve reached the top tier.
        </p>
      ) : (
        <p data-testid="tier-next-threshold" className="text-sm text-ink-subtle mt-3 mb-0">
          <strong data-testid="tier-remaining">
            {formatCurrency(data.remaining_to_next_tier ?? 0)}
          </strong>{' '}
          to the next tier at {formatCurrency(data.next_tier_threshold ?? 0)}.
        </p>
      )}
    </div>
  );
}

/** Container — fetches GET /me/tier-progress; treats 404 as "no plan" (empty). */
export function TierProgress() {
  const state = useAsync<TierProgress | null>(
    () =>
      apiGet<TierProgress>('/me/tier-progress').catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
    [],
  );
  return <TierProgressView state={state} />;
}

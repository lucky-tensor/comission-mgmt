/**
 * ProducerPortal — the producer's portal home. Composes the payout statement,
 * credited placements, tier progress, and dispute form, each fetching from the
 * real `/me/*` endpoints via apiClient.
 *
 * The dispute form needs the producer's commission records as dispute targets,
 * so the portal fetches GET /me/commission-records once and shares the result
 * with both the CreditedPlacements view and the DisputeForm.
 *
 * If the session is missing (any /me read returns 401) the portal redirects to
 * the login screen — GET /me itself is still a server-side 501 stub (#16), so
 * the portal derives its data from the records/payouts/tier-progress reads and
 * does not depend on GET /me.
 *
 * Canonical docs: docs/prd.md §5.9 — Producer Payout Portal
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import type { CommissionRecord } from 'core/producer-portal';
import { ApiError, apiGet } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { PayoutStatement } from './PayoutStatement';
import { CreditedPlacementsView } from './CreditedPlacements';
import { TierProgress } from './TierProgress';
import { DisputeForm } from './DisputeForm';
import { DealSimulator } from './DealSimulator';
import { ProducerPlanAcknowledgment } from '../hr/PlanAcknowledgment';
import { LoadingState, ErrorState } from './states';

export function ProducerPortal({ onUnauthenticated }: { onUnauthenticated?: () => void }) {
  // Shared records fetch — feeds both the placements list and the dispute form.
  const records = useAsync<CommissionRecord[]>(
    () =>
      apiGet<{ commission_records: CommissionRecord[] }>('/me/commission-records')
        .then((r) => r.commission_records)
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 401) {
            onUnauthenticated?.();
          }
          throw err;
        }),
    [],
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f9fafb',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '880px', margin: '0 auto' }}>
        <header style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            Producer Payout Portal
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
            Your credited placements, payouts, tier progress, and disputes.
          </p>
        </header>

        <PayoutStatement />

        <TierProgress />

        <ProducerPlanAcknowledgment />

        <CreditedPlacementsView state={records} />

        {records.loading ? (
          <LoadingState label="dispute form" />
        ) : records.error ? (
          <ErrorState message={records.error} />
        ) : (
          <DisputeForm records={records.data ?? []} />
        )}

        <DealSimulator />
      </div>
    </div>
  );
}

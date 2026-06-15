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
import { Tabs } from '../Tabs';
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
    <div className="min-h-screen bg-surface-muted px-4 py-8">
      <div className="max-w-narrow mx-auto">
        <header className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink m-0">
            Producer Payout Portal
          </h1>
          <p className="text-sm text-ink-subtle mt-1 mb-0">
            Your credited placements, payouts, tier progress, and disputes.
          </p>
        </header>

        <Tabs defaultTab="dashboard">
          <Tabs.Tab id="dashboard" label="Dashboard">
            <div className="space-y-6">
              <PayoutStatement />
              <TierProgress />
              <ProducerPlanAcknowledgment />
            </div>
          </Tabs.Tab>

          <Tabs.Tab id="placements" label="Placements">
            <div className="space-y-6">
              <CreditedPlacementsView state={records} />
              {records.loading ? (
                <LoadingState label="dispute form" />
              ) : records.error ? (
                <ErrorState message={records.error} />
              ) : (
                <DisputeForm records={records.data ?? []} />
              )}
            </div>
          </Tabs.Tab>

          <Tabs.Tab id="tools" label="Tools">
            <DealSimulator />
          </Tabs.Tab>
        </Tabs>
      </div>
    </div>
  );
}

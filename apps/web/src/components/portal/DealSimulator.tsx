/**
 * DealSimulator — stub producer-facing simulation surface.
 *
 * This component reserves the portal seam for issue #187 without wiring any
 * live simulation behavior yet. The producer portal can mount it later once the
 * producer-simulation API and persistence path are implemented.
 *
 * Canonical docs: docs/prd.md §5.8, docs/arbitration-simulation.md
 * Issue: feat: Producer Deal Simulation — payout + dispute-risk forecasting (#187)
 */

import { PortalCard, EmptyState } from './states';

/**
 * Stub card shown only when the simulator surface is wired into the portal.
 * It intentionally carries no network logic or side effects.
 */
export function DealSimulator() {
  return (
    <PortalCard title="Deal simulator">
      <EmptyState message="Deal simulation is not yet available in this scout build." />
    </PortalCard>
  );
}

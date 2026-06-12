/**
 * ManagerHome — Manager role landing page.
 *
 * Composes SplitApproval and AttributionTimeline into the Manager's
 * primary surface. Replaces the PlaceholderSurface used before this issue.
 *
 * Canonical docs: docs/prd.md §4 (Manager), §5.2, §5.4
 * Issue: feat: Manager UI — split approval and attribution timeline (#107)
 */

import { SplitApproval } from './SplitApproval';
import { AttributionTimeline } from './AttributionTimeline';
import { TeamCommissionView } from './TeamCommissionView';
import { ManagerPortal as SplitEscalation } from './SplitEscalation';

export function ManagerHome() {
  return (
    <div data-testid="manager-home" className="max-w-[64rem] mx-auto p-6">
      <SplitApproval />
      <AttributionTimeline />
      <TeamCommissionView />
      <SplitEscalation />
    </div>
  );
}

/**
 * ManagerHome — Manager role landing page.
 *
 * Composes manager surfaces into tabbed interface:
 * - Approvals: split approval and escalations
 * - Team Performance: team commission view and attribution timeline
 *
 * Canonical docs: docs/prd.md §4 (Manager), §5.2, §5.4
 * Issue: feat: Manager UI — split approval and attribution timeline (#107)
 */

import { Tabs } from '../Tabs';
import { SplitApproval } from './SplitApproval';
import { AttributionTimeline } from './AttributionTimeline';
import { TeamCommissionView } from './TeamCommissionView';
import { ManagerPortal as SplitEscalation } from './SplitEscalation';

export function ManagerHome() {
  return (
    <div data-testid="manager-home" className="max-w-[64rem] mx-auto p-6">
      <Tabs defaultTab="approvals">
        <Tabs.Tab id="approvals" label="Approvals">
          <div className="space-y-6">
            <SplitApproval />
            <SplitEscalation />
          </div>
        </Tabs.Tab>

        <Tabs.Tab id="team" label="Team Performance">
          <div className="space-y-6">
            <TeamCommissionView />
            <AttributionTimeline />
          </div>
        </Tabs.Tab>
      </Tabs>
    </div>
  );
}

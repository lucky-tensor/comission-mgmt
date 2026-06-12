/**
 * HRHome — HR / People Ops surface with tabbed interface.
 *
 * Organizes HR tasks into tabs:
 *
 *   1. Plan Acknowledgment (default)
 *      - Commission plan acknowledgment tracking per producer
 *
 *   2. Draw & Recovery
 *      - Draw balance and clawback recovery schedules
 *
 * Canonical docs: docs/prd.md §4 (HR / People Ops)
 * Issue: feat: HR/People Ops UI — draw balance and recovery schedule view (#115)
 */

import { Tabs } from '../Tabs';
import { PlanAcknowledgment } from './PlanAcknowledgment';
import { DrawBalanceView } from './DrawBalanceView';

export function HRHome() {
  return (
    <div data-testid="hr-home" className="max-w-[64rem] mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink m-0">HR Home</h1>
        <p className="text-sm text-ink-subtle mt-1 mb-0">
          Manage commission plans and producer compensation.
        </p>
      </header>

      <Tabs defaultTab="acknowledgment">
        <Tabs.Tab id="acknowledgment" label="Plan Acknowledgment">
          <PlanAcknowledgment />
        </Tabs.Tab>

        <Tabs.Tab id="draw" label="Draw & Recovery">
          <DrawBalanceView />
        </Tabs.Tab>
      </Tabs>
    </div>
  );
}

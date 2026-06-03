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

export function ManagerHome() {
  return (
    <div
      data-testid="manager-home"
      style={{
        maxWidth: '64rem',
        margin: '0 auto',
        padding: '1.5rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <SplitApproval />
      <AttributionTimeline />
    </div>
  );
}

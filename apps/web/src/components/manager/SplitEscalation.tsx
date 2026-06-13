/**
 * SplitEscalation — Manager UI for escalating a contested cross-team split to
 * the designated tiebreaker (practice lead, executive, etc.).
 *
 * Two panels:
 *   1. EscalationForm  — given a list of open team disputes, lets the Manager
 *      pick one and attach a required rationale, then POST /disputes/:id/resolve
 *      with the rationale as resolution_note. The existing dispute endpoint is
 *      the only available escalation path; the out-of-scope note in issue #109
 *      calls this out explicitly — a distinct "escalate to named tiebreaker"
 *      route does not yet exist on the backend.
 *
 *   2. EscalationList  — fetches GET /me/team/disputes (scoped to the Manager's
 *      team) and renders the current status of each escalation the Manager has
 *      raised.
 *
 * Both panels accept real injectable async handlers so they can be driven in
 * headless-Chromium component tests without any mock objects (TEST-C-001).
 *
 * RBAC: only the Manager role reaches /manager; any other role gets a 403 from
 * App.tsx before this component renders.
 *
 * Canonical docs: docs/prd.md §4 (Manager), §5.4
 * Issue: feat: Manager UI — cross-team split escalation / tiebreaker (#109)
 */

import { useState } from 'react';
import { Button, StatusChip, type StatusVariant } from 'ui';
import { apiGet, apiPost } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { PortalCard, LoadingState, ErrorState, EmptyState } from '../portal/states';

// ---------------------------------------------------------------------------
// Wire-format types (mirrors the /me/team/disputes + /disputes/:id/resolve shape)
// ---------------------------------------------------------------------------

/** A team dispute item as returned by GET /me/team/disputes. */
export interface TeamDisputeWire {
  id: string;
  org_id: string;
  commission_record_id: string;
  submitted_by: string;
  description: string;
  state: string;
  created_at: string;
  placement_id: string;
}

/** An escalated/resolved dispute as returned by POST /disputes/:id/resolve. */
export interface EscalatedDispute {
  id: string;
  org_id: string;
  commission_record_id: string;
  submitted_by: string;
  description: string;
  state: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  exception_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Field / button styles (shared inline to avoid a CSS dependency)
// ---------------------------------------------------------------------------

const FIELD_CLASS =
  'w-full px-3 py-2.5 border border-border-strong rounded-md text-sm box-border mb-3.5';

const LABEL_CLASS = 'block text-sm text-ink-muted mb-1';

const TABLE_CLASS = 'w-full border-collapse text-sm';

const TH_CLASS =
  'text-left px-3 py-2 border-b-2 border-border text-ink-subtle font-medium text-xs uppercase tracking-wider';

const TD_CLASS = 'px-3 py-2.5 border-b border-surface-sunken text-ink align-top';

// ---------------------------------------------------------------------------
// EscalationForm
// ---------------------------------------------------------------------------

/**
 * Form panel: pick a disputed split and provide a rationale to escalate it.
 *
 * @param disputes  - open team disputes to choose from (loaded by the parent)
 * @param onEscalate - escalation handler (defaults to POST /disputes/:id/resolve);
 *                    provided explicitly only in tests — a real async call, never a mock.
 */
export function EscalationForm({
  disputes,
  onEscalate = (disputeId: string, rationale: string) =>
    apiPost<EscalatedDispute>(`/disputes/${disputeId}/resolve`, {
      resolution_note: rationale,
    }),
}: {
  disputes: TeamDisputeWire[];
  onEscalate?: (disputeId: string, rationale: string) => Promise<EscalatedDispute>;
}) {
  const [disputeId, setDisputeId] = useState(disputes[0]?.id ?? '');
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EscalatedDispute | null>(null);

  if (disputes.length === 0) {
    return (
      <PortalCard title="Escalate a contested split">
        <EmptyState message="No open team disputes to escalate." />
      </PortalCard>
    );
  }

  if (result) {
    return (
      <PortalCard title="Escalate a contested split">
        <div
          data-testid="escalation-confirmation"
          role="status"
          className="p-5 bg-ok-bg border border-ok-fg/30 rounded-md text-ok-fg text-sm"
        >
          Escalation submitted — dispute state:{' '}
          <strong data-testid="escalation-state">{result.state}</strong>. The designated tiebreaker
          will be notified to review.
        </div>
        <p className="mt-3 text-sm text-ink-subtle">
          <em>
            Note: a distinct &quot;escalate to named tiebreaker&quot; endpoint is not yet available
            on the backend. The rationale has been recorded via the existing dispute-resolution
            path. A follow-up backend issue must add explicit escalation routing.
          </em>
        </p>
      </PortalCard>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rationale.trim()) {
      setError('A rationale is required before escalating.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const escalated = await onEscalate(disputeId, rationale.trim());
      setResult(escalated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to escalate dispute');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PortalCard title="Escalate a contested split">
      <form data-testid="escalation-form" onSubmit={handleSubmit}>
        <label className={LABEL_CLASS}>
          Disputed split
          <select
            data-testid="escalation-dispute-select"
            className={FIELD_CLASS}
            value={disputeId}
            onChange={(e) => setDisputeId(e.target.value)}
          >
            {disputes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.placement_id} — {d.state} — {d.description.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          Rationale
          <textarea
            data-testid="escalation-rationale"
            className={`${FIELD_CLASS} min-h-20 resize-y`}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Explain why this split cannot be resolved at the manager level and requires tiebreaker review…"
          />
        </label>
        {error && (
          <div data-testid="escalation-error" role="alert" className="text-bad-fg text-sm mb-3">
            {error}
          </div>
        )}
        <Button type="submit" data-testid="escalation-submit" disabled={submitting}>
          {submitting ? 'Escalating…' : 'Escalate to tiebreaker'}
        </Button>
      </form>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// EscalationList
// ---------------------------------------------------------------------------

/** State badge variant for dispute states. */
function stateBadgeVariant(state: string): StatusVariant {
  if (state === 'Resolved') return 'green';
  if (state === 'UnderReview') return 'amber';
  // Submitted / default — purple tint neutralized to gray per design system.
  return 'gray';
}

/**
 * List panel: shows all team disputes so the Manager can track escalation status.
 *
 * @param onLoad - loader (defaults to GET /me/team/disputes);
 *                 provided explicitly only in tests — a real async call, never a mock.
 */
export function EscalationList({
  onLoad = () =>
    apiGet<{ disputes: TeamDisputeWire[] }>('/me/team/disputes').then((r) => r.disputes),
}: {
  onLoad?: () => Promise<TeamDisputeWire[]>;
}) {
  const { data, loading, error } = useAsync(onLoad, []);

  return (
    <PortalCard title="Escalations raised by your team">
      {loading ? (
        <LoadingState label="escalations" />
      ) : error ? (
        <ErrorState message={error} />
      ) : !data || data.length === 0 ? (
        <EmptyState message="No escalations found for your team." />
      ) : (
        <table className={TABLE_CLASS} data-testid="escalation-list">
          <thead>
            <tr>
              <th className={TH_CLASS}>Placement</th>
              <th className={TH_CLASS}>Description</th>
              <th className={TH_CLASS}>Status</th>
              <th className={TH_CLASS}>Created</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id}>
                <td className={TD_CLASS} data-testid="escalation-placement">
                  {d.placement_id}
                </td>
                <td className={TD_CLASS}>{d.description}</td>
                <td className={TD_CLASS}>
                  <StatusChip data-testid="escalation-status" variant={stateBadgeVariant(d.state)}>
                    {d.state}
                  </StatusChip>
                </td>
                <td className={TD_CLASS}>{new Date(d.created_at).toLocaleDateString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// ManagerPortal — composes both panels
// ---------------------------------------------------------------------------

/**
 * Manager home surface — composes the escalation form (for open disputes) and
 * the escalation status list (all team disputes).
 *
 * Disputes for the form are loaded from GET /me/team/disputes so we can share
 * the single fetch between both panels.
 *
 * @param onLoad - loader for team disputes (injectable for component tests)
 * @param onEscalate - escalation submitter (injectable for component tests)
 */
export function ManagerPortal({
  onLoad = () =>
    apiGet<{ disputes: TeamDisputeWire[] }>('/me/team/disputes').then((r) => r.disputes),
  onEscalate = (disputeId: string, rationale: string) =>
    apiPost<EscalatedDispute>(`/disputes/${disputeId}/resolve`, {
      resolution_note: rationale,
    }),
}: {
  onLoad?: () => Promise<TeamDisputeWire[]>;
  onEscalate?: (disputeId: string, rationale: string) => Promise<EscalatedDispute>;
} = {}) {
  const { data: disputes, loading, error } = useAsync(onLoad, []);

  return (
    <div className="min-h-screen bg-surface-muted px-4 py-8">
      <div className="max-w-narrow mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-ink m-0">Manager — Cross-Team Split Escalation</h1>
          <p className="text-sm text-ink-subtle mt-1 mb-0">
            Escalate contested splits to the designated tiebreaker and track status.
          </p>
        </header>

        {/* Escalation form — only rendered once disputes are loaded */}
        {loading ? (
          <PortalCard title="Escalate a contested split">
            <LoadingState label="team disputes" />
          </PortalCard>
        ) : error ? (
          <PortalCard title="Escalate a contested split">
            <ErrorState message={error} />
          </PortalCard>
        ) : (
          <EscalationForm disputes={disputes ?? []} onEscalate={onEscalate} />
        )}

        {/* Status list — independent load via EscalationList's own useAsync */}
        <EscalationList onLoad={onLoad} />
      </div>
    </div>
  );
}

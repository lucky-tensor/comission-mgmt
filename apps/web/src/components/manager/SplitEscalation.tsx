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

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  marginBottom: '0.875rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  color: '#374151',
  marginBottom: '0.25rem',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  borderBottom: '2px solid #e5e7eb',
  color: '#6b7280',
  fontWeight: 500,
  fontSize: '0.75rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '0.625rem 0.75rem',
  borderBottom: '1px solid #f3f4f6',
  color: '#111827',
  verticalAlign: 'top',
};

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
          style={{
            padding: '1.25rem',
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: '0.5rem',
            color: '#065f46',
            fontSize: '0.875rem',
          }}
        >
          Escalation submitted — dispute state:{' '}
          <strong data-testid="escalation-state">{result.state}</strong>. The designated tiebreaker
          will be notified to review.
        </div>
        <p
          style={{
            marginTop: '0.75rem',
            fontSize: '0.8125rem',
            color: '#6b7280',
          }}
        >
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
        <label style={labelStyle}>
          Disputed split
          <select
            data-testid="escalation-dispute-select"
            style={fieldStyle}
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
        <label style={labelStyle}>
          Rationale
          <textarea
            data-testid="escalation-rationale"
            style={{ ...fieldStyle, minHeight: '5rem', resize: 'vertical' }}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Explain why this split cannot be resolved at the manager level and requires tiebreaker review…"
          />
        </label>
        {error && (
          <div
            data-testid="escalation-error"
            role="alert"
            style={{ color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '0.75rem' }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          data-testid="escalation-submit"
          disabled={submitting}
          style={{
            padding: '0.625rem 1.25rem',
            background: submitting ? '#9ca3af' : '#7c3aed',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Escalating…' : 'Escalate to tiebreaker'}
        </button>
      </form>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// EscalationList
// ---------------------------------------------------------------------------

/** State badge colours for dispute states. */
function stateBadge(state: string): React.CSSProperties {
  if (state === 'Resolved')
    return {
      background: '#dcfce7',
      color: '#166534',
      padding: '0.125rem 0.5rem',
      borderRadius: '9999px',
      fontSize: '0.75rem',
      fontWeight: 500,
    };
  if (state === 'UnderReview')
    return {
      background: '#fef9c3',
      color: '#854d0e',
      padding: '0.125rem 0.5rem',
      borderRadius: '9999px',
      fontSize: '0.75rem',
      fontWeight: 500,
    };
  // Submitted / default
  return {
    background: '#ede9fe',
    color: '#5b21b6',
    padding: '0.125rem 0.5rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 500,
  };
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
        <table style={tableStyle} data-testid="escalation-list">
          <thead>
            <tr>
              <th style={thStyle}>Placement</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id}>
                <td style={tdStyle} data-testid="escalation-placement">
                  {d.placement_id}
                </td>
                <td style={tdStyle}>{d.description}</td>
                <td style={tdStyle}>
                  <span data-testid="escalation-status" style={stateBadge(d.state)}>
                    {d.state}
                  </span>
                </td>
                <td style={tdStyle}>{new Date(d.created_at).toLocaleDateString('en-US')}</td>
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
            Manager — Cross-Team Split Escalation
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
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

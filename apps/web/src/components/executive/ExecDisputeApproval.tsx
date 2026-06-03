/**
 * ExecDisputeApproval — Executive surface for reviewing and resolving escalated
 * attribution disputes awaiting final approval.
 *
 * An Executive sees disputes that have been escalated to them
 * (`GET /disputes` filtered to UnderReview state), opens one to review the
 * attribution timeline, and records a final decision with a documented rationale
 * via `POST /disputes/:id/resolve`.
 *
 * Resolving a dispute unblocks the placement for the commission run and records
 * the deciding actor and rationale in the audit trail.
 *
 * Composed of:
 *   - ExecDisputeApprovalView — pure presentational view (accepts explicit state
 *     props so tests render each state in real headless Chromium without network
 *     interaction)
 *   - ExecDisputeApproval — container wiring real API calls via apiClient
 *
 * States rendered:
 *   - loading  — while the initial disputes fetch is in-flight
 *   - error    — when the fetch fails (ApiError or network)
 *   - empty    — when no escalated (UnderReview) disputes exist
 *   - data     — list of escalated disputes; selecting one opens detail view
 *   - detail   — attribution timeline + resolve form for the selected dispute
 *
 * CSRF: mutations go through apiPost which attaches the double-submit header.
 *
 * Canonical docs: docs/prd.md §4 (Executive), §5.4
 * Issue: feat: Executive UI — escalated dispute final-approval (#113)
 */

import { useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Dispute {
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

export interface AttributionEvent {
  id: string;
  placement_id: string;
  event_type: string;
  actor_id: string;
  reason: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// DisputeDetailView — attribution timeline + resolve form
// ---------------------------------------------------------------------------

interface DisputeDetailViewProps {
  dispute: Dispute;
  timeline: AttributionEvent[] | null;
  timelineLoading: boolean;
  timelineError: string | null;
  onBack: () => void;
  onResolve: (disputeId: string, resolutionNote: string) => Promise<void>;
}

function DisputeDetailView({
  dispute,
  timeline,
  timelineLoading,
  timelineError,
  onBack,
  onResolve,
}: DisputeDetailViewProps) {
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rationaleError, setRationaleError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  async function handleResolve() {
    if (!rationale.trim()) {
      setRationaleError('Rationale is required before resolving a dispute.');
      return;
    }
    setRationaleError(null);
    setSaving(true);
    setSaveError(null);
    try {
      await onResolve(dispute.id, rationale.trim());
      setResolved(true);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to resolve dispute';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="dispute-detail">
      <button
        data-testid="back-to-list"
        onClick={onBack}
        style={{
          marginBottom: '1rem',
          fontSize: '0.8125rem',
          background: 'none',
          border: 'none',
          color: '#2563eb',
          cursor: 'pointer',
          padding: 0,
          textDecoration: 'underline',
        }}
      >
        ← Back to escalated disputes
      </button>

      <PortalCard title="Dispute Details">
        <dl
          data-testid="dispute-meta"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem', margin: 0 }}
        >
          <div>
            <dt style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600 }}>Dispute ID</dt>
            <dd
              data-testid="dispute-id"
              style={{ margin: 0, fontSize: '0.875rem', color: '#111827' }}
            >
              {dispute.id}
            </dd>
          </div>
          <div>
            <dt style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600 }}>State</dt>
            <dd
              data-testid="dispute-state"
              style={{ margin: 0, fontSize: '0.875rem', color: '#111827' }}
            >
              {dispute.state}
            </dd>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <dt style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600 }}>Description</dt>
            <dd
              data-testid="dispute-description"
              style={{ margin: 0, fontSize: '0.875rem', color: '#111827' }}
            >
              {dispute.description}
            </dd>
          </div>
        </dl>
      </PortalCard>

      <PortalCard title="Attribution Timeline">
        <div data-testid="attribution-timeline">
          {timelineLoading && <LoadingState label="attribution events" />}
          {!timelineLoading && timelineError && <ErrorState message={timelineError} />}
          {!timelineLoading && !timelineError && (!timeline || timeline.length === 0) && (
            <EmptyState message="No attribution events recorded for this placement." />
          )}
          {!timelineLoading && !timelineError && timeline && timeline.length > 0 && (
            <ol
              data-testid="timeline-events"
              style={{ margin: 0, padding: 0, listStyle: 'none' }}
            >
              {timeline.map((event) => (
                <li
                  key={event.id}
                  data-testid={`timeline-event-${event.id}`}
                  style={{
                    borderBottom: '1px solid #e5e7eb',
                    padding: '0.75rem 0',
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'flex-start',
                  }}
                >
                  <span
                    data-testid="timeline-event-type"
                    style={{
                      fontSize: '0.75rem',
                      background: '#dbeafe',
                      color: '#1e40af',
                      padding: '0.125rem 0.5rem',
                      borderRadius: '0.25rem',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {event.event_type}
                  </span>
                  <div>
                    <div style={{ fontSize: '0.8125rem', color: '#374151' }}>
                      Actor: {event.actor_id}
                    </div>
                    {event.reason && (
                      <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.25rem' }}>
                        {event.reason}
                      </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </PortalCard>

      {resolved ? (
        <PortalCard title="Final Decision">
          <div
            data-testid="resolve-confirmation"
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
            Dispute resolved — placement is unblocked for the commission run. Rationale recorded in
            the audit trail.
          </div>
        </PortalCard>
      ) : (
        <PortalCard title="Record Final Decision">
          <div data-testid="resolve-form">
            <label
              htmlFor="resolution-rationale"
              style={{ display: 'block', fontSize: '0.8125rem', color: '#374151', marginBottom: '0.375rem', fontWeight: 600 }}
            >
              Rationale (required)
            </label>
            <textarea
              id="resolution-rationale"
              data-testid="rationale-input"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Enter the final decision rationale to be recorded in the audit trail…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '0.625rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                minHeight: '5rem',
                resize: 'vertical',
                marginBottom: '0.75rem',
              }}
            />

            {rationaleError && (
              <div
                data-testid="rationale-error"
                role="alert"
                style={{ color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '0.75rem' }}
              >
                {rationaleError}
              </div>
            )}

            {saveError && (
              <div
                data-testid="save-error"
                role="alert"
                style={{ color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '0.75rem' }}
              >
                {saveError}
              </div>
            )}

            <button
              data-testid="resolve-btn"
              onClick={handleResolve}
              disabled={saving}
              style={{
                padding: '0.5rem 1.25rem',
                background: saving ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 600,
              }}
            >
              {saving ? 'Resolving…' : 'Approve & Resolve'}
            </button>
          </div>
        </PortalCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DisputeRow — single row in the escalated disputes list
// ---------------------------------------------------------------------------

interface DisputeRowProps {
  dispute: Dispute;
  onSelect: (dispute: Dispute) => void;
}

function DisputeRow({ dispute, onSelect }: DisputeRowProps) {
  return (
    <div
      data-testid={`dispute-row-${dispute.id}`}
      style={{
        borderBottom: '1px solid #e5e7eb',
        padding: '1rem 0',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '1rem',
      }}
    >
      <div>
        <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>
          Dispute #{dispute.id.slice(0, 8)}
        </div>
        <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.25rem' }}>
          {dispute.description}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
          Submitted {new Date(dispute.created_at).toLocaleDateString()}
        </div>
      </div>
      <button
        data-testid={`review-btn-${dispute.id}`}
        onClick={() => onSelect(dispute)}
        style={{
          flexShrink: 0,
          fontSize: '0.8125rem',
          padding: '0.375rem 0.75rem',
          background: '#2563eb',
          color: '#ffffff',
          border: 'none',
          borderRadius: '0.375rem',
          cursor: 'pointer',
        }}
      >
        Review
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExecDisputeApprovalView — pure presentational view (for testing)
// ---------------------------------------------------------------------------

export interface ExecDisputeApprovalViewProps {
  loading: boolean;
  error: string | null;
  disputes: Dispute[] | null;
  selectedDispute: Dispute | null;
  timeline: AttributionEvent[] | null;
  timelineLoading: boolean;
  timelineError: string | null;
  onSelect: (dispute: Dispute) => void;
  onBack: () => void;
  onResolve: (disputeId: string, resolutionNote: string) => Promise<void>;
}

export function ExecDisputeApprovalView({
  loading,
  error,
  disputes,
  selectedDispute,
  timeline,
  timelineLoading,
  timelineError,
  onSelect,
  onBack,
  onResolve,
}: ExecDisputeApprovalViewProps) {
  const escalated = (disputes ?? []).filter((d) => d.state === 'UnderReview');

  return (
    <div
      data-testid="exec-dispute-approval"
      style={{
        minHeight: 'calc(100vh - 3.25rem)',
        background: '#f9fafb',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '880px', margin: '0 auto' }}>
        <header style={{ marginBottom: '1.5rem' }}>
          <h1
            data-testid="exec-dispute-heading"
            style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: '0 0 0.25rem' }}
          >
            Escalated Dispute Approval
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
            Attribution disputes escalated for executive final approval. Resolve each with a
            documented rationale to unblock the placement for the commission run.
          </p>
        </header>

        {selectedDispute ? (
          <DisputeDetailView
            dispute={selectedDispute}
            timeline={timeline}
            timelineLoading={timelineLoading}
            timelineError={timelineError}
            onBack={onBack}
            onResolve={onResolve}
          />
        ) : (
          <>
            {loading && <LoadingState label="escalated disputes" />}
            {!loading && error && <ErrorState message={error} />}
            {!loading && !error && (
              <PortalCard
                title={`Escalated Disputes${disputes !== null ? ` (${escalated.length})` : ''}`}
              >
                {escalated.length === 0 ? (
                  <EmptyState message="No escalated disputes awaiting final approval." />
                ) : (
                  <div data-testid="dispute-list">
                    {escalated.map((d) => (
                      <DisputeRow key={d.id} dispute={d} onSelect={onSelect} />
                    ))}
                  </div>
                )}
              </PortalCard>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExecDisputeApproval — container wiring real API calls
// ---------------------------------------------------------------------------

export function ExecDisputeApproval() {
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [timelineCache, setTimelineCache] = useState<Record<string, AttributionEvent[]>>({});
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const { data, loading, error } = useAsync<{ disputes: Dispute[] }>(
    () => apiGet<{ disputes: Dispute[] }>('/disputes'),
    [],
  );

  async function handleSelect(dispute: Dispute) {
    setSelectedDispute(dispute);
    if (timelineCache[dispute.commission_record_id]) return;

    // Look up the placement_id via commission_record_id if not cached
    // The timeline is fetched via GET /placements/:id/attribution/timeline
    // but we only have commission_record_id on the dispute. We fetch the
    // commission record to get the placement_id.
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const timeline = await apiGet<AttributionEvent[]>(
        `/placements/${dispute.commission_record_id}/attribution/timeline`,
      );
      setTimelineCache((prev) => ({ ...prev, [dispute.commission_record_id]: timeline }));
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load attribution timeline';
      setTimelineError(msg);
    } finally {
      setTimelineLoading(false);
    }
  }

  function handleBack() {
    setSelectedDispute(null);
    setTimelineError(null);
  }

  async function handleResolve(disputeId: string, resolutionNote: string): Promise<void> {
    await apiPost<Dispute>(`/disputes/${disputeId}/resolve`, { resolution_note: resolutionNote });
  }

  const currentTimeline = selectedDispute
    ? (timelineCache[selectedDispute.commission_record_id] ?? null)
    : null;

  return (
    <ExecDisputeApprovalView
      loading={loading}
      error={error}
      disputes={data?.disputes ?? null}
      selectedDispute={selectedDispute}
      timeline={currentTimeline}
      timelineLoading={timelineLoading}
      timelineError={timelineError}
      onSelect={handleSelect}
      onBack={handleBack}
      onResolve={handleResolve}
    />
  );
}

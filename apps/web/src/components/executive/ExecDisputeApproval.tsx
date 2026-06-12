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
import { Button } from 'ui';
import type { AppRole } from 'core/auth';
import { ApiError, apiGet, apiPost } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';

/**
 * Roles permitted to invoke AI arbitration. Per PRD §5.4 attribution disputes
 * escalate Manager → Practice Lead → Executive, with the Executive as final
 * approver; Finance Admin does not adjudicate attribution disputes. Producers
 * never see arbitration. So the "Run Arbitration" button is gated to Manager
 * and Executive only.
 */
const ARBITRATION_ROLES: ReadonlySet<AppRole> = new Set<AppRole>(['Manager', 'Executive']);

export function canRunArbitration(role: AppRole | undefined): boolean {
  return role !== undefined && ARBITRATION_ROLES.has(role);
}

/**
 * Structured AI arbitration recommendation returned by POST /disputes/:id/arbitrate.
 * Mirrors ArbitrationResultBody on the server (apps/server/src/api/dispute-arbitration.ts).
 */
export interface ArbitrationRecommendation {
  /** Stable reference recorded in the audit trail on Accept (recommendation id). */
  id?: string;
  recommendation: string;
  reasoning: string;
  edge_cases: string[];
  payout_adjustment: number;
}

type ArbitrationStatus = 'idle' | 'arbitrating' | 'done' | 'rejected';

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
  /** Viewer role — gates the AI arbitration affordance (Manager/Executive). */
  role?: AppRole;
  onBack: () => void;
  /**
   * Resolve the dispute. `recommendationRef` carries the AI recommendation id
   * into the audit trail when the resolution accepts an arbitration result.
   */
  onResolve: (
    disputeId: string,
    resolutionNote: string,
    recommendationRef?: string,
  ) => Promise<void>;
  /** Invoke AI arbitration. Provided so tests can drive without the network. */
  onArbitrate: (disputeId: string) => Promise<ArbitrationRecommendation>;
}

function DisputeDetailView({
  dispute,
  timeline,
  timelineLoading,
  timelineError,
  role,
  onBack,
  onResolve,
  onArbitrate,
}: DisputeDetailViewProps) {
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rationaleError, setRationaleError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  // Arbitration state machine: idle → arbitrating → done | rejected.
  const [arbStatus, setArbStatus] = useState<ArbitrationStatus>('idle');
  const [arbError, setArbError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<ArbitrationRecommendation | null>(null);

  const showArbitration = canRunArbitration(role);

  async function handleArbitrate() {
    setArbStatus('arbitrating');
    setArbError(null);
    try {
      const rec = await onArbitrate(dispute.id);
      setRecommendation(rec);
      setArbStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to run arbitration';
      setArbError(msg);
      setArbStatus('idle');
    }
  }

  async function handleResolve(recommendationRef?: string) {
    if (!rationale.trim()) {
      setRationaleError('Rationale is required before resolving a dispute.');
      return;
    }
    setRationaleError(null);
    setSaving(true);
    setSaveError(null);
    try {
      await onResolve(dispute.id, rationale.trim(), recommendationRef);
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
        className="mb-4 text-sm bg-transparent border-none text-accent cursor-pointer p-0 underline"
      >
        ← Back to escalated disputes
      </button>

      <PortalCard title="Dispute Details">
        <dl data-testid="dispute-meta" className="grid grid-cols-2 gap-x-4 gap-y-2 m-0">
          <div>
            <dt className="text-xs text-ink-subtle font-semibold">Dispute ID</dt>
            <dd data-testid="dispute-id" className="m-0 text-sm text-ink">
              {dispute.id}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle font-semibold">State</dt>
            <dd data-testid="dispute-state" className="m-0 text-sm text-ink">
              {dispute.state}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-ink-subtle font-semibold">Description</dt>
            <dd data-testid="dispute-description" className="m-0 text-sm text-ink">
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
            <ol data-testid="timeline-events" className="m-0 p-0 list-none">
              {timeline.map((event) => (
                <li
                  key={event.id}
                  data-testid={`timeline-event-${event.id}`}
                  className="border-b border-border py-3 flex gap-4 items-start"
                >
                  <span
                    data-testid="timeline-event-type"
                    className="text-xs bg-surface-sunken text-ink-muted px-2 py-0.5 rounded-xs font-semibold shrink-0"
                  >
                    {event.event_type}
                  </span>
                  <div>
                    <div className="text-sm text-ink-muted">Actor: {event.actor_id}</div>
                    {event.reason && (
                      <div className="text-sm text-ink-subtle mt-1">{event.reason}</div>
                    )}
                    <div className="text-xs text-ink-faint mt-1">
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </PortalCard>

      {showArbitration && !resolved && (
        <PortalCard title="AI Arbitration">
          <div data-testid="arbitration-section">
            {arbStatus === 'idle' && (
              <>
                <p className="text-sm text-ink-subtle mt-0 mb-3">
                  Request an AI recommendation for this escalated dispute. The output is advisory
                  only — the final resolution is always a documented human decision recorded below.
                </p>
                <Button data-testid="run-arbitration-btn" onClick={handleArbitrate}>
                  Run Arbitration
                </Button>
                {arbError && (
                  <div className="mt-3">
                    <ErrorState message={arbError} />
                  </div>
                )}
              </>
            )}

            {arbStatus === 'arbitrating' && <LoadingState label="AI arbitration recommendation" />}

            {arbStatus === 'rejected' && (
              <div
                data-testid="arbitration-rejected"
                role="status"
                className="text-sm text-ink-subtle"
              >
                Recommendation rejected. Resolve the dispute with your own rationale below.
              </div>
            )}

            {arbStatus === 'done' && recommendation && (
              <div
                data-testid="arbitration-recommendation"
                className="p-5 bg-surface-sunken border border-border rounded-md"
              >
                <div className="mb-3">
                  <div className="text-xs text-ink-subtle font-semibold">Recommendation</div>
                  <div
                    data-testid="arbitration-summary"
                    className="text-base font-semibold text-ink"
                  >
                    {recommendation.recommendation}
                  </div>
                </div>

                <div className="mb-3">
                  <div className="text-xs text-ink-subtle font-semibold">Reasoning</div>
                  <p
                    data-testid="arbitration-reasoning"
                    className="text-sm text-ink-muted mt-1 mb-0"
                  >
                    {recommendation.reasoning}
                  </p>
                </div>

                <div className="mb-3">
                  <div className="text-xs text-ink-subtle font-semibold">Payout adjustment</div>
                  <div data-testid="arbitration-payout-adjustment" className="text-base text-ink">
                    {recommendation.payout_adjustment}
                  </div>
                </div>

                {recommendation.edge_cases.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-ink-subtle font-semibold">Edge cases</div>
                    <ul data-testid="arbitration-edge-cases" className="mt-1 mb-0 pl-5">
                      {recommendation.edge_cases.map((ec, i) => (
                        <li key={i} className="text-sm text-ink-muted">
                          {ec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-xs text-ink-subtle my-3">
                  This is a recommendation only. Accepting requires a rationale and records the AI
                  recommendation reference, you as the deciding actor, and your rationale in the
                  audit trail. Enter your rationale below, then Accept or Reject.
                </p>

                <div className="flex gap-3">
                  <Button
                    data-testid="arbitration-accept-btn"
                    onClick={() => handleResolve(recommendation.id ?? 'ai-recommendation')}
                    disabled={saving}
                  >
                    {saving ? 'Resolving…' : 'Accept'}
                  </Button>
                  <Button
                    variant="destructive"
                    data-testid="arbitration-reject-btn"
                    onClick={() => {
                      setArbStatus('rejected');
                      setRecommendation(null);
                    }}
                    disabled={saving}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        </PortalCard>
      )}

      {resolved ? (
        <PortalCard title="Final Decision">
          <div
            data-testid="resolve-confirmation"
            role="status"
            className="p-5 bg-ok-bg border border-ok-fg/30 rounded-md text-ok-fg text-sm"
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
              className="block text-sm text-ink-muted mb-1.5 font-semibold"
            >
              Rationale (required)
            </label>
            <textarea
              id="resolution-rationale"
              data-testid="rationale-input"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Enter the final decision rationale to be recorded in the audit trail…"
              className="w-full box-border px-3 py-2.5 border border-border-strong rounded-md text-sm min-h-20 resize-y mb-3"
            />

            {rationaleError && (
              <div data-testid="rationale-error" role="alert" className="text-bad-fg text-sm mb-3">
                {rationaleError}
              </div>
            )}

            {saveError && (
              <div data-testid="save-error" role="alert" className="text-bad-fg text-sm mb-3">
                {saveError}
              </div>
            )}

            <Button data-testid="resolve-btn" onClick={() => handleResolve()} disabled={saving}>
              {saving ? 'Resolving…' : 'Approve & Resolve'}
            </Button>
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
      className="border-b border-border py-4 flex items-start justify-between gap-4"
    >
      <div>
        <div className="font-semibold text-ink text-base">Dispute #{dispute.id.slice(0, 8)}</div>
        <div className="text-sm text-ink-subtle mt-1">{dispute.description}</div>
        <div className="text-xs text-ink-faint mt-1">
          Submitted {new Date(dispute.created_at).toLocaleDateString()}
        </div>
      </div>
      <button
        data-testid={`review-btn-${dispute.id}`}
        onClick={() => onSelect(dispute)}
        className="shrink-0 text-sm px-3 py-1.5 rounded-md bg-ink text-white cursor-pointer"
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
  /** Viewer role — gates AI arbitration to Manager/Executive. */
  role?: AppRole;
  onSelect: (dispute: Dispute) => void;
  onBack: () => void;
  onResolve: (
    disputeId: string,
    resolutionNote: string,
    recommendationRef?: string,
  ) => Promise<void>;
  onArbitrate: (disputeId: string) => Promise<ArbitrationRecommendation>;
}

export function ExecDisputeApprovalView({
  loading,
  error,
  disputes,
  selectedDispute,
  timeline,
  timelineLoading,
  timelineError,
  role,
  onSelect,
  onBack,
  onResolve,
  onArbitrate,
}: ExecDisputeApprovalViewProps) {
  const escalated = (disputes ?? []).filter((d) => d.state === 'UnderReview');

  return (
    <div data-testid="exec-dispute-approval" className="min-h-surface bg-surface-muted px-4 py-8">
      <div className="max-w-narrow mx-auto">
        <header className="mb-6">
          <h1 data-testid="exec-dispute-heading" className="text-2xl font-bold text-ink mt-0 mb-1">
            Escalated Dispute Approval
          </h1>
          <p className="text-sm text-ink-subtle m-0">
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
            role={role}
            onBack={onBack}
            onResolve={onResolve}
            onArbitrate={onArbitrate}
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

export function ExecDisputeApproval({ role }: { role?: AppRole } = {}) {
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

  async function handleResolve(
    disputeId: string,
    resolutionNote: string,
    recommendationRef?: string,
  ): Promise<void> {
    // When the resolution accepts an AI recommendation, record its reference so
    // the server persists it (alongside the deciding actor and rationale) in the
    // audit trail (PRD §5.4, §9). The deciding actor is the authenticated
    // session on the server side — never trusted from the client.
    await apiPost<Dispute>(`/disputes/${disputeId}/resolve`, {
      resolution_note: resolutionNote,
      ...(recommendationRef ? { arbitration_recommendation_id: recommendationRef } : {}),
    });
  }

  async function handleArbitrate(disputeId: string): Promise<ArbitrationRecommendation> {
    return apiPost<ArbitrationRecommendation>(`/disputes/${disputeId}/arbitrate`, {});
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
      role={role}
      onSelect={handleSelect}
      onBack={handleBack}
      onResolve={handleResolve}
      onArbitrate={handleArbitrate}
    />
  );
}

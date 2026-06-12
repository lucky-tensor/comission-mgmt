/**
 * AttributionTimeline — Manager surface for viewing the ordered history of
 * attribution events for any team deal. Used to resolve ownership disputes
 * with evidence.
 *
 * Composed of:
 *   - AttributionTimelineView  — pure presentational view; accepts explicit
 *     state props so tests render each state in headless Chromium without
 *     any network traffic.
 *   - AttributionTimeline      — container wiring real API calls via apiClient.
 *
 * API endpoints used:
 *   GET   /placements/:id/attribution/timeline — ordered attribution event history
 *
 * States rendered:
 *   - idle     — no placement selected (initial)
 *   - loading  — timeline fetch in-flight
 *   - error    — fetch failure
 *   - empty    — placement has no attribution events yet
 *   - timeline — ordered event list (oldest first)
 *
 * Canonical docs: docs/prd.md §4 (Manager), §5.2
 * Issue: feat: Manager UI — split approval and attribution timeline (#107)
 */

import { useState } from 'react';
import { apiGet } from '../../lib/apiClient';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../portal/states';
import { EntityPicker } from '../EntityPicker';
import { formatDate } from '../../lib/format';

/** Minimal placement row used to populate the picker. */
export interface PlacementOption {
  id: string;
  job_title?: string | null;
  position_title?: string | null;
  candidate_name?: string | null;
  client_name?: string | null;
}

function placementOptionLabel(p: PlacementOption): string {
  const title = p.position_title ?? p.job_title ?? null;
  const parts: string[] = [];
  if (title) parts.push(title);
  if (p.candidate_name) parts.push(p.candidate_name);
  if (p.client_name) parts.push(`@ ${p.client_name}`);
  return parts.length > 0 ? parts.join(' — ') : p.id;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttributionEvent {
  id: string;
  placement_id: string;
  event_type: string;
  actor_id: string;
  reason: string | null;
  created_at: string;
}

export interface AttributionTimelineResponse {
  events?: AttributionEvent[];
}

// ---------------------------------------------------------------------------
// View-layer phase types
// ---------------------------------------------------------------------------

export type AttributionTimelinePhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'timeline'; events: AttributionEvent[] };

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const CARD_CLASS = 'bg-surface border border-border rounded-md p-6 mb-6';

const HEADING_CLASS = 'text-lg font-semibold text-ink mt-0 mb-4';

const EVENT_TYPE_LABELS: Record<string, string> = {
  Submitted: 'Submitted for approval',
  Approved: 'Approved',
  Rejected: 'Rejected',
};

/**
 * Per-event-type color classes (background + text + border tokens). The former
 * blue "Submitted" tint is neutralized to surface-sunken per the design system;
 * Approved maps to the ok (green) tokens and Rejected to the bad (red) tokens.
 */
const EVENT_TYPE_COLORS: Record<string, string> = {
  Submitted: 'bg-surface-sunken text-ink-muted border border-border',
  Approved: 'bg-ok-bg text-ok-fg border border-ok-fg/30',
  Rejected: 'bg-bad-bg text-bad-fg border border-bad-fg/30',
};

const DEFAULT_EVENT_COLOR = 'bg-surface-muted text-ink-muted border border-border';

// ---------------------------------------------------------------------------
// AttributionTimelineView — pure presentational view
// ---------------------------------------------------------------------------

export interface AttributionTimelineViewProps {
  /** Currently selected placement id (or null/empty). */
  placementId: string;
  /** Async list of placements to populate the picker. */
  placements: AsyncState<PlacementOption[]>;
  phase: AttributionTimelinePhase;
  /** Called with the selected placement id when a placement is picked. */
  onSearch: (placementId: string) => void;
}

export function AttributionTimelineView({
  placementId,
  placements,
  phase,
  onSearch,
}: AttributionTimelineViewProps) {
  return (
    <div data-testid="attribution-timeline" className={CARD_CLASS}>
      <h2 className={HEADING_CLASS}>Attribution Timeline</h2>

      {/* Placement picker — select a deal by client/candidate/role, not a UUID. */}
      <div data-testid="timeline-search-form" className="mb-5">
        <EntityPicker
          name="placement"
          label="Placement"
          state={placements}
          value={placementId || null}
          onChange={(id) => onSearch(id)}
          toOption={(p) => ({ id: p.id, label: placementOptionLabel(p) })}
          placeholder="Select a placement…"
          emptyMessage="No placements available to inspect."
        />
      </div>

      {phase.kind === 'idle' && (
        <div data-testid="timeline-idle" className="text-sm text-ink-faint py-2">
          Enter a placement ID to view its attribution history.
        </div>
      )}
      {phase.kind === 'loading' && <LoadingState label="attribution timeline" />}
      {phase.kind === 'error' && <ErrorState message={phase.message} />}
      {phase.kind === 'empty' && (
        <EmptyState message="No attribution events recorded for this placement." />
      )}
      {phase.kind === 'timeline' && (
        <ol data-testid="timeline-events" className="m-0 p-0 list-none">
          {phase.events.map((event, idx) => {
            const colorClass = EVENT_TYPE_COLORS[event.event_type] ?? DEFAULT_EVENT_COLOR;
            const isLast = idx >= phase.events.length - 1;
            return (
              <li
                key={event.id}
                data-testid={`timeline-event-${event.id}`}
                className={`flex gap-3.5 relative ${isLast ? 'pb-0' : 'pb-5'}`}
              >
                {/* Connector line */}
                {!isLast && (
                  <div
                    aria-hidden="true"
                    className="absolute left-3 top-6 bottom-0 w-0.5 bg-border"
                  />
                )}
                {/* Dot */}
                <div
                  aria-hidden="true"
                  className={`w-6 h-6 rounded-full shrink-0 mt-0.5 ${colorClass}`}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      data-testid={`event-type-${event.id}`}
                      className={`text-sm font-semibold px-2 py-0.5 rounded-xs ${colorClass}`}
                    >
                      {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
                    </span>
                    <span data-testid={`event-date-${event.id}`} className="text-xs text-ink-faint">
                      {formatDate(event.created_at)}
                    </span>
                  </div>
                  <div className="text-sm text-ink-subtle mt-1">by {event.actor_id}</div>
                  {event.reason && (
                    <div
                      data-testid={`event-reason-${event.id}`}
                      className="text-sm text-ink-muted mt-1 italic"
                    >
                      &ldquo;{event.reason}&rdquo;
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttributionTimeline — container
// ---------------------------------------------------------------------------

export function AttributionTimeline() {
  const [searchId, setSearchId] = useState<string | null>(null);
  const [events, setEvents] = useState<AttributionEvent[] | null>(null);

  // Source the picker from the manager's team placements (the deals a manager
  // can actually inspect), not the org-wide /placements list.
  const placements = useAsync<PlacementOption[]>(
    () =>
      apiGet<{ placements: PlacementOption[] }>('/me/team/placements').then((r) => r.placements),
    [],
  );

  const { loading, error } = useAsync(async () => {
    if (!searchId) return;
    const data = await apiGet<AttributionEvent[]>(`/placements/${searchId}/attribution/timeline`);
    setEvents(Array.isArray(data) ? data : []);
  }, [searchId]);

  function phase(): AttributionTimelinePhase {
    if (!searchId) return { kind: 'idle' };
    if (loading) return { kind: 'loading' };
    if (error) return { kind: 'error', message: error };
    if (!events || events.length === 0) return { kind: 'empty' };
    return { kind: 'timeline', events };
  }

  function handleSearch(id: string) {
    setEvents(null);
    setSearchId(id);
  }

  return (
    <AttributionTimelineView
      placementId={searchId ?? ''}
      placements={placements}
      phase={phase()}
      onSearch={handleSearch}
    />
  );
}

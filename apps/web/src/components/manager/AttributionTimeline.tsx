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

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '0.75rem',
  padding: '1.5rem',
  marginBottom: '1.5rem',
};

const headingStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  color: '#111827',
  marginTop: 0,
  marginBottom: '1rem',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  Submitted: 'Submitted for approval',
  Approved: 'Approved',
  Rejected: 'Rejected',
};

const EVENT_TYPE_COLORS: Record<string, React.CSSProperties> = {
  Submitted: { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  Approved: { background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' },
  Rejected: { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
};

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
    <div data-testid="attribution-timeline" style={cardStyle}>
      <h2 style={headingStyle}>Attribution Timeline</h2>

      {/* Placement picker — select a deal by client/candidate/role, not a UUID. */}
      <div data-testid="timeline-search-form" style={{ marginBottom: '1.25rem' }}>
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
        <div
          data-testid="timeline-idle"
          style={{ fontSize: '0.875rem', color: '#9ca3af', padding: '0.5rem 0' }}
        >
          Enter a placement ID to view its attribution history.
        </div>
      )}
      {phase.kind === 'loading' && <LoadingState label="attribution timeline" />}
      {phase.kind === 'error' && <ErrorState message={phase.message} />}
      {phase.kind === 'empty' && (
        <EmptyState message="No attribution events recorded for this placement." />
      )}
      {phase.kind === 'timeline' && (
        <ol data-testid="timeline-events" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {phase.events.map((event, idx) => {
            const colorStyle = EVENT_TYPE_COLORS[event.event_type] ?? {
              background: '#f9fafb',
              color: '#374151',
              border: '1px solid #e5e7eb',
            };
            return (
              <li
                key={event.id}
                data-testid={`timeline-event-${event.id}`}
                style={{
                  display: 'flex',
                  gap: '0.875rem',
                  paddingBottom: idx < phase.events.length - 1 ? '1.25rem' : 0,
                  position: 'relative',
                }}
              >
                {/* Connector line */}
                {idx < phase.events.length - 1 && (
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: '0.6875rem',
                      top: '1.5rem',
                      bottom: 0,
                      width: '2px',
                      background: '#e5e7eb',
                    }}
                  />
                )}
                {/* Dot */}
                <div
                  aria-hidden="true"
                  style={{
                    width: '1.375rem',
                    height: '1.375rem',
                    borderRadius: '50%',
                    background: colorStyle.background as string,
                    border: colorStyle.border as string,
                    flexShrink: 0,
                    marginTop: '0.125rem',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      data-testid={`event-type-${event.id}`}
                      style={{
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        ...colorStyle,
                        padding: '0.125rem 0.5rem',
                        borderRadius: '9999px',
                      }}
                    >
                      {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
                    </span>
                    <span
                      data-testid={`event-date-${event.id}`}
                      style={{ fontSize: '0.75rem', color: '#9ca3af' }}
                    >
                      {formatDate(event.created_at)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '0.8125rem',
                      color: '#6b7280',
                      marginTop: '0.25rem',
                    }}
                  >
                    by {event.actor_id}
                  </div>
                  {event.reason && (
                    <div
                      data-testid={`event-reason-${event.id}`}
                      style={{
                        fontSize: '0.8125rem',
                        color: '#374151',
                        marginTop: '0.25rem',
                        fontStyle: 'italic',
                      }}
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

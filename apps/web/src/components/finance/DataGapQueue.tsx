/**
 * DataGapQueue — Finance Admin surface for reviewing and resolving placement
 * data gaps before running commissions.
 *
 * Fetches `GET /placements/incomplete` and renders each incomplete placement
 * with its missing-field list. An inline edit form lets the Finance Admin fill
 * in the missing fields via `PATCH /placements/:id`; on success the row is
 * optimistically removed from the queue.
 *
 * States rendered:
 *   - loading  — while the initial fetch is in-flight
 *   - error    — when the fetch fails (ApiError or network)
 *   - empty    — when zero incomplete placements exist (queue is clear)
 *   - data     — one row per incomplete placement with inline resolve form
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §9 (Data Completeness Gating)
 * Issue: feat: Finance Admin UI — data-gap / completeness review queue (#101)
 */

import { useState } from 'react';
import { ApiError, apiGet, apiPatch } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IncompletePlacement {
  id: string;
  org_id: string;
  candidate_id: string | null;
  client_entity_id: string | null;
  job_title: string | null;
  compensation_base: string | null;
  fee_amount: string | null;
  status: string;
  start_date: string | null;
  guarantee_days: number | null;
  is_confidential: boolean;
  created_at: string;
  updated_at: string;
  missing_fields: string[];
}

// ---------------------------------------------------------------------------
// Resolve row — inline form for filling missing fields
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  start_date: 'Start Date',
  fee_amount: 'Fee Amount',
  compensation_base: 'Compensation Base',
  contributors: 'Contributors (add via CSV import)',
};

interface ResolveRowProps {
  placement: IncompletePlacement;
  onResolved: (id: string) => void;
}

function ResolveRow({ placement, onResolved }: ResolveRowProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Only fields editable via PATCH /placements/:id (not "contributors")
  const editableFields = placement.missing_fields.filter((f) => f !== 'contributors');
  const hasEditableFields = editableFields.length > 0;

  async function handleResolve() {
    if (!hasEditableFields) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiPatch(`/placements/${placement.id}`, values);
      onResolved(placement.id);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Save failed';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-testid={`gap-row-${placement.id}`}
      style={{
        borderBottom: '1px solid #e5e7eb',
        padding: '1rem 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>
            {placement.job_title ?? 'Untitled placement'}
            {placement.is_confidential && (
              <span
                data-testid="confidential-badge"
                style={{
                  marginLeft: '0.5rem',
                  fontSize: '0.75rem',
                  background: '#fef3c7',
                  color: '#92400e',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '9999px',
                }}
              >
                Confidential
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.25rem' }}>
            ID: {placement.id}
          </div>
          <div
            data-testid={`missing-fields-${placement.id}`}
            style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}
          >
            {placement.missing_fields.map((f) => (
              <span
                key={f}
                data-testid={`missing-field-tag-${f}`}
                style={{
                  fontSize: '0.75rem',
                  background: '#fee2e2',
                  color: '#991b1b',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '0.25rem',
                  border: '1px solid #fca5a5',
                }}
              >
                {FIELD_LABELS[f] ?? f}
              </span>
            ))}
          </div>
        </div>

        {hasEditableFields && (
          <button
            data-testid={`resolve-btn-${placement.id}`}
            onClick={() => setOpen((o) => !o)}
            style={{
              flexShrink: 0,
              fontSize: '0.8125rem',
              padding: '0.375rem 0.75rem',
              background: open ? '#f3f4f6' : '#2563eb',
              color: open ? '#374151' : '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
            }}
          >
            {open ? 'Cancel' : 'Resolve'}
          </button>
        )}
      </div>

      {open && hasEditableFields && (
        <div
          data-testid={`resolve-form-${placement.id}`}
          style={{
            marginTop: '0.75rem',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
            padding: '1rem',
          }}
        >
          {editableFields.map((field) => (
            <div key={field} style={{ marginBottom: '0.75rem' }}>
              <label
                htmlFor={`field-${placement.id}-${field}`}
                style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' }}
              >
                {FIELD_LABELS[field] ?? field}
              </label>
              <input
                id={`field-${placement.id}-${field}`}
                data-testid={`input-${placement.id}-${field}`}
                type={field === 'start_date' ? 'date' : 'text'}
                value={values[field] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '0.375rem 0.625rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                }}
              />
            </div>
          ))}

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
            data-testid={`save-btn-${placement.id}`}
            onClick={handleResolve}
            disabled={saving}
            style={{
              padding: '0.4375rem 1rem',
              background: saving ? '#93c5fd' : '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataGapQueue — main component
// ---------------------------------------------------------------------------

export function DataGapQueue() {
  const queueState = useAsync<IncompletePlacement[]>(
    () => apiGet<IncompletePlacement[]>('/placements/incomplete'),
    [],
  );

  // Local list for optimistic removal on successful resolve
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  function handleResolved(id: string) {
    setResolved((prev) => new Set([...prev, id]));
  }

  const visiblePlacements = (queueState.data ?? []).filter((p) => !resolved.has(p.id));

  return (
    <div
      data-testid="data-gap-queue"
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
            data-testid="data-gap-queue-heading"
            style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: '0 0 0.25rem' }}
          >
            Data Gap Queue
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
            Placements missing required fields for commission processing. Resolve all gaps before
            starting a commission run.
          </p>
        </header>

        {queueState.loading && <LoadingState label="incomplete placements" />}
        {!queueState.loading && queueState.error && <ErrorState message={queueState.error} />}
        {!queueState.loading && !queueState.error && (
          <PortalCard
            title={`Incomplete Placements${queueState.data ? ` (${visiblePlacements.length})` : ''}`}
          >
            {visiblePlacements.length === 0 ? (
              <EmptyState message="No incomplete placements — queue is clear. You may proceed with a commission run." />
            ) : (
              <div data-testid="gap-queue-list">
                {visiblePlacements.map((p) => (
                  <ResolveRow key={p.id} placement={p} onResolved={handleResolved} />
                ))}
              </div>
            )}
          </PortalCard>
        )}
      </div>
    </div>
  );
}

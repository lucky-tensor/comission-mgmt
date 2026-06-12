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
import { Button } from 'ui';
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
    <div data-testid={`gap-row-${placement.id}`} className="border-b border-border py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-ink text-base">
            {placement.job_title ?? 'Untitled placement'}
            {placement.is_confidential && (
              <span
                data-testid="confidential-badge"
                className="ml-2 text-xs bg-warn-bg text-warn-fg px-2 py-0.5 rounded-full"
              >
                Confidential
              </span>
            )}
          </div>
          <div className="text-sm text-ink-subtle mt-1">ID: {placement.id}</div>
          <div
            data-testid={`missing-fields-${placement.id}`}
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {placement.missing_fields.map((f) => (
              <span
                key={f}
                data-testid={`missing-field-tag-${f}`}
                className="text-xs bg-bad-bg text-bad-fg px-2 py-0.5 rounded border border-bad-fg/30"
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
            className={[
              'shrink-0 text-sm px-3 py-1.5 rounded-md border-none cursor-pointer',
              open ? 'bg-surface-sunken text-ink-muted' : 'bg-ink text-white',
            ].join(' ')}
          >
            {open ? 'Cancel' : 'Resolve'}
          </button>
        )}
      </div>

      {open && hasEditableFields && (
        <div
          data-testid={`resolve-form-${placement.id}`}
          className="mt-3 bg-surface-muted border border-border rounded-lg p-4"
        >
          {editableFields.map((field) => (
            <div key={field} className="mb-3">
              <label
                htmlFor={`field-${placement.id}-${field}`}
                className="block text-sm font-semibold text-ink-muted mb-1"
              >
                {FIELD_LABELS[field] ?? field}
              </label>
              <input
                id={`field-${placement.id}-${field}`}
                data-testid={`input-${placement.id}-${field}`}
                type={field === 'start_date' ? 'date' : 'text'}
                value={values[field] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                className="w-full box-border px-2.5 py-1.5 border border-border-strong rounded-md text-sm"
              />
            </div>
          ))}

          {saveError && (
            <div data-testid="save-error" role="alert" className="text-bad-fg text-sm mb-3">
              {saveError}
            </div>
          )}

          <Button
            data-testid={`save-btn-${placement.id}`}
            onClick={handleResolve}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
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
    <div data-testid="data-gap-queue" className="min-h-surface bg-surface-muted px-4 py-8">
      <div className="max-w-narrow mx-auto">
        <header className="mb-6">
          <h1 data-testid="data-gap-queue-heading" className="text-2xl font-bold text-ink m-0 mb-1">
            Data Gap Queue
          </h1>
          <p className="text-sm text-ink-subtle m-0">
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

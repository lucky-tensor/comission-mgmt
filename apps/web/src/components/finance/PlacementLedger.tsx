/**
 * PlacementLedger — Finance Admin surface for case management.
 *
 * Surfaces the full placement ledger with three interactive regions:
 *
 *   1. New Case form      — POST /placements — creates a placement record
 *   2. Cases table        — GET /placements — read-write table with inline editing
 *                           PATCH /placements/:id — saves edits per row
 *   3. Contributor panel  — per-row expansion showing assigned producers
 *                           GET    /placements/:id/contributors
 *                           POST   /placements/:id/contributors
 *                           DELETE /placements/:id/contributors/:cid
 *
 * Each placement row can be expanded to reveal its contributor list and an
 * add-contributor form.  Inline row editing lets Finance Admins update any
 * mutable field without leaving the table.
 *
 * Canonical docs: docs/prd.md §5.1 (Placement Ledger Creation), §5.2 (Contribution Assignment)
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from 'ui';
import { ApiError, apiGet, apiPost, apiPatch, apiDelete } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../portal/states';
import { CONTRIBUTOR_ROLES, CONTRIBUTOR_ROLE_LABELS } from 'core/contributor-role';
import type { ContributorRole } from 'core/contributor-role';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Placement {
  id: string;
  org_id: string;
  candidate_id: string;
  client_entity_id: string;
  job_title: string;
  compensation_base: string;
  fee_amount: string;
  status: string;
  start_date: string | null;
  guarantee_days: number | null;
  guarantee_expiry_date: string | null;
  is_confidential: boolean;
  created_at: string;
  updated_at: string;
}

export interface Contributor {
  id: string;
  org_id: string;
  placement_id: string;
  producer_id: string;
  role: ContributorRole;
  split_pct: number;
  split_override: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// New placement form
// ---------------------------------------------------------------------------

interface NewPlacementFormProps {
  onCreated: (placement: Placement) => void;
}

function NewPlacementForm({ onCreated }: NewPlacementFormProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState({
    job_title: '',
    candidate_id: '',
    client_entity_id: '',
    compensation_base: '',
    fee_amount: '',
    start_date: '',
    guarantee_days: '',
  });

  function set(key: keyof typeof fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string | number | undefined> = {
        job_title: fields.job_title,
        candidate_id: fields.candidate_id,
        client_entity_id: fields.client_entity_id,
        compensation_base: fields.compensation_base,
        fee_amount: fields.fee_amount || undefined,
        start_date: fields.start_date || undefined,
        guarantee_days: fields.guarantee_days ? Number(fields.guarantee_days) : undefined,
      };
      const created = await apiPost<Placement>('/placements', body);
      setFields({
        job_title: '',
        candidate_id: '',
        client_entity_id: '',
        compensation_base: '',
        fee_amount: '',
        start_date: '',
        guarantee_days: '',
      });
      setOpen(false);
      onCreated(created);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to create placement');
      }
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full border border-border-strong rounded-sm px-2 py-1 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-accent';
  const labelClass = 'block text-xs text-ink-subtle mb-0.5';

  return (
    <div className="mb-6" data-testid="new-placement-panel">
      {!open && (
        <Button
          variant="primary"
          data-testid="open-new-placement-form"
          onClick={() => setOpen(true)}
        >
          + New Case
        </Button>
      )}

      {open && (
        <form
          onSubmit={handleSubmit}
          data-testid="new-placement-form"
          className="bg-surface-muted border border-border rounded-md p-5"
        >
          <h3 className="text-base font-semibold text-ink mt-0 mb-4">Create New Case</h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="np-job-title" className={labelClass}>
                Job Title *
              </label>
              <input
                id="np-job-title"
                data-testid="np-job-title"
                className={inputClass}
                value={fields.job_title}
                onChange={(e) => set('job_title', e.target.value)}
                required
                placeholder="e.g. Senior Engineer"
              />
            </div>

            <div>
              <label htmlFor="np-client" className={labelClass}>
                Client *
              </label>
              <input
                id="np-client"
                data-testid="np-client-entity-id"
                className={inputClass}
                value={fields.client_entity_id}
                onChange={(e) => set('client_entity_id', e.target.value)}
                required
                placeholder="Client name or ID"
              />
            </div>

            <div>
              <label htmlFor="np-candidate" className={labelClass}>
                Candidate *
              </label>
              <input
                id="np-candidate"
                data-testid="np-candidate-id"
                className={inputClass}
                value={fields.candidate_id}
                onChange={(e) => set('candidate_id', e.target.value)}
                required
                placeholder="Candidate name or ID"
              />
            </div>

            <div>
              <label htmlFor="np-comp-base" className={labelClass}>
                Compensation Base *
              </label>
              <input
                id="np-comp-base"
                data-testid="np-compensation-base"
                className={inputClass}
                value={fields.compensation_base}
                onChange={(e) => set('compensation_base', e.target.value)}
                required
                placeholder="e.g. 120000"
                type="number"
                min="0"
              />
            </div>

            <div>
              <label htmlFor="np-fee-amount" className={labelClass}>
                Fee Amount *
              </label>
              <input
                id="np-fee-amount"
                data-testid="np-fee-amount"
                className={inputClass}
                value={fields.fee_amount}
                onChange={(e) => set('fee_amount', e.target.value)}
                required
                placeholder="e.g. 24000"
                type="number"
                min="0"
              />
            </div>

            <div>
              <label htmlFor="np-start-date" className={labelClass}>
                Start Date
              </label>
              <input
                id="np-start-date"
                data-testid="np-start-date"
                className={inputClass}
                value={fields.start_date}
                onChange={(e) => set('start_date', e.target.value)}
                type="date"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-bad-fg mb-3" data-testid="new-placement-error">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={saving} data-testid="np-submit">
              {saving ? 'Creating…' : 'Create Case'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              data-testid="np-cancel"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contributor panel — per-placement expand
// ---------------------------------------------------------------------------

interface ContributorPanelProps {
  placementId: string;
}

function ContributorPanel({ placementId }: ContributorPanelProps) {
  const [refresh, setRefresh] = useState(0);
  const bumpRefresh = useCallback(() => setRefresh((n) => n + 1), []);

  const {
    data: contributors,
    loading,
    error,
  } = useAsync<Contributor[]>(
    () => apiGet<Contributor[]>(`/placements/${placementId}/contributors`),
    [placementId, refresh],
  );

  // Add contributor form state
  const [addProducerId, setAddProducerId] = useState('');
  const [addRole, setAddRole] = useState<ContributorRole>('ClientOriginator');
  const [addSplitPct, setAddSplitPct] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddSaving(true);
    setAddError(null);
    try {
      await apiPost(`/placements/${placementId}/contributors`, {
        producer_id: addProducerId,
        role: addRole,
        split_pct: Number(addSplitPct) / 100,
      });
      setAddProducerId('');
      setAddSplitPct('');
      bumpRefresh();
    } catch (err: unknown) {
      if (err instanceof ApiError) setAddError(err.message);
      else setAddError('Failed to add contributor');
    } finally {
      setAddSaving(false);
    }
  }

  async function handleRemove(contributorId: string) {
    try {
      await apiDelete(`/placements/${placementId}/contributors/${contributorId}`);
      bumpRefresh();
    } catch {
      /* ignore */
    }
  }

  const inputClass =
    'border border-border-strong rounded-sm px-2 py-1 text-xs bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-accent';

  return (
    <div
      className="bg-surface-muted border-t border-border px-4 pb-4 pt-3"
      data-testid={`contributor-panel-${placementId}`}
    >
      <h4 className="text-xs font-semibold text-ink-subtle uppercase tracking-wide mb-2 mt-0">
        Commission Contributors
      </h4>

      {loading && (
        <p className="text-xs text-ink-subtle" data-testid="contributors-loading">
          Loading…
        </p>
      )}
      {error && (
        <p className="text-xs text-bad-fg" data-testid="contributors-error">
          {error}
        </p>
      )}

      {contributors && contributors.length === 0 && (
        <p className="text-xs text-ink-subtle mb-3" data-testid="contributors-empty">
          No contributors assigned yet.
        </p>
      )}

      {contributors && contributors.length > 0 && (
        <table className="w-full text-xs mb-3" data-testid="contributors-table">
          <thead>
            <tr className="text-left text-ink-subtle border-b border-border">
              <th className="pb-1 pr-4 font-medium">Producer</th>
              <th className="pb-1 pr-4 font-medium">Role</th>
              <th className="pb-1 pr-4 font-medium">Split %</th>
              <th className="pb-1 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {contributors.map((c) => (
              <tr
                key={c.id}
                className="border-b border-border/50 last:border-b-0"
                data-testid={`contributor-row-${c.id}`}
              >
                <td className="py-1.5 pr-4 font-mono text-ink">{c.producer_id}</td>
                <td className="py-1.5 pr-4 text-ink">
                  {CONTRIBUTOR_ROLE_LABELS[c.role] ?? c.role}
                </td>
                <td className="py-1.5 pr-4 text-ink">{Math.round(c.split_pct * 100)}%</td>
                <td className="py-1.5">
                  <button
                    className="text-bad-fg text-xs hover:underline"
                    data-testid={`remove-contributor-${c.id}`}
                    onClick={() => handleRemove(c.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={handleAdd} data-testid="add-contributor-form" className="flex gap-2 flex-wrap items-end">
        <div>
          <label className="block text-xs text-ink-subtle mb-0.5">Producer ID</label>
          <input
            data-testid="add-contributor-producer-id"
            className={`${inputClass} w-40`}
            value={addProducerId}
            onChange={(e) => setAddProducerId(e.target.value)}
            required
            placeholder="Producer ID"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-subtle mb-0.5">Role</label>
          <select
            data-testid="add-contributor-role"
            className={inputClass}
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as ContributorRole)}
          >
            {CONTRIBUTOR_ROLES.map((r) => (
              <option key={r} value={r}>
                {CONTRIBUTOR_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-ink-subtle mb-0.5">Split % (0-100)</label>
          <input
            data-testid="add-contributor-split-pct"
            className={`${inputClass} w-20`}
            value={addSplitPct}
            onChange={(e) => setAddSplitPct(e.target.value)}
            required
            placeholder="e.g. 50"
            type="number"
            min="1"
            max="100"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          disabled={addSaving}
          data-testid="add-contributor-submit"
          className="text-xs h-7 px-2.5"
        >
          {addSaving ? 'Adding…' : 'Assign'}
        </Button>
      </form>

      {addError && (
        <p className="text-xs text-bad-fg mt-1" data-testid="add-contributor-error">
          {addError}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placement row — view + inline edit + expand
// ---------------------------------------------------------------------------

interface PlacementRowProps {
  placement: Placement;
  onUpdated: (updated: Placement) => void;
}

function PlacementRow({ placement: initial, onUpdated }: PlacementRowProps) {
  const [placement, setPlacement] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Partial<Placement>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function startEdit() {
    setDraft({
      job_title: placement.job_title,
      client_entity_id: placement.client_entity_id,
      candidate_id: placement.candidate_id,
      compensation_base: placement.compensation_base,
      fee_amount: placement.fee_amount,
      start_date: placement.start_date ?? '',
    });
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await apiPatch<Placement>(`/placements/${placement.id}`, draft);
      setPlacement(updated);
      setEditing(false);
      onUpdated(updated);
    } catch (err: unknown) {
      if (err instanceof ApiError) setSaveError(err.message);
      else setSaveError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  const cellClass = 'px-3 py-2 text-sm align-top';
  const inputClass =
    'w-full border border-border-strong rounded-sm px-1.5 py-0.5 text-xs bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-accent';

  return (
    <>
      <tr
        className="border-b border-border hover:bg-surface-muted transition-colors"
        data-testid={`placement-row-${placement.id}`}
      >
        {/* Job Title */}
        <td className={cellClass}>
          {editing ? (
            <input
              data-testid={`edit-job-title-${placement.id}`}
              className={inputClass}
              value={String(draft.job_title ?? '')}
              onChange={(e) => setDraft((d) => ({ ...d, job_title: e.target.value }))}
            />
          ) : (
            <span className="font-medium text-ink">{placement.job_title}</span>
          )}
        </td>

        {/* Client */}
        <td className={cellClass}>
          {editing ? (
            <input
              data-testid={`edit-client-${placement.id}`}
              className={inputClass}
              value={String(draft.client_entity_id ?? '')}
              onChange={(e) => setDraft((d) => ({ ...d, client_entity_id: e.target.value }))}
            />
          ) : (
            <span className="text-ink-subtle font-mono text-xs">{placement.client_entity_id}</span>
          )}
        </td>

        {/* Candidate */}
        <td className={cellClass}>
          {editing ? (
            <input
              data-testid={`edit-candidate-${placement.id}`}
              className={inputClass}
              value={String(draft.candidate_id ?? '')}
              onChange={(e) => setDraft((d) => ({ ...d, candidate_id: e.target.value }))}
            />
          ) : (
            <span className="text-ink-subtle font-mono text-xs">{placement.candidate_id}</span>
          )}
        </td>

        {/* Status */}
        <td className={cellClass}>
          <span className="text-xs text-ink-subtle">{placement.status}</span>
        </td>

        {/* Start Date */}
        <td className={cellClass}>
          {editing ? (
            <input
              data-testid={`edit-start-date-${placement.id}`}
              className={inputClass}
              type="date"
              value={String(draft.start_date ?? '')}
              onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value || null }))}
            />
          ) : (
            <span className="text-xs text-ink">{placement.start_date ?? '—'}</span>
          )}
        </td>

        {/* Fee Amount */}
        <td className={cellClass}>
          {editing ? (
            <input
              data-testid={`edit-fee-amount-${placement.id}`}
              className={inputClass}
              type="number"
              value={String(draft.fee_amount ?? '')}
              onChange={(e) => setDraft((d) => ({ ...d, fee_amount: e.target.value }))}
            />
          ) : (
            <span className="text-xs text-ink">
              {placement.fee_amount
                ? `$${Number(placement.fee_amount).toLocaleString()}`
                : '—'}
            </span>
          )}
        </td>

        {/* Comp Base */}
        <td className={cellClass}>
          {editing ? (
            <input
              data-testid={`edit-comp-base-${placement.id}`}
              className={inputClass}
              type="number"
              value={String(draft.compensation_base ?? '')}
              onChange={(e) => setDraft((d) => ({ ...d, compensation_base: e.target.value }))}
            />
          ) : (
            <span className="text-xs text-ink">
              {placement.compensation_base
                ? `$${Number(placement.compensation_base).toLocaleString()}`
                : '—'}
            </span>
          )}
        </td>

        {/* Actions */}
        <td className={`${cellClass} text-right whitespace-nowrap`}>
          {editing ? (
            <span className="flex gap-1 justify-end">
              <Button
                variant="primary"
                disabled={saving}
                onClick={handleSave}
                data-testid={`save-placement-${placement.id}`}
                className="text-xs h-6 px-2"
              >
                {saving ? '…' : 'Save'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setSaveError(null);
                }}
                data-testid={`cancel-edit-${placement.id}`}
                className="text-xs h-6 px-2"
              >
                Cancel
              </Button>
            </span>
          ) : (
            <span className="flex gap-1 justify-end">
              <Button
                variant="secondary"
                onClick={startEdit}
                data-testid={`edit-placement-${placement.id}`}
                className="text-xs h-6 px-2"
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                onClick={() => setExpanded((v) => !v)}
                data-testid={`toggle-contributors-${placement.id}`}
                className="text-xs h-6 px-2"
              >
                {expanded ? 'Hide' : 'Contributors'}
              </Button>
            </span>
          )}
        </td>
      </tr>

      {saveError && (
        <tr>
          <td
            colSpan={8}
            className="px-3 pb-1 text-xs text-bad-fg"
            data-testid={`row-save-error-${placement.id}`}
          >
            {saveError}
          </td>
        </tr>
      )}

      {expanded && (
        <tr data-testid={`contributor-expand-${placement.id}`}>
          <td colSpan={8} className="p-0">
            <ContributorPanel placementId={placement.id} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// PlacementLedger — root component
// ---------------------------------------------------------------------------

export function PlacementLedger() {
  const [placements, setPlacements] = useState<Placement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    apiGet<Placement[]>('/placements')
      .then((data) => {
        if (active) setPlacements(data);
      })
      .catch((err: unknown) => {
        if (active)
          setLoadError(err instanceof ApiError ? err.message : 'Failed to load placements');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleCreated(placement: Placement) {
    setPlacements((prev) => (prev ? [placement, ...prev] : [placement]));
  }

  function handleUpdated(updated: Placement) {
    setPlacements((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? prev);
  }

  return (
    <div data-testid="placement-ledger">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-ink m-0">Cases</h2>
        <p className="text-sm text-ink-subtle mt-1 mb-0">
          Create placements and assign commission contributors per case.
        </p>
      </div>

      <NewPlacementForm onCreated={handleCreated} />

      {loading && <LoadingState label="placements" />}
      {loadError && <ErrorState message={loadError} />}

      {!loading && !loadError && placements && placements.length === 0 && (
        <EmptyState message="No placements yet. Create the first case above." />
      )}

      {placements && placements.length > 0 && (
        <div
          className="overflow-x-auto rounded-md border border-border"
          data-testid="placements-table-container"
        >
          <table className="w-full text-sm" data-testid="placements-table">
            <thead className="bg-surface-muted">
              <tr className="text-left text-xs text-ink-subtle border-b border-border">
                <th className="px-3 py-2 font-medium">Job Title</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Candidate</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Start Date</th>
                <th className="px-3 py-2 font-medium">Fee</th>
                <th className="px-3 py-2 font-medium">Comp Base</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {placements.map((p) => (
                <PlacementRow key={p.id} placement={p} onUpdated={handleUpdated} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


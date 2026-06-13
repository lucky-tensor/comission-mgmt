/**
 * PlacementLedger — cross-role placement management surface.
 *
 * Finance Admin receives `editable: true` from the server and sees create/edit flows.
 * Executive, HR, and Manager receive `editable: false` and see a read-only view.
 *
 * Modals:
 *   - create:    PlacementForm (new)
 *   - customer:  PlacementForm (existing)
 *   - status:    StatusForm
 *   - billing:   InvoiceCollection
 *   - producers: ProducerAssignments
 *
 * Canonical docs: docs/prd.md §5.1
 * Issue: feat: placement ledger — cross-role placement management surface (#233)
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppRole } from 'core/auth';
import { CONTRIBUTOR_ROLES, CONTRIBUTOR_ROLE_LABELS } from 'core/contributor-role';
import { Button, StatusChip } from 'ui';
import { apiDelete, ApiError, apiGet, apiPatch, apiPost } from '../../lib/apiClient';
import { InvoiceCollection } from '../finance/InvoiceCollection';

interface LedgerContributor {
  id: string;
  producerId: string;
  displayName: string;
  role: string;
  splitPct: number;
}

interface PlacementLedgerRow {
  id: string;
  candidate_id: string;
  client_entity_id: string;
  job_title: string;
  compensation_base: string;
  fee_amount: string;
  status: string;
  start_date: string | null;
  guarantee_days: number | null;
  is_confidential: boolean;
  billing_statuses: string[];
  contributors: LedgerContributor[];
}

export interface LedgerResponse {
  editable: boolean;
  placements: PlacementLedgerRow[];
}

interface ProducerOption {
  id: string;
  name: string;
}

type SortKey = 'customer' | 'status' | 'billing' | 'producers';
type Editor = 'create' | 'customer' | 'status' | 'billing' | 'producers' | null;

const INPUT_CLASS =
  'w-full h-9 px-3 border border-border-strong rounded-sm bg-surface text-sm text-ink';
const LABEL_CLASS = 'block text-xs font-semibold text-ink-subtle mb-1';

const PLACEMENT_STATUSES = [
  'Created',
  'ContributorsAssigned',
  'PendingApproval',
  'Active',
  'Invoiced',
  'Collected',
  'GuaranteeActive',
  'GuaranteeExpired',
  'Closed',
  'Refunded',
  'Disputed',
  'ClawbackTriggered',
] as const;

function Modal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-2xl max-h-dialog overflow-auto rounded-xl border border-border bg-surface shadow-lg"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-lg font-bold text-ink m-0">{title}</h2>
            {description && <p className="text-sm text-ink-subtle mt-1 mb-0">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            className="border-0 bg-transparent text-xl text-ink-subtle cursor-pointer"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function billingLabel(row: PlacementLedgerRow): string {
  return row.billing_statuses.length > 0 ? row.billing_statuses.join(', ') : 'Not invoiced';
}

function producerLabel(row: PlacementLedgerRow): string {
  return row.contributors.length > 0
    ? row.contributors.map((contributor) => contributor.displayName).join(', ')
    : 'Unassigned';
}

function sortValue(row: PlacementLedgerRow, key: SortKey): string {
  if (key === 'customer') return `${row.client_entity_id} ${row.job_title}`.toLowerCase();
  if (key === 'status') return row.status.toLowerCase();
  if (key === 'billing') return billingLabel(row).toLowerCase();
  return producerLabel(row).toLowerCase();
}

function EditableCell({
  enabled,
  onClick,
  children,
}: {
  enabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <button
      type="button"
      className="w-full text-left border-0 bg-transparent p-0 text-inherit cursor-pointer hover:underline"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const defaultLoadLedger = () => apiGet<LedgerResponse>('/placements/ledger');

export function PlacementLedger({
  role,
  load = defaultLoadLedger,
}: {
  role: AppRole;
  load?: () => Promise<LedgerResponse>;
}) {
  const [rows, setRows] = useState<PlacementLedgerRow[]>([]);
  const [editable, setEditable] = useState(role === 'FinanceAdmin');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({
    key: 'customer',
    direction: 1,
  });
  const [editor, setEditor] = useState<Editor>(null);
  const [selected, setSelected] = useState<PlacementLedgerRow | null>(null);

  async function loadLedger() {
    setLoading(true);
    setError(null);
    try {
      const response = await load();
      setRows(response.placements);
      setEditable(response.editable);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load placements');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLedger();
  }, [load]);

  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (left, right) =>
          sortValue(left, sort.key).localeCompare(sortValue(right, sort.key)) * sort.direction,
      ),
    [rows, sort],
  );

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key ? (current.direction === 1 ? -1 : 1) : 1,
    }));
  }

  function openEditor(nextEditor: Exclude<Editor, 'create' | null>, row: PlacementLedgerRow) {
    setSelected(row);
    setEditor(nextEditor);
  }

  function closeEditor() {
    setEditor(null);
    setSelected(null);
  }

  async function saved() {
    closeEditor();
    await loadLedger();
  }

  return (
    <section data-testid="placement-ledger" className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-ink m-0">Placement Ledger</h2>
          <p className="text-sm text-ink-subtle mt-1 mb-0">
            Placement lifecycle, billing, and producer ownership in one view.
          </p>
        </div>
        {editable && <Button onClick={() => setEditor('create')}>New placement</Button>}
      </div>

      {loading && <div className="text-sm text-ink-subtle py-8">Loading placements…</div>}
      {error && <div className="text-sm text-bad-fg py-4">{error}</div>}
      {!loading && !error && (
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface-sunken text-ink-subtle text-xs uppercase">
              <tr>
                {(['customer', 'status', 'billing', 'producers'] as SortKey[]).map((key) => (
                  <th key={key} className="text-left px-4 py-3 border-b border-border">
                    <button
                      type="button"
                      className="border-0 bg-transparent p-0 font-semibold uppercase text-inherit cursor-pointer"
                      onClick={() => toggleSort(key)}
                    >
                      {key} {sort.key === key ? (sort.direction === 1 ? '↑' : '↓') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-ink-subtle px-4 py-10">
                    No placements available.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 align-top min-w-64">
                      <EditableCell enabled={editable} onClick={() => openEditor('customer', row)}>
                        <div className="font-semibold text-ink">{row.job_title}</div>
                        <div className="text-xs text-ink-subtle mt-1">
                          Customer: {row.client_entity_id}
                        </div>
                      </EditableCell>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <EditableCell enabled={editable} onClick={() => openEditor('status', row)}>
                        <StatusChip status={row.status} />
                      </EditableCell>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <EditableCell enabled={editable} onClick={() => openEditor('billing', row)}>
                        <div className="flex flex-wrap gap-1">
                          {row.billing_statuses.length > 0 ? (
                            row.billing_statuses.map((status) => (
                              <StatusChip key={status} status={status} />
                            ))
                          ) : (
                            <span className="text-ink-subtle">Not invoiced</span>
                          )}
                        </div>
                      </EditableCell>
                    </td>
                    <td className="px-4 py-3 align-top min-w-64">
                      <EditableCell enabled={editable} onClick={() => openEditor('producers', row)}>
                        {row.contributors.length > 0 ? (
                          <div className="space-y-1">
                            {row.contributors.map((contributor) => (
                              <div key={contributor.id}>
                                <span className="font-medium text-ink">
                                  {contributor.displayName}
                                </span>
                                <span className="text-xs text-ink-subtle">
                                  {' '}
                                  ·{' '}
                                  {CONTRIBUTOR_ROLE_LABELS[
                                    contributor.role as keyof typeof CONTRIBUTOR_ROLE_LABELS
                                  ] ?? contributor.role}{' '}
                                  · {Math.round(contributor.splitPct * 100)}%
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-ink-subtle">Unassigned</span>
                        )}
                      </EditableCell>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editor === 'create'}
        title="Create placement"
        description="Create the placement record before assigning producers and billing."
        onClose={closeEditor}
      >
        <PlacementForm onSaved={saved} />
      </Modal>

      <Modal
        open={editor === 'customer' && selected !== null}
        title="Edit placement details"
        description={selected?.job_title}
        onClose={closeEditor}
      >
        {selected && <PlacementForm placement={selected} onSaved={saved} />}
      </Modal>

      <Modal
        open={editor === 'status' && selected !== null}
        title="Change placement status"
        description={selected?.job_title}
        onClose={closeEditor}
      >
        {selected && <StatusForm placement={selected} onSaved={saved} />}
      </Modal>

      <Modal
        open={editor === 'billing' && selected !== null}
        title="Billing and collection"
        description={selected?.job_title}
        onClose={closeEditor}
      >
        {selected && <InvoiceCollection placementId={selected.id} />}
      </Modal>

      <Modal
        open={editor === 'producers' && selected !== null}
        title="Producer assignments"
        description={selected?.job_title}
        onClose={closeEditor}
      >
        {selected && <ProducerAssignments placement={selected} onSaved={loadLedger} />}
      </Modal>
    </section>
  );
}

function PlacementForm({
  placement,
  onSaved,
}: {
  placement?: PlacementLedgerRow;
  onSaved: () => Promise<void>;
}) {
  const [candidateId, setCandidateId] = useState(placement?.candidate_id ?? '');
  const [clientId, setClientId] = useState(placement?.client_entity_id ?? '');
  const [jobTitle, setJobTitle] = useState(placement?.job_title ?? '');
  const [startDate, setStartDate] = useState(placement?.start_date ?? '');
  const [compensationBase, setCompensationBase] = useState(placement?.compensation_base ?? '');
  const [feeAmount, setFeeAmount] = useState(placement?.fee_amount ?? '');
  const [guaranteeDays, setGuaranteeDays] = useState(
    placement?.guarantee_days == null ? '' : String(placement.guarantee_days),
  );
  const [confidential, setConfidential] = useState(placement?.is_confidential ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      candidate_id: candidateId,
      client_entity_id: clientId,
      job_title: jobTitle,
      start_date: startDate || null,
      compensation_base: compensationBase,
      fee_amount: feeAmount,
      guarantee_days: guaranteeDays === '' ? null : Number(guaranteeDays),
      is_confidential: confidential,
    };
    try {
      if (placement) await apiPatch(`/placements/${placement.id}`, body);
      else await apiPost('/placements', body);
      await onSaved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Failed to save placement');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-4">
      <label>
        <span className={LABEL_CLASS}>Customer record ID</span>
        <input
          required
          className={INPUT_CLASS}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        />
      </label>
      <label>
        <span className={LABEL_CLASS}>Candidate record ID</span>
        <input
          required
          className={INPUT_CLASS}
          value={candidateId}
          onChange={(event) => setCandidateId(event.target.value)}
        />
      </label>
      <label className="col-span-2">
        <span className={LABEL_CLASS}>Job title</span>
        <input
          required
          className={INPUT_CLASS}
          value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)}
        />
      </label>
      <label>
        <span className={LABEL_CLASS}>Start date</span>
        <input
          type="date"
          className={INPUT_CLASS}
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
      </label>
      <label>
        <span className={LABEL_CLASS}>Guarantee days</span>
        <input
          type="number"
          min="0"
          className={INPUT_CLASS}
          value={guaranteeDays}
          onChange={(event) => setGuaranteeDays(event.target.value)}
        />
      </label>
      <label>
        <span className={LABEL_CLASS}>Placed compensation</span>
        <input
          required
          inputMode="decimal"
          className={INPUT_CLASS}
          value={compensationBase}
          onChange={(event) => setCompensationBase(event.target.value)}
        />
      </label>
      <label>
        <span className={LABEL_CLASS}>Fee amount</span>
        <input
          required
          inputMode="decimal"
          className={INPUT_CLASS}
          value={feeAmount}
          onChange={(event) => setFeeAmount(event.target.value)}
        />
      </label>
      <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={confidential}
          onChange={(event) => setConfidential(event.target.checked)}
        />
        Confidential placement
      </label>
      {error && <div className="col-span-2 text-sm text-bad-fg">{error}</div>}
      <div className="col-span-2 flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : placement ? 'Save details' : 'Create placement'}
        </Button>
      </div>
    </form>
  );
}

function StatusForm({
  placement,
  onSaved,
}: {
  placement: PlacementLedgerRow;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState(placement.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/placements/${placement.id}`, { status });
      await onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label>
        <span className={LABEL_CLASS}>Lifecycle status</span>
        <select
          className={INPUT_CLASS}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {PLACEMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="text-sm text-bad-fg">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Update status'}
        </Button>
      </div>
    </form>
  );
}

function ProducerAssignments({
  placement,
  onSaved,
}: {
  placement: PlacementLedgerRow;
  onSaved: () => Promise<void>;
}) {
  const [contributors, setContributors] = useState(placement.contributors);
  const [producers, setProducers] = useState<ProducerOption[]>([]);
  const [producerId, setProducerId] = useState('');
  const [role, setRole] = useState<(typeof CONTRIBUTOR_ROLES)[number]>('CandidateOwner');
  const [splitPct, setSplitPct] = useState('100');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ producers: ProducerOption[] }>('/producers')
      .then((response) => setProducers(response.producers))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load producers'),
      );
  }, []);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost(`/placements/${placement.id}/contributors`, {
        producer_id: producerId,
        role,
        split_pct: Number(splitPct) / 100,
      });
      await onSaved();
      const response = await apiGet<LedgerResponse>('/placements/ledger');
      setContributors(
        response.placements.find((candidate) => candidate.id === placement.id)?.contributors ?? [],
      );
      setProducerId('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add producer');
    }
  }

  async function remove(contributorId: string) {
    setError(null);
    try {
      await apiDelete(`/placements/${placement.id}/contributors/${contributorId}`);
      setContributors((current) =>
        current.filter((contributor) => contributor.id !== contributorId),
      );
      await onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove producer');
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {contributors.length === 0 ? (
          <div className="text-sm text-ink-subtle">No producers assigned.</div>
        ) : (
          contributors.map((contributor) => (
            <div
              key={contributor.id}
              className="flex items-center justify-between gap-4 border border-border rounded-sm px-3 py-2"
            >
              <div className="text-sm">
                <div className="font-semibold text-ink">{contributor.displayName}</div>
                <div className="text-ink-subtle">
                  {CONTRIBUTOR_ROLE_LABELS[
                    contributor.role as keyof typeof CONTRIBUTOR_ROLE_LABELS
                  ] ?? contributor.role}{' '}
                  · {Math.round(contributor.splitPct * 100)}%
                </div>
              </div>
              <Button
                variant="destructive"
                type="button"
                onClick={() => void remove(contributor.id)}
              >
                Remove
              </Button>
            </div>
          ))
        )}
      </div>

      <form onSubmit={add} className="grid grid-cols-3 gap-3 border-t border-border pt-4">
        <label>
          <span className={LABEL_CLASS}>Producer</span>
          <select
            required
            className={INPUT_CLASS}
            value={producerId}
            onChange={(event) => setProducerId(event.target.value)}
          >
            <option value="">Select producer</option>
            {producers.map((producer) => (
              <option key={producer.id} value={producer.id}>
                {producer.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={LABEL_CLASS}>Role</span>
          <select
            className={INPUT_CLASS}
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            {CONTRIBUTOR_ROLES.map((value) => (
              <option key={value} value={value}>
                {CONTRIBUTOR_ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={LABEL_CLASS}>Split %</span>
          <input
            required
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            className={INPUT_CLASS}
            value={splitPct}
            onChange={(event) => setSplitPct(event.target.value)}
          />
        </label>
        {error && <div className="col-span-3 text-sm text-bad-fg">{error}</div>}
        <div className="col-span-3 flex justify-end">
          <Button type="submit">Add producer</Button>
        </div>
      </form>
    </div>
  );
}

/**
 * CommissionRunReview — Finance Admin surface for starting a commission run,
 * reviewing the per-record queue, approving records individually, approving
 * the batch, and finalizing.
 *
 * Composed of:
 *   - CommissionRunReviewView  — pure presentational view (loading/error/data
 *     states; accepts explicit state props so tests render each state in real
 *     headless Chromium without any network mock)
 *   - CommissionRunReview      — container wiring real API calls via apiClient
 *
 * API endpoints used:
 *   POST   /commission-runs                            — start a run
 *   GET    /commission-runs/:id/queue                  — load review queue
 *   POST   /commission-runs/:id/records/:rid/approve   — approve one record
 *   POST   /commission-runs/:id/approve                — batch-approve the run
 *   POST   /commission-runs/:id/finalize               — finalize (reconciliation-gated)
 *
 * Finalize 422 gate reasons are rendered as an actionable blocked state rather
 * than a generic error — the response carries:
 *   { error: string, unacknowledged_discrepancy_count?: number,
 *     unapproved_record_ids?: string[] }
 *
 * CSRF: mutations go through apiPost which attaches the double-submit header.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.3, §5.4
 * Issue: feat: Finance Admin UI — commission run review and batch approval (#102)
 */

import { useState } from 'react';
import { Button, StatusChip } from 'ui';
import { ApiError, apiGet, apiPost } from '../../lib/apiClient';
import { formatCurrency, formatDate } from '../../lib/format';

// ---------------------------------------------------------------------------
// Types for API response shapes
// ---------------------------------------------------------------------------

export interface CommissionRunInfo {
  id: string;
  org_id: string;
  period_start: string;
  period_end: string;
  status: string;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface QueueItem {
  commission_record_id: string;
  run_record_id: string;
  status: string;
  hold_reason: string | null;
  individually_approved: boolean;
  individually_approved_by: string | null;
  individually_approved_at: string | null;
  queue_category: 'ready' | 'held' | 'exception_pending' | 'approved';
  /** plain-language explanation (from commission record, when present) */
  explanation?: string | null;
  /** commissionable base */
  gross_commission?: number | string | null;
  /** calculated net payable amount */
  net_payable?: number | string | null;
  /** position title */
  position_title?: string | null;
}

export interface QueueTotals {
  total: number;
  ready: number;
  held: number;
  exception_pending: number;
  approved: number;
}

export interface CommissionRunQueueData {
  run: CommissionRunInfo;
  queue: QueueItem[];
  totals: QueueTotals;
}

/** 422 finalize gate reasons as returned by the server. */
export interface FinalizeBlockedReason {
  error: string;
  unacknowledged_discrepancy_count?: number;
  unapproved_record_ids?: string[];
  hint?: string;
}

// ---------------------------------------------------------------------------
// Shared style tokens — Tailwind class strings (theme tokens, no raw hex)
// ---------------------------------------------------------------------------

const CARD_CLASS = 'bg-surface border border-border rounded-md p-6 mb-6';

const HEADING_CLASS = 'text-lg font-semibold text-ink mt-0 mb-4';

const CELL_CLASS = 'px-3 py-2 text-sm border-b border-surface-sunken text-left align-top';

const HEAD_CELL_CLASS = `${CELL_CLASS} font-semibold text-ink-subtle uppercase text-xs tracking-wide`;

// ---------------------------------------------------------------------------
// StartRunForm — inline form to create a new commission run
// ---------------------------------------------------------------------------

export interface StartRunFormProps {
  onStart: (periodStart: string, periodEnd: string, placementIds: string[]) => Promise<void>;
  submitting: boolean;
  error: string | null;
}

export function StartRunForm({ onStart, submitting, error }: StartRunFormProps) {
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [placementIdsText, setPlacementIdsText] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ids = placementIdsText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    void onStart(periodStart, periodEnd, ids);
  }

  return (
    <div data-testid="start-run-form" className={CARD_CLASS}>
      <h2 className={HEADING_CLASS}>Start a new commission run</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label htmlFor="period-start" className="block text-sm font-semibold mb-1">
            Period start
          </label>
          <input
            id="period-start"
            data-testid="period-start-input"
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            required
            className="p-2 border border-border-strong rounded-md text-sm"
          />
        </div>
        <div className="mb-3">
          <label htmlFor="period-end" className="block text-sm font-semibold mb-1">
            Period end
          </label>
          <input
            id="period-end"
            data-testid="period-end-input"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            required
            className="p-2 border border-border-strong rounded-md text-sm"
          />
        </div>
        <div className="mb-4">
          <label htmlFor="placement-ids" className="block text-sm font-semibold mb-1">
            Placement IDs (comma or newline separated)
          </label>
          <textarea
            id="placement-ids"
            data-testid="placement-ids-input"
            value={placementIdsText}
            onChange={(e) => setPlacementIdsText(e.target.value)}
            rows={4}
            required
            className="w-full p-2 border border-border-strong rounded-md text-sm box-border"
          />
        </div>
        {error && (
          <div
            data-testid="start-run-error"
            role="alert"
            className="p-3 bg-bad-bg border border-bad-fg/30 rounded-md text-bad-fg text-sm mb-3"
          >
            {error}
          </div>
        )}
        <Button type="submit" data-testid="start-run-button" disabled={submitting}>
          {submitting ? 'Starting…' : 'Start commission run'}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QueueTable — the review queue with per-record approve buttons
// ---------------------------------------------------------------------------

export interface QueueTableProps {
  items: QueueItem[];
  onApproveRecord: (runId: string, recordId: string) => Promise<void>;
  runId: string;
  approvingRecordId: string | null;
}

function categoryBadge(cat: QueueItem['queue_category']): React.ReactNode {
  const variants: Record<QueueItem['queue_category'], 'green' | 'amber' | 'gray' | 'red'> = {
    ready: 'gray',
    held: 'amber',
    exception_pending: 'red',
    approved: 'green',
  };
  const labels: Record<QueueItem['queue_category'], string> = {
    ready: 'Ready',
    held: 'Held',
    exception_pending: 'Exception pending',
    approved: 'Approved',
  };
  return (
    <StatusChip variant={variants[cat]} className="text-xs font-semibold">
      {labels[cat]}
    </StatusChip>
  );
}

export function QueueTable({ items, onApproveRecord, runId, approvingRecordId }: QueueTableProps) {
  if (items.length === 0) {
    return (
      <div
        data-testid="empty-queue"
        className="p-5 bg-surface-muted border border-dashed border-border-strong rounded-md text-ink-subtle text-sm"
      >
        No commission records in this run.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table data-testid="queue-table" className="w-full border-collapse">
        <thead>
          <tr>
            <th className={HEAD_CELL_CLASS}>Record ID</th>
            <th className={HEAD_CELL_CLASS}>Position</th>
            <th className={HEAD_CELL_CLASS}>Commissionable base</th>
            <th className={HEAD_CELL_CLASS}>Calculated amount</th>
            <th className={HEAD_CELL_CLASS}>Hold reason</th>
            <th className={HEAD_CELL_CLASS}>Explanation</th>
            <th className={HEAD_CELL_CLASS}>Status</th>
            <th className={HEAD_CELL_CLASS}>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isApproving = approvingRecordId === item.commission_record_id;
            return (
              <tr
                key={item.commission_record_id}
                data-testid={`queue-row-${item.commission_record_id}`}
              >
                <td className={CELL_CLASS}>
                  <span className="font-mono text-xs">
                    {item.commission_record_id.slice(0, 8)}…
                  </span>
                </td>
                <td className={CELL_CLASS}>{item.position_title ?? '—'}</td>
                <td className={CELL_CLASS}>
                  {item.gross_commission != null ? formatCurrency(item.gross_commission) : '—'}
                </td>
                <td className={CELL_CLASS}>
                  {item.net_payable != null ? formatCurrency(item.net_payable) : '—'}
                </td>
                <td className={CELL_CLASS}>{item.hold_reason ?? '—'}</td>
                <td className={`${CELL_CLASS} max-w-compact text-ink-muted`}>
                  {item.explanation ?? '—'}
                </td>
                <td className={CELL_CLASS}>{categoryBadge(item.queue_category)}</td>
                <td className={CELL_CLASS}>
                  {item.individually_approved ? (
                    <span className="text-ok-fg text-sm font-semibold">
                      ✓ Approved{' '}
                      {item.individually_approved_at
                        ? formatDate(item.individually_approved_at)
                        : ''}
                    </span>
                  ) : (
                    <Button
                      data-testid={`approve-record-${item.commission_record_id}`}
                      disabled={isApproving}
                      onClick={() => void onApproveRecord(runId, item.commission_record_id)}
                    >
                      {isApproving ? 'Approving…' : 'Approve'}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FinalizeBlockedState — renders the 422 gate reason(s) clearly
// ---------------------------------------------------------------------------

export function FinalizeBlockedState({ reason }: { reason: FinalizeBlockedReason }) {
  return (
    <div
      data-testid="finalize-blocked"
      role="alert"
      className="p-5 bg-warn-bg border border-warn-fg/30 rounded-md mt-4"
    >
      <p className="font-semibold text-warn-fg m-0 mb-2 text-base">Finalization blocked</p>
      <p className="text-warn-fg text-sm m-0 mb-2">{reason.error}</p>
      {reason.unacknowledged_discrepancy_count != null && (
        <p data-testid="discrepancy-count" className="text-warn-fg text-sm m-0 mb-1">
          Unacknowledged reconciliation discrepancies:{' '}
          <strong>{reason.unacknowledged_discrepancy_count}</strong>
        </p>
      )}
      {reason.unapproved_record_ids && reason.unapproved_record_ids.length > 0 && (
        <p data-testid="unapproved-count" className="text-warn-fg text-sm m-0 mb-1">
          Records still requiring individual approval:{' '}
          <strong>{reason.unapproved_record_ids.length}</strong>
        </p>
      )}
      {reason.hint && <p className="text-warn-fg text-sm mt-2 mb-0 italic">{reason.hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoadRunForm — load an existing run by ID
// ---------------------------------------------------------------------------

export interface LoadRunFormProps {
  onLoad: (runId: string) => Promise<void>;
  loading: boolean;
}

export function LoadRunForm({ onLoad, loading }: LoadRunFormProps) {
  const [runId, setRunId] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (runId.trim()) void onLoad(runId.trim());
  }

  return (
    <div data-testid="load-run-form" className={CARD_CLASS}>
      <h2 className={HEADING_CLASS}>Or load an existing run</h2>
      <form onSubmit={handleSubmit} className="flex gap-3 items-end">
        <input
          data-testid="load-run-id-input"
          type="text"
          placeholder="Run UUID…"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
          className="p-2 border border-border-strong rounded-md text-sm min-w-form"
        />
        <Button type="submit" data-testid="load-run-queue-button" disabled={loading}>
          {loading ? 'Loading…' : 'Load run'}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommissionRunReviewView — pure presentational component
// ---------------------------------------------------------------------------

export type Phase =
  | { kind: 'start' }
  | { kind: 'loading-queue' }
  | { kind: 'queue'; data: CommissionRunQueueData }
  | { kind: 'error'; message: string }
  | { kind: 'batch-approved'; runId: string }
  | { kind: 'finalized' };

export interface CommissionRunReviewViewProps {
  embedded?: boolean;
  phase: Phase;
  onStart: (periodStart: string, periodEnd: string, placementIds: string[]) => Promise<void>;
  onLoadRun: (runId: string) => Promise<void>;
  onApproveRecord: (runId: string, recordId: string) => Promise<void>;
  onBatchApprove: (runId: string) => Promise<void>;
  onFinalize: (runId: string) => Promise<void>;
  startSubmitting: boolean;
  startError: string | null;
  batchApproving: boolean;
  finalizing: boolean;
  approvingRecordId: string | null;
  finalizeBlockedReason: FinalizeBlockedReason | null;
  mutationError: string | null;
}

export function CommissionRunReviewView({
  embedded = false,
  phase,
  onStart,
  onLoadRun,
  onApproveRecord,
  onBatchApprove,
  onFinalize,
  startSubmitting,
  startError,
  batchApproving,
  finalizing,
  approvingRecordId,
  finalizeBlockedReason,
  mutationError,
}: CommissionRunReviewViewProps) {
  return (
    <div
      data-testid="commission-run-review"
      data-embedded={embedded ? 'true' : 'false'}
      className={embedded ? '' : 'min-h-surface bg-surface-muted px-4 py-8'}
    >
      <div className={embedded ? '' : 'max-w-report mx-auto'}>
        <header className="mb-8">
          <h2
            className={`${embedded ? 'text-lg' : 'text-xl'} font-semibold tracking-tight text-ink m-0`}
          >
            {embedded ? 'Commission Runs' : 'Commission run review'}
          </h2>
          <p className="text-sm text-ink-subtle mt-1 mb-0">
            Start a commission cycle, review each calculated record, and approve the batch before
            payroll.
          </p>
        </header>

        {phase.kind === 'start' && (
          <>
            <StartRunForm onStart={onStart} submitting={startSubmitting} error={startError} />
            <LoadRunForm onLoad={onLoadRun} loading={startSubmitting} />
          </>
        )}

        {phase.kind === 'loading-queue' && (
          <div data-testid="loading-state" className={`${CARD_CLASS} text-ink-subtle`}>
            Loading commission run queue…
          </div>
        )}

        {phase.kind === 'error' && (
          <div
            data-testid="error-state"
            role="alert"
            className="bg-bad-bg border border-bad-fg/30 rounded-md p-6 mb-6 text-bad-fg"
          >
            {phase.message}
          </div>
        )}

        {phase.kind === 'queue' && (
          <>
            {/* Run summary */}
            <div data-testid="run-summary" className={CARD_CLASS}>
              <h2 className={HEADING_CLASS}>
                Run: {phase.data.run.period_start} — {phase.data.run.period_end}
              </h2>
              <dl className="flex gap-8 flex-wrap m-0">
                {[
                  ['Status', phase.data.run.status],
                  ['Total records', String(phase.data.totals.total)],
                  ['Ready', String(phase.data.totals.ready)],
                  ['Held', String(phase.data.totals.held)],
                  ['Exception pending', String(phase.data.totals.exception_pending)],
                  ['Approved', String(phase.data.totals.approved)],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <dt className="text-xs text-ink-subtle font-semibold uppercase">{label}</dt>
                    <dd className="text-base font-bold text-ink m-0">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Queue table */}
            <div className={CARD_CLASS}>
              <h2 className={HEADING_CLASS}>Review queue</h2>
              <QueueTable
                items={phase.data.queue}
                onApproveRecord={onApproveRecord}
                runId={phase.data.run.id}
                approvingRecordId={approvingRecordId}
              />
            </div>

            {/* Mutation error (record approve / batch approve) */}
            {mutationError && !finalizeBlockedReason && (
              <div
                data-testid="mutation-error"
                role="alert"
                className="px-4 py-3 bg-bad-bg border border-bad-fg/30 rounded-md text-bad-fg text-sm mb-4"
              >
                {mutationError}
              </div>
            )}

            {/* Finalize blocked gate reasons */}
            {finalizeBlockedReason && <FinalizeBlockedState reason={finalizeBlockedReason} />}

            {/* Batch approve + finalize actions */}
            {phase.data.run.status === 'Open' && (
              <div className="flex gap-3 mt-2">
                <Button
                  data-testid="batch-approve-button"
                  disabled={
                    batchApproving ||
                    phase.data.totals.approved < phase.data.totals.total ||
                    phase.data.totals.total === 0
                  }
                  onClick={() => void onBatchApprove(phase.data.run.id)}
                >
                  {batchApproving ? 'Approving run…' : 'Approve run'}
                </Button>
                <Button
                  data-testid="finalize-button"
                  disabled={finalizing}
                  onClick={() => void onFinalize(phase.data.run.id)}
                >
                  {finalizing ? 'Finalizing…' : 'Finalize run'}
                </Button>
              </div>
            )}
          </>
        )}

        {phase.kind === 'batch-approved' && (
          <>
            <div
              data-testid="batch-approved-state"
              role="status"
              className="bg-ok-bg border border-ok-fg/30 rounded-md p-6 mb-6 text-ok-fg"
            >
              <strong>Run approved.</strong> All records have been individually reviewed and the run
              is now approved. Proceed to finalize to hand off to payroll.
            </div>
            <div className="flex gap-3 mt-2">
              <Button
                data-testid="finalize-button"
                disabled={finalizing}
                onClick={() => void onFinalize(phase.runId)}
              >
                {finalizing ? 'Finalizing…' : 'Finalize run'}
              </Button>
            </div>
            {finalizeBlockedReason && <FinalizeBlockedState reason={finalizeBlockedReason} />}
            {mutationError && !finalizeBlockedReason && (
              <div
                data-testid="mutation-error"
                role="alert"
                className="px-4 py-3 bg-bad-bg border border-bad-fg/30 rounded-md text-bad-fg text-sm mb-4"
              >
                {mutationError}
              </div>
            )}
          </>
        )}

        {phase.kind === 'finalized' && (
          <div
            data-testid="finalized-state"
            role="status"
            className="bg-ok-bg border border-ok-fg/30 rounded-md p-6 mb-6 text-ok-fg"
          >
            <strong>Run finalized.</strong> The commission run has been finalized and is ready for
            payroll export.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommissionRunReview — container wiring real API calls
// ---------------------------------------------------------------------------

/**
 * Finance Admin commission run review container.
 *
 * Manages the multi-step workflow: start run → load queue → review/approve →
 * batch approve → finalize. Passes explicit state to CommissionRunReviewView
 * so that every UI state is exercisable via component tests with in-test data.
 */
export function CommissionRunReview({ embedded = false }: { embedded?: boolean }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  const [startSubmitting, setStartSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [batchApproving, setBatchApproving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [approvingRecordId, setApprovingRecordId] = useState<string | null>(null);
  const [finalizeBlockedReason, setFinalizeBlockedReason] = useState<FinalizeBlockedReason | null>(
    null,
  );
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function loadQueue(runId: string): Promise<void> {
    setPhase({ kind: 'loading-queue' });
    try {
      const data = await apiGet<CommissionRunQueueData>(`/commission-runs/${runId}/queue`);
      setPhase({ kind: 'queue', data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load queue';
      setPhase({ kind: 'error', message });
    }
  }

  async function handleStart(
    periodStart: string,
    periodEnd: string,
    placementIds: string[],
  ): Promise<void> {
    setStartSubmitting(true);
    setStartError(null);
    try {
      const run = await apiPost<CommissionRunInfo>('/commission-runs', {
        period_start: periodStart,
        period_end: periodEnd,
        placement_ids: placementIds,
      });
      await loadQueue(run.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start commission run';
      setStartError(message);
    } finally {
      setStartSubmitting(false);
    }
  }

  async function handleApproveRecord(runId: string, recordId: string): Promise<void> {
    setApprovingRecordId(recordId);
    setMutationError(null);
    try {
      await apiPost(`/commission-runs/${runId}/records/${recordId}/approve`, {});
      // Reload the queue to reflect the new individually_approved state.
      await loadQueue(runId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to approve record';
      setMutationError(message);
    } finally {
      setApprovingRecordId(null);
    }
  }

  async function handleLoadRun(runId: string): Promise<void> {
    await loadQueue(runId);
  }

  async function handleBatchApprove(runId: string): Promise<void> {
    setBatchApproving(true);
    setMutationError(null);
    try {
      await apiPost(`/commission-runs/${runId}/approve`, {});
      setPhase({ kind: 'batch-approved', runId });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 422) {
        const reason: FinalizeBlockedReason = (err.body as FinalizeBlockedReason | null) ?? {
          error: err.message,
        };
        setFinalizeBlockedReason(reason);
      } else {
        const message = err instanceof Error ? err.message : 'Failed to approve run';
        setMutationError(message);
      }
    } finally {
      setBatchApproving(false);
    }
  }

  async function handleFinalize(runId: string): Promise<void> {
    setFinalizing(true);
    setFinalizeBlockedReason(null);
    setMutationError(null);
    try {
      await apiPost(`/commission-runs/${runId}/finalize`, {});
      setPhase({ kind: 'finalized' });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 422) {
        const reason: FinalizeBlockedReason = (err.body as FinalizeBlockedReason | null) ?? {
          error: err.message,
        };
        setFinalizeBlockedReason(reason);
      } else {
        const message = err instanceof Error ? err.message : 'Failed to finalize run';
        setMutationError(message);
      }
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <CommissionRunReviewView
      embedded={embedded}
      phase={phase}
      onStart={handleStart}
      onLoadRun={handleLoadRun}
      onApproveRecord={handleApproveRecord}
      onBatchApprove={handleBatchApprove}
      onFinalize={handleFinalize}
      startSubmitting={startSubmitting}
      startError={startError}
      batchApproving={batchApproving}
      finalizing={finalizing}
      approvingRecordId={approvingRecordId}
      finalizeBlockedReason={finalizeBlockedReason}
      mutationError={mutationError}
    />
  );
}

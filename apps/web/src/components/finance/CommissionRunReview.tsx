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
// Shared style tokens
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '0.75rem',
  padding: '1.5rem',
  marginBottom: '1.5rem',
  fontFamily: 'system-ui, sans-serif',
};

const headingStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  color: '#111827',
  marginTop: 0,
  marginBottom: '1rem',
};

const cellStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.8125rem',
  borderBottom: '1px solid #f3f4f6',
  textAlign: 'left',
  verticalAlign: 'top',
};

const headCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  fontSize: '0.6875rem',
  letterSpacing: '0.03em',
};

const btnStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: '0.5rem',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.8125rem',
  fontWeight: 600,
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#2563eb',
  color: '#ffffff',
};

const successBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#16a34a',
  color: '#ffffff',
};

const disabledBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#e5e7eb',
  color: '#9ca3af',
  cursor: 'not-allowed',
};

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
    <div data-testid="start-run-form" style={cardStyle}>
      <h2 style={headingStyle}>Start a new commission run</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '0.75rem' }}>
          <label
            htmlFor="period-start"
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '0.25rem',
            }}
          >
            Period start
          </label>
          <input
            id="period-start"
            data-testid="period-start-input"
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            required
            style={{
              padding: '0.5rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
            }}
          />
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <label
            htmlFor="period-end"
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '0.25rem',
            }}
          >
            Period end
          </label>
          <input
            id="period-end"
            data-testid="period-end-input"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            required
            style={{
              padding: '0.5rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
            }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label
            htmlFor="placement-ids"
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '0.25rem',
            }}
          >
            Placement IDs (comma or newline separated)
          </label>
          <textarea
            id="placement-ids"
            data-testid="placement-ids-input"
            value={placementIdsText}
            onChange={(e) => setPlacementIdsText(e.target.value)}
            rows={4}
            required
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              fontSize: '0.8125rem',
              boxSizing: 'border-box',
            }}
          />
        </div>
        {error && (
          <div
            data-testid="start-run-error"
            role="alert"
            style={{
              padding: '0.75rem',
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: '0.5rem',
              color: '#b91c1c',
              fontSize: '0.875rem',
              marginBottom: '0.75rem',
            }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          data-testid="start-run-button"
          style={submitting ? disabledBtnStyle : primaryBtnStyle}
          disabled={submitting}
        >
          {submitting ? 'Starting…' : 'Start commission run'}
        </button>
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
  const styles: Record<QueueItem['queue_category'], React.CSSProperties> = {
    ready: { background: '#dbeafe', color: '#1d4ed8' },
    held: { background: '#fef9c3', color: '#854d0e' },
    exception_pending: { background: '#fee2e2', color: '#991b1b' },
    approved: { background: '#dcfce7', color: '#166534' },
  };
  const labels: Record<QueueItem['queue_category'], string> = {
    ready: 'Ready',
    held: 'Held',
    exception_pending: 'Exception pending',
    approved: 'Approved',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.6875rem',
        fontWeight: 600,
        ...styles[cat],
      }}
    >
      {labels[cat]}
    </span>
  );
}

export function QueueTable({ items, onApproveRecord, runId, approvingRecordId }: QueueTableProps) {
  if (items.length === 0) {
    return (
      <div
        data-testid="empty-queue"
        style={{
          padding: '1.25rem',
          background: '#f9fafb',
          border: '1px dashed #d1d5db',
          borderRadius: '0.5rem',
          color: '#6b7280',
          fontSize: '0.875rem',
        }}
      >
        No commission records in this run.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="queue-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={headCellStyle}>Record ID</th>
            <th style={headCellStyle}>Position</th>
            <th style={headCellStyle}>Commissionable base</th>
            <th style={headCellStyle}>Calculated amount</th>
            <th style={headCellStyle}>Hold reason</th>
            <th style={headCellStyle}>Explanation</th>
            <th style={headCellStyle}>Status</th>
            <th style={headCellStyle}>Action</th>
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
                <td style={cellStyle}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {item.commission_record_id.slice(0, 8)}…
                  </span>
                </td>
                <td style={cellStyle}>{item.position_title ?? '—'}</td>
                <td style={cellStyle}>
                  {item.gross_commission != null ? formatCurrency(item.gross_commission) : '—'}
                </td>
                <td style={cellStyle}>
                  {item.net_payable != null ? formatCurrency(item.net_payable) : '—'}
                </td>
                <td style={cellStyle}>{item.hold_reason ?? '—'}</td>
                <td style={{ ...cellStyle, maxWidth: '240px', color: '#374151' }}>
                  {item.explanation ?? '—'}
                </td>
                <td style={cellStyle}>{categoryBadge(item.queue_category)}</td>
                <td style={cellStyle}>
                  {item.individually_approved ? (
                    <span style={{ color: '#16a34a', fontSize: '0.8125rem', fontWeight: 600 }}>
                      ✓ Approved{' '}
                      {item.individually_approved_at
                        ? formatDate(item.individually_approved_at)
                        : ''}
                    </span>
                  ) : (
                    <button
                      data-testid={`approve-record-${item.commission_record_id}`}
                      style={isApproving ? disabledBtnStyle : successBtnStyle}
                      disabled={isApproving}
                      onClick={() => void onApproveRecord(runId, item.commission_record_id)}
                    >
                      {isApproving ? 'Approving…' : 'Approve'}
                    </button>
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
      style={{
        padding: '1.25rem',
        background: '#fffbeb',
        border: '1px solid #fbbf24',
        borderRadius: '0.5rem',
        marginTop: '1rem',
      }}
    >
      <p style={{ fontWeight: 600, color: '#92400e', margin: '0 0 0.5rem', fontSize: '0.9375rem' }}>
        Finalization blocked
      </p>
      <p style={{ color: '#78350f', fontSize: '0.875rem', margin: '0 0 0.5rem' }}>{reason.error}</p>
      {reason.unacknowledged_discrepancy_count != null && (
        <p
          data-testid="discrepancy-count"
          style={{ color: '#78350f', fontSize: '0.875rem', margin: '0 0 0.25rem' }}
        >
          Unacknowledged reconciliation discrepancies:{' '}
          <strong>{reason.unacknowledged_discrepancy_count}</strong>
        </p>
      )}
      {reason.unapproved_record_ids && reason.unapproved_record_ids.length > 0 && (
        <p
          data-testid="unapproved-count"
          style={{ color: '#78350f', fontSize: '0.875rem', margin: '0 0 0.25rem' }}
        >
          Records still requiring individual approval:{' '}
          <strong>{reason.unapproved_record_ids.length}</strong>
        </p>
      )}
      {reason.hint && (
        <p
          style={{
            color: '#92400e',
            fontSize: '0.8125rem',
            margin: '0.5rem 0 0',
            fontStyle: 'italic',
          }}
        >
          {reason.hint}
        </p>
      )}
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
    <div data-testid="load-run-form" style={cardStyle}>
      <h2 style={headingStyle}>Or load an existing run</h2>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}
      >
        <input
          data-testid="load-run-id-input"
          type="text"
          placeholder="Run UUID…"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
          style={{
            padding: '0.5rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            minWidth: '20rem',
          }}
        />
        <button
          type="submit"
          data-testid="load-run-queue-button"
          style={loading ? disabledBtnStyle : primaryBtnStyle}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Load run'}
        </button>
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
      style={{
        minHeight: 'calc(100vh - 3.25rem)',
        background: '#f9fafb',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <header style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            Commission run review
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
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
          <div data-testid="loading-state" style={{ ...cardStyle, color: '#6b7280' }}>
            Loading commission run queue…
          </div>
        )}

        {phase.kind === 'error' && (
          <div
            data-testid="error-state"
            role="alert"
            style={{
              ...cardStyle,
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              color: '#b91c1c',
            }}
          >
            {phase.message}
          </div>
        )}

        {phase.kind === 'queue' && (
          <>
            {/* Run summary */}
            <div data-testid="run-summary" style={cardStyle}>
              <h2 style={headingStyle}>
                Run: {phase.data.run.period_start} — {phase.data.run.period_end}
              </h2>
              <dl style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', margin: 0 }}>
                {[
                  ['Status', phase.data.run.status],
                  ['Total records', String(phase.data.totals.total)],
                  ['Ready', String(phase.data.totals.ready)],
                  ['Held', String(phase.data.totals.held)],
                  ['Exception pending', String(phase.data.totals.exception_pending)],
                  ['Approved', String(phase.data.totals.approved)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}
                  >
                    <dt
                      style={{
                        fontSize: '0.6875rem',
                        color: '#6b7280',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}
                    >
                      {label}
                    </dt>
                    <dd style={{ fontSize: '1rem', fontWeight: 700, color: '#111827', margin: 0 }}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Queue table */}
            <div style={cardStyle}>
              <h2 style={headingStyle}>Review queue</h2>
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
                style={{
                  padding: '0.75rem 1rem',
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '0.5rem',
                  color: '#b91c1c',
                  fontSize: '0.875rem',
                  marginBottom: '1rem',
                }}
              >
                {mutationError}
              </div>
            )}

            {/* Finalize blocked gate reasons */}
            {finalizeBlockedReason && <FinalizeBlockedState reason={finalizeBlockedReason} />}

            {/* Batch approve + finalize actions */}
            {phase.data.run.status === 'Open' && (
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  data-testid="batch-approve-button"
                  style={
                    batchApproving ||
                    phase.data.totals.approved < phase.data.totals.total ||
                    phase.data.totals.total === 0
                      ? disabledBtnStyle
                      : primaryBtnStyle
                  }
                  disabled={
                    batchApproving ||
                    phase.data.totals.approved < phase.data.totals.total ||
                    phase.data.totals.total === 0
                  }
                  onClick={() => void onBatchApprove(phase.data.run.id)}
                >
                  {batchApproving ? 'Approving run…' : 'Approve run'}
                </button>
                <button
                  data-testid="finalize-button"
                  style={finalizing ? disabledBtnStyle : successBtnStyle}
                  disabled={finalizing}
                  onClick={() => void onFinalize(phase.data.run.id)}
                >
                  {finalizing ? 'Finalizing…' : 'Finalize run'}
                </button>
              </div>
            )}
          </>
        )}

        {phase.kind === 'batch-approved' && (
          <>
            <div
              data-testid="batch-approved-state"
              role="status"
              style={{
                ...cardStyle,
                background: '#ecfdf5',
                border: '1px solid #6ee7b7',
                color: '#065f46',
              }}
            >
              <strong>Run approved.</strong> All records have been individually reviewed and the run
              is now approved. Proceed to finalize to hand off to payroll.
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                data-testid="finalize-button"
                style={finalizing ? disabledBtnStyle : successBtnStyle}
                disabled={finalizing}
                onClick={() => void onFinalize(phase.runId)}
              >
                {finalizing ? 'Finalizing…' : 'Finalize run'}
              </button>
            </div>
            {finalizeBlockedReason && <FinalizeBlockedState reason={finalizeBlockedReason} />}
          </>
        )}

        {phase.kind === 'finalized' && (
          <div
            data-testid="finalized-state"
            role="status"
            style={{
              ...cardStyle,
              background: '#ecfdf5',
              border: '1px solid #6ee7b7',
              color: '#065f46',
            }}
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
export function CommissionRunReview() {
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

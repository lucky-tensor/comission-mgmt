/**
 * ReconciliationReport — Finance Admin surface for running the financial
 * reconciliation report, reviewing discrepancies by bucket, and acknowledging
 * each discrepancy with a note.
 *
 * Composed of:
 *   - ReconciliationReportView  — pure presentational view (accepts explicit
 *     state props so tests render each state in real headless Chromium without
 *     any network interaction)
 *   - ReconciliationReport      — container wiring real API calls via apiClient
 *
 * API endpoints used:
 *   GET  /reconciliation?period_start=&period_end=   — fetch the report
 *   POST /reconciliation/:id/acknowledge             — acknowledge a discrepancy
 *
 * The view groups discrepancies into four buckets:
 *   - ledger_only     — in commission ledger, not in financial system
 *   - system_only     — in financial system, not in commission ledger
 *   - amount_mismatch — present in both but amounts differ
 *   - date_gap        — present in both but issue dates differ significantly
 *
 * A summary banner shows the unacknowledged count; when it reaches zero the
 * "clear / finalize-eligible" state renders.
 *
 * CSRF: mutations go through apiPost which attaches the double-submit header.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.8
 * Issue: feat: Finance Admin UI — financial reconciliation report (#106)
 */

import { useState, useEffect } from 'react';
import { ApiError, apiGet, apiPost } from '../../lib/apiClient';
import { formatDate } from '../../lib/format';

/**
 * Current period default — last 30 days through today. The UX review
 * (docs/ux-review.md §3) wants users to land on information, not an empty form,
 * so Reconciliation loads this range on mount with the form acting as a filter.
 */
export function currentPeriodRange(): { start: string; end: string } {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Types for API response shapes
// ---------------------------------------------------------------------------

export interface ReconciliationDiscrepancy {
  id: string;
  org_id: string;
  period_start: string;
  period_end: string;
  discrepancy_type: 'ledger_only' | 'system_only' | 'amount_mismatch' | 'date_gap';
  invoice_id: string | null;
  invoice_number: string | null;
  ledger_amount_billed: string | null;
  ar_amount_billed: string | null;
  ledger_issued_at: string | null;
  ar_billed_date: string | null;
  date_gap_days: number | null;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  acknowledged_note: string | null;
  created_at: string;
}

export interface MatchedInvoice {
  invoice_number: string;
  ledger_amount_billed: string;
}

export interface ReconciliationSummary {
  total_ledger_invoices: number;
  total_ar_records: number;
  matched: number;
  discrepancies: number;
  unacknowledged: number;
}

export interface ReconciliationReportData {
  period_start: string;
  period_end: string;
  summary: ReconciliationSummary;
  matched: MatchedInvoice[];
  discrepancies: ReconciliationDiscrepancy[];
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

const btnStyle: React.CSSProperties = {
  padding: '0.375rem 0.75rem',
  borderRadius: '0.375rem',
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

const disabledBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#e5e7eb',
  color: '#9ca3af',
  cursor: 'not-allowed',
};

// ---------------------------------------------------------------------------
// PeriodForm — inputs for period_start / period_end
// ---------------------------------------------------------------------------

export interface PeriodFormProps {
  onFetch: (periodStart: string, periodEnd: string) => Promise<void>;
  fetching: boolean;
  error: string | null;
}

export function PeriodForm({ onFetch, fetching, error }: PeriodFormProps) {
  const defaults = currentPeriodRange();
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void onFetch(periodStart, periodEnd);
  }

  return (
    <div data-testid="period-form" style={cardStyle}>
      <h2 style={headingStyle}>Run reconciliation report</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label
              htmlFor="recon-period-start"
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
              id="recon-period-start"
              data-testid="recon-period-start-input"
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
          <div>
            <label
              htmlFor="recon-period-end"
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
              id="recon-period-end"
              data-testid="recon-period-end-input"
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
          <button
            type="submit"
            data-testid="recon-fetch-button"
            style={fetching ? disabledBtnStyle : primaryBtnStyle}
            disabled={fetching}
          >
            {fetching ? 'Loading…' : 'Run report'}
          </button>
        </div>
        {error && (
          <div
            data-testid="recon-fetch-error"
            role="alert"
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: '0.5rem',
              color: '#b91c1c',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiscrepancyBucket — renders one type of discrepancy rows
// ---------------------------------------------------------------------------

const BUCKET_META: Record<
  ReconciliationDiscrepancy['discrepancy_type'],
  { label: string; color: string; bg: string }
> = {
  ledger_only: { label: 'Ledger only', color: '#1e40af', bg: '#dbeafe' },
  system_only: { label: 'System only', color: '#7c3aed', bg: '#ede9fe' },
  amount_mismatch: { label: 'Amount mismatch', color: '#b45309', bg: '#fef3c7' },
  date_gap: { label: 'Timing gap', color: '#6b7280', bg: '#f3f4f6' },
};

export interface AcknowledgeFormProps {
  discrepancyId: string;
  onAcknowledge: (id: string, note: string) => Promise<void>;
  acknowledging: boolean;
  acknowledgeError: string | null;
}

function AcknowledgeForm({
  discrepancyId,
  onAcknowledge,
  acknowledging,
  acknowledgeError,
}: AcknowledgeFormProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onAcknowledge(discrepancyId, note);
    setOpen(false);
    setNote('');
  }

  return (
    <div>
      {!open && (
        <button
          data-testid={`acknowledge-btn-${discrepancyId}`}
          onClick={() => setOpen(true)}
          style={primaryBtnStyle}
        >
          Acknowledge
        </button>
      )}
      {open && (
        <div
          data-testid={`acknowledge-form-${discrepancyId}`}
          style={{
            marginTop: '0.5rem',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
            padding: '0.75rem',
          }}
        >
          <form onSubmit={(e) => void handleSubmit(e)}>
            <label
              htmlFor={`note-${discrepancyId}`}
              style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 600,
                marginBottom: '0.25rem',
              }}
            >
              Acknowledgement note
            </label>
            <textarea
              id={`note-${discrepancyId}`}
              data-testid={`acknowledge-note-${discrepancyId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              required
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '0.375rem 0.5rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                fontSize: '0.8125rem',
                marginBottom: '0.5rem',
              }}
            />
            {acknowledgeError && (
              <div
                data-testid={`acknowledge-error-${discrepancyId}`}
                role="alert"
                style={{ color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '0.5rem' }}
              >
                {acknowledgeError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="submit"
                data-testid={`acknowledge-save-${discrepancyId}`}
                style={acknowledging ? disabledBtnStyle : primaryBtnStyle}
                disabled={acknowledging}
              >
                {acknowledging ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setNote('');
                }}
                style={{ ...btnStyle, background: '#f3f4f6', color: '#374151' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export interface DiscrepancyRowProps {
  discrepancy: ReconciliationDiscrepancy;
  onAcknowledge: (id: string, note: string) => Promise<void>;
  acknowledging: boolean;
  acknowledgeError: string | null;
}

function DiscrepancyRow({
  discrepancy,
  onAcknowledge,
  acknowledging,
  acknowledgeError,
}: DiscrepancyRowProps) {
  const meta = BUCKET_META[discrepancy.discrepancy_type];
  return (
    <div
      data-testid={`discrepancy-row-${discrepancy.id}`}
      style={{
        borderBottom: '1px solid #f3f4f6',
        padding: '0.875rem 0',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span
              data-testid={`discrepancy-type-badge-${discrepancy.id}`}
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                padding: '0.125rem 0.5rem',
                borderRadius: '9999px',
                background: meta.bg,
                color: meta.color,
              }}
            >
              {meta.label}
            </span>
            {discrepancy.invoice_number && (
              <span style={{ fontSize: '0.8125rem', color: '#374151', fontFamily: 'monospace' }}>
                {discrepancy.invoice_number}
              </span>
            )}
            {discrepancy.acknowledged && (
              <span
                data-testid={`acknowledged-badge-${discrepancy.id}`}
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  padding: '0.125rem 0.5rem',
                  borderRadius: '9999px',
                  background: '#dcfce7',
                  color: '#166534',
                }}
              >
                Acknowledged
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: '0.375rem',
              fontSize: '0.8125rem',
              color: '#6b7280',
              display: 'flex',
              gap: '1.5rem',
              flexWrap: 'wrap',
            }}
          >
            {discrepancy.ledger_amount_billed != null && (
              <span>
                Ledger:{' '}
                <strong style={{ color: '#111827' }}>{discrepancy.ledger_amount_billed}</strong>
              </span>
            )}
            {discrepancy.ar_amount_billed != null && (
              <span>
                AR: <strong style={{ color: '#111827' }}>{discrepancy.ar_amount_billed}</strong>
              </span>
            )}
            {discrepancy.date_gap_days != null && (
              <span>
                Date gap:{' '}
                <strong style={{ color: '#111827' }}>{discrepancy.date_gap_days} days</strong>
              </span>
            )}
            {discrepancy.ledger_issued_at && (
              <span>
                Ledger date:{' '}
                <strong style={{ color: '#111827' }}>
                  {formatDate(discrepancy.ledger_issued_at)}
                </strong>
              </span>
            )}
            {discrepancy.ar_billed_date && (
              <span>
                AR date:{' '}
                <strong style={{ color: '#111827' }}>
                  {formatDate(discrepancy.ar_billed_date)}
                </strong>
              </span>
            )}
          </div>
          {discrepancy.acknowledged && discrepancy.acknowledged_note && (
            <div
              data-testid={`acknowledged-note-${discrepancy.id}`}
              style={{
                marginTop: '0.375rem',
                fontSize: '0.8125rem',
                color: '#374151',
                fontStyle: 'italic',
              }}
            >
              Note: {discrepancy.acknowledged_note}
            </div>
          )}
          {discrepancy.acknowledged && discrepancy.acknowledged_at && (
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.125rem' }}>
              Acknowledged {formatDate(discrepancy.acknowledged_at)}
            </div>
          )}
        </div>
        {!discrepancy.acknowledged && (
          <div style={{ marginLeft: '1rem', flexShrink: 0 }}>
            <AcknowledgeForm
              discrepancyId={discrepancy.id}
              onAcknowledge={onAcknowledge}
              acknowledging={acknowledging}
              acknowledgeError={acknowledgeError}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface BucketCardProps {
  type: ReconciliationDiscrepancy['discrepancy_type'];
  discrepancies: ReconciliationDiscrepancy[];
  onAcknowledge: (id: string, note: string) => Promise<void>;
  acknowledgingId: string | null;
  acknowledgeErrors: Record<string, string>;
}

function BucketCard({
  type,
  discrepancies,
  onAcknowledge,
  acknowledgingId,
  acknowledgeErrors,
}: BucketCardProps) {
  const meta = BUCKET_META[type];
  const typeTestId = type.replace(/_/g, '-');
  return (
    <div
      data-testid={`bucket-${typeTestId}`}
      style={{
        ...cardStyle,
        borderLeft: `3px solid ${meta.color}`,
      }}
    >
      <h3
        style={{
          fontSize: '1rem',
          fontWeight: 600,
          color: '#111827',
          marginTop: 0,
          marginBottom: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        {meta.label}
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '0.125rem 0.5rem',
            borderRadius: '9999px',
            background: meta.bg,
            color: meta.color,
          }}
        >
          {discrepancies.length}
        </span>
      </h3>
      {discrepancies.length === 0 ? (
        <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>None for this period.</div>
      ) : (
        <div data-testid={`bucket-${typeTestId}-list`}>
          {discrepancies.map((d) => (
            <DiscrepancyRow
              key={d.id}
              discrepancy={d}
              onAcknowledge={onAcknowledge}
              acknowledging={acknowledgingId === d.id}
              acknowledgeError={acknowledgeErrors[d.id] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReconciliationReportView — pure presentational component
// ---------------------------------------------------------------------------

export type ReportPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'data'; report: ReconciliationReportData };

export interface ReconciliationReportViewProps {
  phase: ReportPhase;
  onFetch: (periodStart: string, periodEnd: string) => Promise<void>;
  onAcknowledge: (id: string, note: string) => Promise<void>;
  fetching: boolean;
  fetchError: string | null;
  acknowledgingId: string | null;
  acknowledgeErrors: Record<string, string>;
  unacknowledgedCount: number;
}

export function ReconciliationReportView({
  phase,
  onFetch,
  onAcknowledge,
  fetching,
  fetchError,
  acknowledgingId,
  acknowledgeErrors,
  unacknowledgedCount,
}: ReconciliationReportViewProps) {
  return (
    <div
      data-testid="reconciliation-report"
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
            Financial Reconciliation Report
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
            Compare the commission ledger against the financial system of record. Acknowledge all
            discrepancies to unblock run finalization.
          </p>
        </header>

        <PeriodForm onFetch={onFetch} fetching={fetching} error={fetchError} />

        {phase.kind === 'loading' && (
          <div data-testid="recon-loading-state" style={{ ...cardStyle, color: '#6b7280' }}>
            Loading reconciliation report…
          </div>
        )}

        {phase.kind === 'error' && (
          <div
            data-testid="recon-error-state"
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

        {phase.kind === 'data' && (
          <>
            {/* Summary banner */}
            <div data-testid="recon-summary" style={cardStyle}>
              <h2 style={headingStyle}>
                Period: {phase.report.period_start} — {phase.report.period_end}
              </h2>
              <dl style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', margin: '0 0 1rem' }}>
                {[
                  ['Ledger invoices', String(phase.report.summary.total_ledger_invoices)],
                  ['AR records', String(phase.report.summary.total_ar_records)],
                  ['Matched', String(phase.report.summary.matched)],
                  ['Discrepancies', String(phase.report.summary.discrepancies)],
                  ['Unacknowledged', String(unacknowledgedCount)],
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
                    <dd
                      data-testid={
                        label === 'Unacknowledged' ? 'recon-unacknowledged-count' : undefined
                      }
                      style={{
                        fontSize: '1rem',
                        fontWeight: 700,
                        color:
                          label === 'Unacknowledged' && unacknowledgedCount > 0
                            ? '#b91c1c'
                            : '#111827',
                        margin: 0,
                      }}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* All-clear state */}
              {unacknowledgedCount === 0 && phase.report.summary.discrepancies > 0 && (
                <div
                  data-testid="recon-all-clear"
                  role="status"
                  style={{
                    padding: '0.75rem 1rem',
                    background: '#ecfdf5',
                    border: '1px solid #6ee7b7',
                    borderRadius: '0.5rem',
                    color: '#065f46',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                  }}
                >
                  All discrepancies acknowledged — run finalization is unblocked.
                </div>
              )}

              {/* Clean reconciliation (no discrepancies at all) */}
              {phase.report.summary.discrepancies === 0 && (
                <div
                  data-testid="recon-clean"
                  role="status"
                  style={{
                    padding: '0.75rem 1rem',
                    background: '#ecfdf5',
                    border: '1px solid #6ee7b7',
                    borderRadius: '0.5rem',
                    color: '#065f46',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                  }}
                >
                  No discrepancies found — ledger and financial system are in agreement.
                </div>
              )}
            </div>

            {/* Four discrepancy buckets */}
            {(['ledger_only', 'system_only', 'amount_mismatch', 'date_gap'] as const).map(
              (type) => (
                <BucketCard
                  key={type}
                  type={type}
                  discrepancies={phase.report.discrepancies.filter(
                    (d) => d.discrepancy_type === type,
                  )}
                  onAcknowledge={onAcknowledge}
                  acknowledgingId={acknowledgingId}
                  acknowledgeErrors={acknowledgeErrors}
                />
              ),
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReconciliationReport — container wiring real API calls
// ---------------------------------------------------------------------------

/**
 * Finance Admin reconciliation report container.
 *
 * Manages the workflow: enter period → fetch report → acknowledge discrepancies.
 * Passes explicit state to ReconciliationReportView so every UI state is
 * exercisable via component tests with in-test data.
 */
export function ReconciliationReport() {
  const [phase, setPhase] = useState<ReportPhase>({ kind: 'idle' });
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [acknowledgeErrors, setAcknowledgeErrors] = useState<Record<string, string>>({});

  // Track live unacknowledged count — starts from the report summary, decremented on ACK.
  const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);

  async function handleFetch(periodStart: string, periodEnd: string): Promise<void> {
    setFetching(true);
    setFetchError(null);
    setPhase({ kind: 'loading' });
    setAcknowledgeErrors({});
    try {
      const report = await apiGet<ReconciliationReportData>(
        `/reconciliation?period_start=${encodeURIComponent(periodStart)}&period_end=${encodeURIComponent(periodEnd)}`,
      );
      setPhase({ kind: 'data', report });
      setUnacknowledgedCount(report.summary.unacknowledged);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load reconciliation report';
      setPhase({ kind: 'error', message });
      setFetchError(message);
    } finally {
      setFetching(false);
    }
  }

  // Data-first (#203): load the current period immediately on mount; the date
  // form acts as a filter rather than a gate.
  useEffect(() => {
    const { start, end } = currentPeriodRange();
    void handleFetch(start, end);
  }, []);

  async function handleAcknowledge(id: string, note: string): Promise<void> {
    setAcknowledgingId(id);
    setAcknowledgeErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const updated = await apiPost<ReconciliationDiscrepancy>(
        `/reconciliation/${id}/acknowledge`,
        {
          note,
        },
      );
      // Update the discrepancy in the report in-place
      setPhase((prev) => {
        if (prev.kind !== 'data') return prev;
        return {
          kind: 'data',
          report: {
            ...prev.report,
            discrepancies: prev.report.discrepancies.map((d) =>
              d.id === id ? { ...d, ...updated } : d,
            ),
          },
        };
      });
      setUnacknowledgedCount((c) => Math.max(0, c - 1));
    } catch (err: unknown) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Acknowledge failed';
      setAcknowledgeErrors((prev) => ({ ...prev, [id]: message }));
    } finally {
      setAcknowledgingId(null);
    }
  }

  return (
    <ReconciliationReportView
      phase={phase}
      onFetch={handleFetch}
      onAcknowledge={handleAcknowledge}
      fetching={fetching}
      fetchError={fetchError}
      acknowledgingId={acknowledgingId}
      acknowledgeErrors={acknowledgeErrors}
      unacknowledgedCount={unacknowledgedCount}
    />
  );
}

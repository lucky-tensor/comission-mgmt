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
import { Button } from 'ui';
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
// Shared style tokens — Tailwind class strings (theme tokens, no raw hex)
// ---------------------------------------------------------------------------

const CARD_CLASS = 'bg-surface border border-border rounded-md p-6 mb-6';

const HEADING_CLASS = 'text-lg font-semibold text-ink mt-0 mb-4';

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
    <div data-testid="period-form" className={CARD_CLASS}>
      <h2 className={HEADING_CLASS}>Run reconciliation report</h2>
      <form onSubmit={handleSubmit}>
        <div className="flex gap-4 flex-wrap items-end">
          <div>
            <label htmlFor="recon-period-start" className="block text-sm font-semibold mb-1">
              Period start
            </label>
            <input
              id="recon-period-start"
              data-testid="recon-period-start-input"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              required
              className="p-2 border border-border-strong rounded-md text-sm"
            />
          </div>
          <div>
            <label htmlFor="recon-period-end" className="block text-sm font-semibold mb-1">
              Period end
            </label>
            <input
              id="recon-period-end"
              data-testid="recon-period-end-input"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              required
              className="p-2 border border-border-strong rounded-md text-sm"
            />
          </div>
          <Button type="submit" data-testid="recon-fetch-button" disabled={fetching}>
            {fetching ? 'Loading…' : 'Run report'}
          </Button>
        </div>
        {error && (
          <div
            data-testid="recon-fetch-error"
            role="alert"
            className="mt-3 p-3 bg-bad-bg border border-bad-fg/30 rounded-md text-bad-fg text-sm"
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
  { label: string; chip: string; border: string }
> = {
  // Blue/purple buckets are neutralized to the slate palette per the reskin spec.
  ledger_only: {
    label: 'Ledger only',
    chip: 'bg-surface-sunken text-ink-muted',
    border: 'border-l-border-strong',
  },
  system_only: {
    label: 'System only',
    chip: 'bg-surface-sunken text-ink-muted',
    border: 'border-l-border-strong',
  },
  amount_mismatch: {
    label: 'Amount mismatch',
    chip: 'bg-warn-bg text-warn-fg',
    border: 'border-l-warn-fg/40',
  },
  date_gap: {
    label: 'Timing gap',
    chip: 'bg-neutral-bg text-neutral-fg',
    border: 'border-l-border-strong',
  },
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
        <Button data-testid={`acknowledge-btn-${discrepancyId}`} onClick={() => setOpen(true)}>
          Acknowledge
        </Button>
      )}
      {open && (
        <div
          data-testid={`acknowledge-form-${discrepancyId}`}
          className="mt-2 bg-surface-muted border border-border rounded-md p-3"
        >
          <form onSubmit={(e) => void handleSubmit(e)}>
            <label htmlFor={`note-${discrepancyId}`} className="block text-sm font-semibold mb-1">
              Acknowledgement note
            </label>
            <textarea
              id={`note-${discrepancyId}`}
              data-testid={`acknowledge-note-${discrepancyId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              required
              className="w-full box-border px-2 py-1.5 border border-border-strong rounded-md text-sm mb-2"
            />
            {acknowledgeError && (
              <div
                data-testid={`acknowledge-error-${discrepancyId}`}
                role="alert"
                className="text-bad-fg text-sm mb-2"
              >
                {acknowledgeError}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                data-testid={`acknowledge-save-${discrepancyId}`}
                disabled={acknowledging}
              >
                {acknowledging ? 'Saving…' : 'Save'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  setNote('');
                }}
              >
                Cancel
              </Button>
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
      className="border-b border-surface-sunken py-3.5"
    >
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              data-testid={`discrepancy-type-badge-${discrepancy.id}`}
              className={`text-xs font-semibold px-2 py-0.5 rounded-xs ${meta.chip}`}
            >
              {meta.label}
            </span>
            {discrepancy.invoice_number && (
              <span className="text-sm text-ink-muted font-mono">{discrepancy.invoice_number}</span>
            )}
            {discrepancy.acknowledged && (
              <span
                data-testid={`acknowledged-badge-${discrepancy.id}`}
                className="text-xs font-semibold px-2 py-0.5 rounded-xs bg-ok-bg text-ok-fg"
              >
                Acknowledged
              </span>
            )}
          </div>
          <div className="mt-1.5 text-sm text-ink-subtle flex gap-6 flex-wrap">
            {discrepancy.ledger_amount_billed != null && (
              <span>
                Ledger: <strong className="text-ink">{discrepancy.ledger_amount_billed}</strong>
              </span>
            )}
            {discrepancy.ar_amount_billed != null && (
              <span>
                AR: <strong className="text-ink">{discrepancy.ar_amount_billed}</strong>
              </span>
            )}
            {discrepancy.date_gap_days != null && (
              <span>
                Date gap: <strong className="text-ink">{discrepancy.date_gap_days} days</strong>
              </span>
            )}
            {discrepancy.ledger_issued_at && (
              <span>
                Ledger date:{' '}
                <strong className="text-ink">{formatDate(discrepancy.ledger_issued_at)}</strong>
              </span>
            )}
            {discrepancy.ar_billed_date && (
              <span>
                AR date:{' '}
                <strong className="text-ink">{formatDate(discrepancy.ar_billed_date)}</strong>
              </span>
            )}
          </div>
          {discrepancy.acknowledged && discrepancy.acknowledged_note && (
            <div
              data-testid={`acknowledged-note-${discrepancy.id}`}
              className="mt-1.5 text-sm text-ink-muted italic"
            >
              Note: {discrepancy.acknowledged_note}
            </div>
          )}
          {discrepancy.acknowledged && discrepancy.acknowledged_at && (
            <div className="text-xs text-ink-subtle mt-0.5">
              Acknowledged {formatDate(discrepancy.acknowledged_at)}
            </div>
          )}
        </div>
        {!discrepancy.acknowledged && (
          <div className="ml-4 shrink-0">
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
    <div data-testid={`bucket-${typeTestId}`} className={`${CARD_CLASS} border-l-2 ${meta.border}`}>
      <h3 className="text-base font-semibold text-ink mt-0 mb-3 flex items-center gap-2">
        {meta.label}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-xs ${meta.chip}`}>
          {discrepancies.length}
        </span>
      </h3>
      {discrepancies.length === 0 ? (
        <div className="text-sm text-ink-subtle">None for this period.</div>
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
  embedded?: boolean;
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
  embedded = false,
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
      data-embedded={embedded ? 'true' : 'false'}
      className={embedded ? '' : 'min-h-surface bg-surface-muted px-4 py-8'}
    >
      <div className={embedded ? '' : 'max-w-report mx-auto'}>
        <header className="mb-8">
          <h2
            className={`${embedded ? 'text-lg' : 'text-xl'} font-semibold tracking-tight text-ink m-0`}
          >
            Financial Reconciliation Report
          </h2>
          <p className="text-sm text-ink-subtle mt-1 mb-0">
            Compare the commission ledger against the financial system of record. Acknowledge all
            discrepancies to unblock run finalization.
          </p>
        </header>

        <PeriodForm onFetch={onFetch} fetching={fetching} error={fetchError} />

        {phase.kind === 'loading' && (
          <div data-testid="recon-loading-state" className={`${CARD_CLASS} text-ink-subtle`}>
            Loading reconciliation report…
          </div>
        )}

        {phase.kind === 'error' && (
          <div
            data-testid="recon-error-state"
            role="alert"
            className="bg-bad-bg border border-bad-fg/30 rounded-md p-6 mb-6 text-bad-fg"
          >
            {phase.message}
          </div>
        )}

        {phase.kind === 'data' && (
          <>
            {/* Summary banner */}
            <div data-testid="recon-summary" className={CARD_CLASS}>
              <h2 className={HEADING_CLASS}>
                Period: {phase.report.period_start} — {phase.report.period_end}
              </h2>
              <dl className="flex gap-8 flex-wrap m-0 mb-4">
                {[
                  ['Ledger invoices', String(phase.report.summary.total_ledger_invoices)],
                  ['AR records', String(phase.report.summary.total_ar_records)],
                  ['Matched', String(phase.report.summary.matched)],
                  ['Discrepancies', String(phase.report.summary.discrepancies)],
                  ['Unacknowledged', String(unacknowledgedCount)],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <dt className="text-xs text-ink-subtle font-semibold uppercase">{label}</dt>
                    <dd
                      data-testid={
                        label === 'Unacknowledged' ? 'recon-unacknowledged-count' : undefined
                      }
                      className={`text-base font-bold m-0 ${
                        label === 'Unacknowledged' && unacknowledgedCount > 0
                          ? 'text-bad-fg'
                          : 'text-ink'
                      }`}
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
                  className="px-4 py-3 bg-ok-bg border border-ok-fg/30 rounded-md text-ok-fg text-sm font-semibold"
                >
                  All discrepancies acknowledged — run finalization is unblocked.
                </div>
              )}

              {/* Clean reconciliation (no discrepancies at all) */}
              {phase.report.summary.discrepancies === 0 && (
                <div
                  data-testid="recon-clean"
                  role="status"
                  className="px-4 py-3 bg-ok-bg border border-ok-fg/30 rounded-md text-ok-fg text-sm font-semibold"
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
export function ReconciliationReport({ embedded = false }: { embedded?: boolean }) {
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
      embedded={embedded}
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

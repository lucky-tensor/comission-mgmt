/**
 * AdjustmentLedger — Finance Admin view of the append-only clawback/holdback
 * adjustment ledger for a placement.
 *
 * Renders:
 *   - All entries from GET /placements/:id/clawback (newest-first)
 *   - Recovery schedule, where one applies
 *   - A form to post a new clawback/holdback adjustment with a required reason
 *     (rule); no edit or delete affordances on existing entries
 *
 * Out of scope (noted inline): generic refund/credit-memo adjustments
 * require a backend endpoint that does not exist yet.
 *
 * Pure-view / container split mirrors the Producer Portal pattern.
 * The container accepts injectable fetch functions for testability —
 * real async calls, never mock objects (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.6, §9 (Audit)
 * Issue: feat: Finance Admin UI — adjustment ledger (clawback/holdback, append-only) (#104)
 */

import { useState } from 'react';
import { Button } from 'ui';
import { apiGet, apiPost } from '../../lib/apiClient';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import { formatCurrency, formatDate } from '../../lib/format';
import { PortalCard, LoadingState, ErrorState, EmptyState } from '../portal/states';
import {
  CLAWBACK_EVENT_TYPES,
  CLAWBACK_RULES,
  type ClawbackEventType,
  type ClawbackRule,
} from 'core/clawback-ledger';

// ---------------------------------------------------------------------------
// Types mirroring the GET /placements/:id/clawback response
// ---------------------------------------------------------------------------

export interface ClawbackEventSummary {
  id: string;
  event_type: ClawbackEventType;
  rule: ClawbackRule;
  occurred_at: string;
  triggered_by: string;
  created_at: string;
}

export interface AdjustmentEntry {
  id: string;
  commission_record_id: string;
  amount_delta: number | string;
  reason_code: ClawbackRule;
  adjusted_by: string;
  adjusted_at: string;
  recovered: boolean;
}

export interface RecoveryScheduleEntry {
  id: string;
  commission_record_id: string;
  clawback_amount: number | string;
  installment_count: number;
  installment_amount: number | string;
  created_at: string;
}

export interface PlacementClawbackStatus {
  placement_id: string;
  clawback_event: ClawbackEventSummary | null;
  adjustments: AdjustmentEntry[];
  recovery_schedules: RecoveryScheduleEntry[];
}

export interface TriggerClawbackBody {
  event_type: ClawbackEventType;
  rule: ClawbackRule;
  occurred_at?: string;
  installment_count?: number;
}

export interface TriggerClawbackResult {
  clawback_event_id: string;
  placement_id: string;
  event_type: ClawbackEventType;
  rule: ClawbackRule;
  occurred_at: string;
  commission_records_affected: number;
}

// ---------------------------------------------------------------------------
// Styles — Tailwind class strings (theme tokens, no raw hex)
// ---------------------------------------------------------------------------

const TABLE_CLASS = 'w-full border-collapse text-[0.8125rem]';

const TH_CLASS =
  'text-left px-3 py-2 bg-surface-sunken text-ink-muted font-semibold border-b-2 border-border';

const TD_CLASS = 'px-3 py-2.5 border-b border-surface-sunken text-ink-muted';

const FIELD_CLASS =
  'w-full px-3 py-2 border border-border-strong rounded-md text-sm box-border mb-3';

const LABEL_CLASS = 'block text-[0.8125rem] text-ink-muted mb-1';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventSummaryBanner({ event }: { event: ClawbackEventSummary }) {
  return (
    <div
      data-testid="clawback-event-banner"
      className="px-4 py-3.5 bg-warn-bg border border-warn-fg/30 rounded-lg text-sm text-warn-fg mb-4"
    >
      <strong>Clawback triggered</strong> — {event.event_type}, rule: <strong>{event.rule}</strong>,
      occurred {formatDate(event.occurred_at)}, triggered by{' '}
      <code className="text-xs">{event.triggered_by}</code>
    </div>
  );
}

/** Read-only table of all adjustment entries — no edit or delete affordances. */
function AdjustmentTable({ adjustments }: { adjustments: AdjustmentEntry[] }) {
  return (
    <table className={TABLE_CLASS} data-testid="adjustment-table">
      <thead>
        <tr>
          <th className={TH_CLASS}>Commission Record</th>
          <th className={TH_CLASS}>Amount</th>
          <th className={TH_CLASS}>Reason</th>
          <th className={TH_CLASS}>Actor</th>
          <th className={TH_CLASS}>Date</th>
          <th className={TH_CLASS}>Recovered</th>
        </tr>
      </thead>
      <tbody>
        {adjustments.map((a) => (
          <tr key={a.id} data-testid="adjustment-row">
            <td className={TD_CLASS}>
              <code className="text-xs">{a.commission_record_id.slice(0, 8)}…</code>
            </td>
            <td className={`${TD_CLASS} text-bad-fg font-semibold`}>
              {formatCurrency(a.amount_delta)}
            </td>
            <td className={TD_CLASS}>{a.reason_code}</td>
            <td className={TD_CLASS}>
              <code className="text-xs">{a.adjusted_by.slice(0, 8)}…</code>
            </td>
            <td className={TD_CLASS}>{formatDate(a.adjusted_at)}</td>
            <td className={TD_CLASS}>{a.recovered ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Read-only recovery schedule table — no edit or delete affordances. */
function RecoveryScheduleTable({ schedules }: { schedules: RecoveryScheduleEntry[] }) {
  if (schedules.length === 0) return null;
  return (
    <PortalCard title="Recovery schedule">
      <table className={TABLE_CLASS} data-testid="recovery-schedule-table">
        <thead>
          <tr>
            <th className={TH_CLASS}>Commission Record</th>
            <th className={TH_CLASS}>Total</th>
            <th className={TH_CLASS}>Installments</th>
            <th className={TH_CLASS}>Per Installment</th>
            <th className={TH_CLASS}>Created</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr key={s.id} data-testid="recovery-schedule-row">
              <td className={TD_CLASS}>
                <code className="text-xs">{s.commission_record_id.slice(0, 8)}…</code>
              </td>
              <td className={TD_CLASS}>{formatCurrency(s.clawback_amount)}</td>
              <td className={TD_CLASS}>{s.installment_count}</td>
              <td className={TD_CLASS}>{formatCurrency(s.installment_amount)}</td>
              <td className={TD_CLASS}>{formatDate(s.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// TriggerForm — post a new adjustment (append-only, no edit of prior rows)
// ---------------------------------------------------------------------------

/**
 * Form to post a new clawback/holdback trigger.
 *
 * Note: generic refund and credit-memo adjustments are out of scope for this
 * surface — there is no dedicated backend endpoint today. A backend issue must
 * precede that sub-scope.
 *
 * @param placementId - placement UUID the adjustment applies to
 * @param onSuccess   - called with the trigger result after a successful POST
 * @param onTrigger   - injectable POST handler for testing (real async call, no mocks)
 */
export function TriggerForm({
  placementId,
  onSuccess,
  onTrigger = (pid, body) =>
    apiPost<TriggerClawbackResult>(`/placements/${pid}/guarantee/trigger`, body),
}: {
  placementId: string;
  onSuccess: (result: TriggerClawbackResult) => void;
  onTrigger?: (placementId: string, body: TriggerClawbackBody) => Promise<TriggerClawbackResult>;
}) {
  const [eventType, setEventType] = useState<ClawbackEventType>(CLAWBACK_EVENT_TYPES[0]);
  const [rule, setRule] = useState<ClawbackRule>(CLAWBACK_RULES[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await onTrigger(placementId, {
        event_type: eventType,
        rule,
        occurred_at: new Date().toISOString(),
      });
      onSuccess(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to post adjustment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PortalCard title="Post new adjustment">
      <p className="text-[0.8125rem] text-ink-subtle mt-0 mb-4" data-testid="refund-credit-note">
        Clawback and holdback adjustments only. Refund and credit-memo entry requires backend
        support not yet available.
      </p>
      <form data-testid="trigger-form" onSubmit={handleSubmit}>
        <label className={LABEL_CLASS}>
          Event type (required)
          <select
            data-testid="trigger-event-type"
            className={FIELD_CLASS}
            value={eventType}
            onChange={(e) => setEventType(e.target.value as ClawbackEventType)}
          >
            {CLAWBACK_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          Reason / rule (required)
          <select
            data-testid="trigger-rule"
            className={FIELD_CLASS}
            value={rule}
            onChange={(e) => setRule(e.target.value as ClawbackRule)}
          >
            {CLAWBACK_RULES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <div
            data-testid="trigger-error"
            role="alert"
            className="text-bad-fg text-[0.8125rem] mb-3"
          >
            {error}
          </div>
        )}
        <Button
          type="submit"
          variant="destructive"
          data-testid="trigger-submit"
          disabled={submitting}
        >
          {submitting ? 'Posting…' : 'Post adjustment'}
        </Button>
      </form>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// AdjustmentLedgerView — pure presentational component
// ---------------------------------------------------------------------------

export interface AdjustmentLedgerViewProps {
  placementId: string;
  state: AsyncState<PlacementClawbackStatus>;
  /** Called after a successful trigger to reload the ledger. */
  onTriggerSuccess: (result: TriggerClawbackResult) => void;
  /** Injectable trigger handler (real async call, no mocks). */
  onTrigger?: (placementId: string, body: TriggerClawbackBody) => Promise<TriggerClawbackResult>;
}

/**
 * Pure presentational view for the adjustment ledger.
 * Renders loading/error/empty or the data surface with the append-only ledger.
 */
export function AdjustmentLedgerView({
  placementId,
  state,
  onTriggerSuccess,
  onTrigger,
}: AdjustmentLedgerViewProps) {
  if (state.loading) {
    return (
      <div data-testid="adjustment-ledger">
        <LoadingState label="adjustment ledger" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div data-testid="adjustment-ledger">
        <ErrorState message={state.error} />
      </div>
    );
  }

  if (!state.data) {
    return (
      <div data-testid="adjustment-ledger">
        <EmptyState message="No clawback data found for this placement." />
      </div>
    );
  }

  const { clawback_event, adjustments, recovery_schedules } = state.data;

  // Sort adjustments newest-first
  const sorted = [...adjustments].sort(
    (a, b) => new Date(b.adjusted_at).getTime() - new Date(a.adjusted_at).getTime(),
  );

  return (
    <div data-testid="adjustment-ledger">
      {clawback_event && <EventSummaryBanner event={clawback_event} />}

      <PortalCard title="Adjustment ledger">
        {sorted.length === 0 ? (
          <EmptyState message="No adjustments posted yet for this placement." />
        ) : (
          <AdjustmentTable adjustments={sorted} />
        )}
      </PortalCard>

      <RecoveryScheduleTable schedules={recovery_schedules} />

      <TriggerForm placementId={placementId} onSuccess={onTriggerSuccess} onTrigger={onTrigger} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdjustmentLedger — container (fetches data, renders view)
// ---------------------------------------------------------------------------

/**
 * Finance Admin adjustment ledger container for a given placement.
 *
 * Fetches GET /placements/:id/clawback on mount and after each successful trigger.
 *
 * @param placementId - the placement UUID to display
 */
export function AdjustmentLedger({ placementId }: { placementId: string }) {
  const [reloadKey, setReloadKey] = useState(0);

  const state = useAsync<PlacementClawbackStatus>(
    () => apiGet<PlacementClawbackStatus>(`/placements/${placementId}/clawback`),
    [placementId, reloadKey],
  );

  function handleTriggerSuccess(_result: TriggerClawbackResult) {
    setReloadKey((k) => k + 1);
  }

  return (
    <AdjustmentLedgerView
      placementId={placementId}
      state={state}
      onTriggerSuccess={handleTriggerSuccess}
    />
  );
}

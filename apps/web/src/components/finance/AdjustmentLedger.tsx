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
// Styles
// ---------------------------------------------------------------------------

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.8125rem',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  background: '#f3f4f6',
  color: '#374151',
  fontWeight: 600,
  borderBottom: '2px solid #e5e7eb',
};

const tdStyle: React.CSSProperties = {
  padding: '0.625rem 0.75rem',
  borderBottom: '1px solid #f3f4f6',
  color: '#374151',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  marginBottom: '0.75rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  color: '#374151',
  marginBottom: '0.25rem',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventSummaryBanner({ event }: { event: ClawbackEventSummary }) {
  return (
    <div
      data-testid="clawback-event-banner"
      style={{
        padding: '0.875rem 1rem',
        background: '#fefce8',
        border: '1px solid #fde047',
        borderRadius: '0.5rem',
        fontSize: '0.875rem',
        color: '#713f12',
        marginBottom: '1rem',
      }}
    >
      <strong>Clawback triggered</strong> — {event.event_type}, rule: <strong>{event.rule}</strong>,
      occurred {formatDate(event.occurred_at)}, triggered by{' '}
      <code style={{ fontSize: '0.75rem' }}>{event.triggered_by}</code>
    </div>
  );
}

/** Read-only table of all adjustment entries — no edit or delete affordances. */
function AdjustmentTable({ adjustments }: { adjustments: AdjustmentEntry[] }) {
  return (
    <table style={tableStyle} data-testid="adjustment-table">
      <thead>
        <tr>
          <th style={thStyle}>Commission Record</th>
          <th style={thStyle}>Amount</th>
          <th style={thStyle}>Reason</th>
          <th style={thStyle}>Actor</th>
          <th style={thStyle}>Date</th>
          <th style={thStyle}>Recovered</th>
        </tr>
      </thead>
      <tbody>
        {adjustments.map((a) => (
          <tr key={a.id} data-testid="adjustment-row">
            <td style={tdStyle}>
              <code style={{ fontSize: '0.75rem' }}>{a.commission_record_id.slice(0, 8)}…</code>
            </td>
            <td style={{ ...tdStyle, color: '#b91c1c', fontWeight: 600 }}>
              {formatCurrency(a.amount_delta)}
            </td>
            <td style={tdStyle}>{a.reason_code}</td>
            <td style={tdStyle}>
              <code style={{ fontSize: '0.75rem' }}>{a.adjusted_by.slice(0, 8)}…</code>
            </td>
            <td style={tdStyle}>{formatDate(a.adjusted_at)}</td>
            <td style={tdStyle}>{a.recovered ? 'Yes' : 'No'}</td>
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
      <table style={tableStyle} data-testid="recovery-schedule-table">
        <thead>
          <tr>
            <th style={thStyle}>Commission Record</th>
            <th style={thStyle}>Total</th>
            <th style={thStyle}>Installments</th>
            <th style={thStyle}>Per Installment</th>
            <th style={thStyle}>Created</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr key={s.id} data-testid="recovery-schedule-row">
              <td style={tdStyle}>
                <code style={{ fontSize: '0.75rem' }}>{s.commission_record_id.slice(0, 8)}…</code>
              </td>
              <td style={tdStyle}>{formatCurrency(s.clawback_amount)}</td>
              <td style={tdStyle}>{s.installment_count}</td>
              <td style={tdStyle}>{formatCurrency(s.installment_amount)}</td>
              <td style={tdStyle}>{formatDate(s.created_at)}</td>
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
      <p
        style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: 0, marginBottom: '1rem' }}
        data-testid="refund-credit-note"
      >
        Clawback and holdback adjustments only. Refund and credit-memo entry requires backend
        support not yet available.
      </p>
      <form data-testid="trigger-form" onSubmit={handleSubmit}>
        <label style={labelStyle}>
          Event type (required)
          <select
            data-testid="trigger-event-type"
            style={fieldStyle}
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
        <label style={labelStyle}>
          Reason / rule (required)
          <select
            data-testid="trigger-rule"
            style={fieldStyle}
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
            style={{ color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '0.75rem' }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          data-testid="trigger-submit"
          disabled={submitting}
          style={{
            padding: '0.625rem 1.25rem',
            background: submitting ? '#9ca3af' : '#991b1b',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Posting…' : 'Post adjustment'}
        </button>
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

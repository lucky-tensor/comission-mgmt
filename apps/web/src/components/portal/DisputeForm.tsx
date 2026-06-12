/**
 * DisputeForm — lets a producer open a payout dispute against one of their
 * commission records via POST /me/disputes (a mutating request: apiClient
 * attaches the CSRF header from the readable cookie).
 *
 * On success it shows a confirmation with the dispute's resolution-pending
 * state. Validation, submitting, error, and confirmation are all explicit
 * states so the flow is testable in a real browser.
 *
 * Canonical docs: docs/prd.md §5.9 — Producer dispute submission
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { useState } from 'react';
import type { CommissionRecord, Dispute } from 'core/producer-portal';
import { apiPost } from '../../lib/apiClient';
import { formatCurrency } from '../../lib/format';
import { PortalCard, EmptyState } from './states';
import { Button } from 'ui';

const FIELD_CLASS =
  'w-full px-3 py-2.5 border border-border-strong rounded-lg text-sm box-border mb-3.5';

/**
 * Dispute form for the producer's commission records.
 *
 * @param records  - the producer's commission records (dispute targets)
 * @param onSubmit - submit handler (defaults to real POST /me/disputes);
 *                   provided explicitly only to drive the form in tests
 *                   without a network round-trip — it is a real async call,
 *                   never a mock object.
 */
export function DisputeForm({
  records,
  onSubmit = (body) => apiPost<Dispute>('/me/disputes', body),
}: {
  records: CommissionRecord[];
  onSubmit?: (body: { commission_record_id: string; description: string }) => Promise<Dispute>;
}) {
  const [recordId, setRecordId] = useState(records[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Dispute | null>(null);

  if (records.length === 0) {
    return (
      <PortalCard title="Submit a dispute">
        <EmptyState message="No commission records available to dispute." />
      </PortalCard>
    );
  }

  if (result) {
    return (
      <PortalCard title="Submit a dispute">
        <div
          data-testid="dispute-confirmation"
          role="status"
          className="p-5 bg-ok-bg border border-ok-fg/30 rounded-lg text-ok-fg text-sm"
        >
          Dispute submitted — current state:{' '}
          <strong data-testid="dispute-state">{result.state}</strong>. Finance will review it
          shortly.
        </div>
      </PortalCard>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setError('Please describe the issue before submitting.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const dispute = await onSubmit({
        commission_record_id: recordId,
        description: description.trim(),
      });
      setResult(dispute);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit dispute');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PortalCard title="Submit a dispute">
      <form data-testid="dispute-form" onSubmit={handleSubmit}>
        <label className="block text-sm text-ink-muted">
          Commission record
          <select
            data-testid="dispute-record"
            className={FIELD_CLASS}
            value={recordId}
            onChange={(e) => setRecordId(e.target.value)}
          >
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {formatCurrency(r.net_payable)} — {r.status}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-ink-muted">
          What&apos;s the issue?
          <textarea
            data-testid="dispute-description"
            className={`${FIELD_CLASS} min-h-20 resize-y`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the discrepancy you'd like reviewed…"
          />
        </label>
        {error && (
          <div data-testid="dispute-error" role="alert" className="text-bad-fg text-sm mb-3">
            {error}
          </div>
        )}
        <Button type="submit" data-testid="dispute-submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit dispute'}
        </Button>
      </form>
    </PortalCard>
  );
}

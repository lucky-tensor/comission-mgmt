/**
 * DisputeForm — lets a producer open a payout dispute against one of their
 * commission records via POST /me/disputes (a mutating request: apiClient
 * attaches the CSRF header from the readable cookie).
 *
 * On success it shows a confirmation with the dispute's resolution-pending
 * state. Validation, submitting, error, and confirmation are all explicit
 * states so the flow is testable in a real browser.
 *
 * Canonical docs: docs/prd.md §5.8 — Producer dispute submission
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { useState } from 'react';
import type { CommissionRecord, Dispute } from 'core/producer-portal';
import { apiPost } from '../../lib/apiClient';
import { formatCurrency } from '../../lib/format';
import { PortalCard, EmptyState } from './states';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  marginBottom: '0.875rem',
};

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
          style={{
            padding: '1.25rem',
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: '0.5rem',
            color: '#065f46',
            fontSize: '0.875rem',
          }}
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
        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#374151' }}>
          Commission record
          <select
            data-testid="dispute-record"
            style={fieldStyle}
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
        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#374151' }}>
          What&apos;s the issue?
          <textarea
            data-testid="dispute-description"
            style={{ ...fieldStyle, minHeight: '5rem', resize: 'vertical' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the discrepancy you'd like reviewed…"
          />
        </label>
        {error && (
          <div
            data-testid="dispute-error"
            role="alert"
            style={{ color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '0.75rem' }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          data-testid="dispute-submit"
          disabled={submitting}
          style={{
            padding: '0.625rem 1.25rem',
            background: submitting ? '#9ca3af' : '#111827',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Submitting…' : 'Submit dispute'}
        </button>
      </form>
    </PortalCard>
  );
}

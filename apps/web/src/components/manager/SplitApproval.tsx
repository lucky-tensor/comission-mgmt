/**
 * SplitApproval — Manager surface for reviewing and approving or rejecting
 * split credit allocations on deals pending attribution approval.
 *
 * Composed of:
 *   - SplitApprovalView  — pure presentational view; accepts explicit state
 *     props so tests render each state in real headless Chromium without any
 *     network traffic.
 *   - SplitApproval      — container wiring real API calls via apiClient.
 *
 * API endpoints used:
 *   GET   /me/team/pending-approvals      — list deals awaiting approval
 *   GET   /placements/:id/contributors    — contributor roles and split credit
 *   POST  /placements/:id/attribution/approve — approve allocation
 *   POST  /placements/:id/attribution/reject  — reject with reason
 *
 * States rendered:
 *   - loading  — initial fetch in-flight
 *   - error    — fetch failure
 *   - empty    — no pending-approval deals
 *   - list     — deal rows with expand-to-review; per-deal approve/reject actions
 *
 * CSRF: mutations go through apiPost (attaches the double-submit header).
 *
 * Canonical docs: docs/prd.md §4 (Manager), §5.2, §5.4
 * Issue: feat: Manager UI — split approval and attribution timeline (#107)
 */

import { useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingApprovalItem {
  placement_id: string;
  job_title: string;
  submitted_at: string;
}

export interface PendingApprovalsResponse {
  pending_approvals: PendingApprovalItem[];
}

export interface Contributor {
  id: string;
  placement_id: string;
  producer_id: string;
  role: string;
  split_pct: number;
  created_at: string;
}

export interface ContributorsResponse {
  contributors: Contributor[];
}

// ---------------------------------------------------------------------------
// View-layer phase types
// ---------------------------------------------------------------------------

export type SplitApprovalPhase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'list'; items: PendingApprovalItem[] };

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '0.75rem',
  padding: '1.5rem',
  marginBottom: '1.5rem',
};

const headingStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  color: '#111827',
  marginTop: 0,
  marginBottom: '1rem',
};

const rowStyle: React.CSSProperties = {
  borderBottom: '1px solid #f3f4f6',
  padding: '0.875rem 0',
};

const btnBase: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 500,
  padding: '0.375rem 0.75rem',
  borderRadius: '0.375rem',
  border: 'none',
  cursor: 'pointer',
};

const approveBtn: React.CSSProperties = {
  ...btnBase,
  background: '#d1fae5',
  color: '#065f46',
};

const rejectBtn: React.CSSProperties = {
  ...btnBase,
  background: '#fee2e2',
  color: '#991b1b',
  marginLeft: '0.5rem',
};

// ---------------------------------------------------------------------------
// ContributorTable — shows per-contributor split credit for an expanded deal
// ---------------------------------------------------------------------------

interface ContributorTableProps {
  placementId: string;
  onLoad: (placementId: string) => Promise<ContributorsResponse>;
}

function ContributorTable({ placementId, onLoad }: ContributorTableProps) {
  const { data, loading, error } = useAsync(() => onLoad(placementId), [placementId]);

  if (loading) return <LoadingState label="contributors" />;
  if (error) return <ErrorState message={error} />;
  if (!data || data.contributors.length === 0)
    return <EmptyState message="No contributors assigned." />;

  return (
    <table
      data-testid={`contributors-table-${placementId}`}
      style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}
    >
      <thead>
        <tr style={{ color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
          <th style={{ textAlign: 'left', padding: '0.375rem 0.5rem', fontWeight: 500 }}>
            Producer
          </th>
          <th style={{ textAlign: 'left', padding: '0.375rem 0.5rem', fontWeight: 500 }}>Role</th>
          <th style={{ textAlign: 'right', padding: '0.375rem 0.5rem', fontWeight: 500 }}>
            Split %
          </th>
        </tr>
      </thead>
      <tbody>
        {data.contributors.map((c) => (
          <tr key={c.id} data-testid={`contributor-row-${c.id}`}>
            <td style={{ padding: '0.375rem 0.5rem', color: '#374151' }}>{c.producer_id}</td>
            <td style={{ padding: '0.375rem 0.5rem', color: '#374151' }}>{c.role}</td>
            <td
              data-testid={`split-pct-${c.id}`}
              style={{ padding: '0.375rem 0.5rem', textAlign: 'right', color: '#374151' }}
            >
              {(c.split_pct * 100).toFixed(0)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// DealRow — one pending-approval placement with expand/approve/reject
// ---------------------------------------------------------------------------

interface DealRowProps {
  item: PendingApprovalItem;
  onApprove: (placementId: string) => Promise<void>;
  onReject: (placementId: string, reason: string) => Promise<void>;
  onLoadContributors: (placementId: string) => Promise<ContributorsResponse>;
  onApproved: (placementId: string) => void;
}

function DealRow({ item, onApprove, onReject, onLoadContributors, onApproved }: DealRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleApprove() {
    setActing(true);
    setActionError(null);
    try {
      await onApprove(item.placement_id);
      onApproved(item.placement_id);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Approve failed';
      setActionError(msg);
    } finally {
      setActing(false);
    }
  }

  async function handleReject() {
    if (!reason.trim()) return;
    setActing(true);
    setActionError(null);
    try {
      await onReject(item.placement_id, reason.trim());
      onApproved(item.placement_id); // removes from list (rejected = no longer pending)
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Reject failed';
      setActionError(msg);
    } finally {
      setActing(false);
    }
  }

  return (
    <div data-testid={`deal-row-${item.placement_id}`} style={rowStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>
            {item.job_title}
          </div>
          <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.25rem' }}>
            Placement ID: {item.placement_id} · Submitted: {item.submitted_at}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
          <button
            data-testid={`expand-btn-${item.placement_id}`}
            style={{ ...btnBase, background: '#f3f4f6', color: '#374151' }}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'Collapse' : 'Review splits'}
          </button>
          <button
            data-testid={`approve-btn-${item.placement_id}`}
            style={approveBtn}
            disabled={acting}
            onClick={handleApprove}
          >
            Approve
          </button>
          <button
            data-testid={`reject-btn-${item.placement_id}`}
            style={rejectBtn}
            disabled={acting}
            onClick={() => setRejectMode((m) => !m)}
          >
            Reject
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '0.75rem', paddingLeft: '0.5rem' }}>
          <ContributorTable placementId={item.placement_id} onLoad={onLoadContributors} />
        </div>
      )}

      {rejectMode && (
        <div
          data-testid={`reject-form-${item.placement_id}`}
          style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}
        >
          <textarea
            data-testid={`reject-reason-${item.placement_id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for rejection…"
            style={{
              flex: 1,
              fontSize: '0.8125rem',
              padding: '0.375rem 0.5rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
              resize: 'vertical',
              minHeight: '3rem',
            }}
          />
          <button
            data-testid={`confirm-reject-btn-${item.placement_id}`}
            style={rejectBtn}
            disabled={acting || !reason.trim()}
            onClick={handleReject}
          >
            Confirm reject
          </button>
        </div>
      )}

      {actionError && (
        <div
          data-testid={`action-error-${item.placement_id}`}
          style={{ marginTop: '0.5rem', color: '#b91c1c', fontSize: '0.8125rem' }}
        >
          {actionError}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SplitApprovalView — pure presentational view
// ---------------------------------------------------------------------------

export interface SplitApprovalViewProps {
  phase: SplitApprovalPhase;
  onApprove: (placementId: string) => Promise<void>;
  onReject: (placementId: string, reason: string) => Promise<void>;
  onLoadContributors: (placementId: string) => Promise<ContributorsResponse>;
  onApproved: (placementId: string) => void;
}

export function SplitApprovalView({
  phase,
  onApprove,
  onReject,
  onLoadContributors,
  onApproved,
}: SplitApprovalViewProps) {
  return (
    <div data-testid="split-approval" style={cardStyle}>
      <h2 style={headingStyle}>Pending Split Approvals</h2>
      {phase.kind === 'loading' && <LoadingState label="pending approvals" />}
      {phase.kind === 'error' && <ErrorState message={phase.message} />}
      {phase.kind === 'empty' && (
        <EmptyState message="No deals are awaiting split approval." />
      )}
      {phase.kind === 'list' && (
        <div data-testid="pending-approvals-list">
          {phase.items.map((item) => (
            <DealRow
              key={item.placement_id}
              item={item}
              onApprove={onApprove}
              onReject={onReject}
              onLoadContributors={onLoadContributors}
              onApproved={onApproved}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SplitApproval — container
// ---------------------------------------------------------------------------

export function SplitApproval() {
  const [items, setItems] = useState<PendingApprovalItem[] | null>(null);

  const { loading, error } = useAsync(async () => {
    const data = await apiGet<PendingApprovalsResponse>('/me/team/pending-approvals');
    setItems(data.pending_approvals);
  }, []);

  function phase(): SplitApprovalPhase {
    if (loading) return { kind: 'loading' };
    if (error) return { kind: 'error', message: error };
    if (!items || items.length === 0) return { kind: 'empty' };
    return { kind: 'list', items };
  }

  async function handleApprove(placementId: string): Promise<void> {
    await apiPost(`/placements/${placementId}/attribution/approve`, {});
  }

  async function handleReject(placementId: string, reason: string): Promise<void> {
    await apiPost(`/placements/${placementId}/attribution/reject`, { reason });
  }

  async function handleLoadContributors(placementId: string): Promise<ContributorsResponse> {
    return apiGet<ContributorsResponse>(`/placements/${placementId}/contributors`);
  }

  function handleApproved(placementId: string) {
    setItems((prev) => (prev ? prev.filter((i) => i.placement_id !== placementId) : prev));
  }

  return (
    <SplitApprovalView
      phase={phase()}
      onApprove={handleApprove}
      onReject={handleReject}
      onLoadContributors={handleLoadContributors}
      onApproved={handleApproved}
    />
  );
}

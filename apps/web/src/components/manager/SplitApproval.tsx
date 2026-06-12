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
import { Button } from 'ui';
import { ApiError, apiDelete, apiGet, apiPost } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../portal/states';

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

const CARD_CLASS = 'bg-surface border border-border rounded-xl p-6 mb-6';

const HEADING_CLASS = 'text-lg font-semibold text-ink mt-0 mb-4';

const ROW_CLASS = 'border-b border-surface-sunken py-3.5';

// ---------------------------------------------------------------------------
// ContributorTable — shows per-contributor split credit for an expanded deal
// ---------------------------------------------------------------------------

interface ContributorTableProps {
  placementId: string;
  onLoad: (placementId: string) => Promise<ContributorsResponse>;
  onUpdateContributor: (
    placementId: string,
    contributor: Contributor,
    splitPct: number,
  ) => Promise<void>;
}

interface ContributorRowProps {
  contributor: Contributor;
  onSave: (contributor: Contributor, splitPct: number) => Promise<void>;
}

function ContributorRow({ contributor, onSave }: ContributorRowProps) {
  const [splitPercent, setSplitPercent] = useState(String(Math.round(contributor.split_pct * 100)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const percent = Number(splitPercent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      setError('Split must be between 1 and 100.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(contributor, percent / 100);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Split update failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr data-testid={`contributor-row-${contributor.id}`}>
      <td className="px-2 py-1.5 text-ink-muted">{contributor.producer_id}</td>
      <td className="px-2 py-1.5 text-ink-muted">{contributor.role}</td>
      <td
        data-testid={`split-pct-${contributor.id}`}
        className="px-2 py-1.5 text-right text-ink-muted"
      >
        {(contributor.split_pct * 100).toFixed(0)}%
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          data-testid={`split-input-${contributor.id}`}
          type="number"
          min="1"
          max="100"
          value={splitPercent}
          onChange={(e) => setSplitPercent(e.target.value)}
          className="w-20 text-sm px-1.5 py-1 border border-border-strong rounded-md text-right"
        />
        <Button
          data-testid={`save-split-btn-${contributor.id}`}
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="ml-1.5 text-sm px-3 py-1.5"
        >
          Save
        </Button>
        {error && (
          <div
            role="alert"
            data-testid={`split-update-error-${contributor.id}`}
            className="mt-1 text-bad-fg text-xs"
          >
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}

function ContributorTable({ placementId, onLoad, onUpdateContributor }: ContributorTableProps) {
  const [refresh, setRefresh] = useState(0);
  const { data, loading, error } = useAsync(() => onLoad(placementId), [placementId, refresh]);

  if (loading) return <LoadingState label="contributors" />;
  if (error) return <ErrorState message={error} />;
  if (!data || data.contributors.length === 0)
    return <EmptyState message="No contributors assigned." />;

  async function handleSave(contributor: Contributor, splitPct: number) {
    await onUpdateContributor(placementId, contributor, splitPct);
    setRefresh((value) => value + 1);
  }

  return (
    <table
      data-testid={`contributors-table-${placementId}`}
      className="w-full border-collapse text-sm"
    >
      <thead>
        <tr className="text-ink-subtle border-b border-border">
          <th className="text-left px-2 py-1.5 font-medium">Producer</th>
          <th className="text-left px-2 py-1.5 font-medium">Role</th>
          <th className="text-right px-2 py-1.5 font-medium">Split %</th>
          <th className="text-right px-2 py-1.5 font-medium">Modify</th>
        </tr>
      </thead>
      <tbody>
        {data.contributors.map((c) => (
          <ContributorRow key={c.id} contributor={c} onSave={handleSave} />
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
  onUpdateContributor: (
    placementId: string,
    contributor: Contributor,
    splitPct: number,
  ) => Promise<void>;
  onApproved: (placementId: string) => void;
}

function DealRow({
  item,
  onApprove,
  onReject,
  onLoadContributors,
  onUpdateContributor,
  onApproved,
}: DealRowProps) {
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
    <div data-testid={`deal-row-${item.placement_id}`} className={ROW_CLASS}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-ink text-base">{item.job_title}</div>
          <div className="text-sm text-ink-subtle mt-1">
            Placement ID: {item.placement_id} · Submitted: {item.submitted_at}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="secondary"
            data-testid={`expand-btn-${item.placement_id}`}
            className="text-sm px-3 py-1.5"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'Collapse' : 'Review splits'}
          </Button>
          <Button
            data-testid={`approve-btn-${item.placement_id}`}
            className="text-sm px-3 py-1.5"
            disabled={acting}
            onClick={handleApprove}
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            data-testid={`reject-btn-${item.placement_id}`}
            className="text-sm px-3 py-1.5"
            disabled={acting}
            onClick={() => setRejectMode((m) => !m)}
          >
            Reject
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pl-2">
          <ContributorTable
            placementId={item.placement_id}
            onLoad={onLoadContributors}
            onUpdateContributor={onUpdateContributor}
          />
        </div>
      )}

      {rejectMode && (
        <div
          data-testid={`reject-form-${item.placement_id}`}
          className="mt-3 flex gap-2 items-start"
        >
          <textarea
            data-testid={`reject-reason-${item.placement_id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for rejection…"
            className="flex-1 text-sm px-2 py-1.5 rounded-md border border-border-strong resize-y min-h-12"
          />
          <Button
            variant="destructive"
            data-testid={`confirm-reject-btn-${item.placement_id}`}
            className="text-sm px-3 py-1.5"
            disabled={acting || !reason.trim()}
            onClick={handleReject}
          >
            Confirm reject
          </Button>
        </div>
      )}

      {actionError && (
        <div data-testid={`action-error-${item.placement_id}`} className="mt-2 text-bad-fg text-sm">
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
  onUpdateContributor: (
    placementId: string,
    contributor: Contributor,
    splitPct: number,
  ) => Promise<void>;
  onApproved: (placementId: string) => void;
}

export function SplitApprovalView({
  phase,
  onApprove,
  onReject,
  onLoadContributors,
  onUpdateContributor,
  onApproved,
}: SplitApprovalViewProps) {
  return (
    <div data-testid="split-approval" className={CARD_CLASS}>
      <h2 className={HEADING_CLASS}>Pending Split Approvals</h2>
      {phase.kind === 'loading' && <LoadingState label="pending approvals" />}
      {phase.kind === 'error' && <ErrorState message={phase.message} />}
      {phase.kind === 'empty' && <EmptyState message="No deals are awaiting split approval." />}
      {phase.kind === 'list' && (
        <div data-testid="pending-approvals-list">
          {phase.items.map((item) => (
            <DealRow
              key={item.placement_id}
              item={item}
              onApprove={onApprove}
              onReject={onReject}
              onLoadContributors={onLoadContributors}
              onUpdateContributor={onUpdateContributor}
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
    // The API returns a bare Contributor[] array; wrap it for the ContributorTable.
    const contributors = await apiGet<Contributor[]>(`/placements/${placementId}/contributors`);
    return { contributors };
  }

  async function handleUpdateContributor(
    placementId: string,
    contributor: Contributor,
    splitPct: number,
  ): Promise<void> {
    await apiDelete(`/placements/${placementId}/contributors/${contributor.id}`);
    await apiPost(`/placements/${placementId}/contributors`, {
      producer_id: contributor.producer_id,
      role: contributor.role,
      split_pct: splitPct,
      split_override: true,
    });
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
      onUpdateContributor={handleUpdateContributor}
      onApproved={handleApproved}
    />
  );
}

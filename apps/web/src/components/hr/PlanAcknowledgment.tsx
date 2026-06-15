/**
 * PlanAcknowledgment — HR / People Ops surface for commission plan acknowledgment.
 *
 * Two surfaces in one file:
 *
 *   PlanAcknowledgmentView (presentational)
 *     - Renders acknowledgment status per producer/plan-version from assignment data.
 *     - Three states: loading, error, empty.
 *     - Data state: table of assignments with acknowledged_at timestamp where
 *       present; distinguishes acknowledged vs not-yet-acknowledged rows.
 *     - Accepts an `onAcknowledge` callback wired by the connected container.
 *
 *   PlanAcknowledgment (container — HR route)
 *     - Fetches GET /plans and for each plan fetches GET /plans/:id/assignments.
 *     - Renders PlanAcknowledgmentView with the merged assignment list.
 *     - Accessible only to HR role (App.tsx enforces the route guard).
 *
 *   ProducerAcknowledgeAction (presentational)
 *     - A producer can acknowledge the active assigned plan version.
 *     - Calls POST /plans/:id/versions/:vid/acknowledge via apiPost.
 *     - Renders the acknowledge button, loading state, and post-acknowledge confirmation.
 *     - Gated: only renders when the assigned plan version is not yet acknowledged.
 *
 *   ProducerPlanAcknowledgment (container — Producer route, embedded in ProducerPortal)
 *     - Fetches GET /plans to find the producer's active plan, then
 *       GET /plans/:id/assignments to find the producer's own assignment.
 *     - Renders ProducerAcknowledgeAction or a "plan acknowledged" confirmation.
 *
 * Backend dependency note:
 *   POST /plans/:id/versions/:vid/acknowledge is LIVE (issue #123). The acknowledge
 *   action is fully wired. acknowledged_at / acknowledged_by fields on assignments
 *   are returned by GET /plans/:id/assignments.
 *
 * No Vitest mocking helpers are used in tests for this module.
 *
 * Canonical docs: docs/prd.md §4 (HR / People Ops)
 * Issue: feat: HR/People Ops UI — commission plan acknowledgment (#114)
 */

import { useState } from 'react';
import { Button, StatusChip } from 'ui';
import { ApiError, apiGet, apiPost } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { LoadingState, ErrorState, EmptyState, PortalCard } from '../portal/states';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A plan assignment row as returned by GET /plans/:id/assignments. */
export interface PlanAssignment {
  id: string;
  org_id: string;
  plan_version_id: string;
  producer_id: string;
  assigned_at: string;
  expires_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

/** A plan as returned by GET /plans. */
export interface Plan {
  id: string;
  org_id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  created_by: string;
  created_at: string;
}

/** Acknowledgment record as returned by POST /plans/:id/versions/:vid/acknowledge. */
export interface AcknowledgmentRecord {
  id: string;
  org_id: string;
  plan_version_id: string;
  producer_id: string;
  acknowledged_by: string;
  acknowledged_at: string;
}

/** Assignment enriched with the plan name for display. */
export interface AssignmentRow extends PlanAssignment {
  plan_name: string;
  plan_id: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Styles — Tailwind class strings (theme tokens, no raw hex)
// ---------------------------------------------------------------------------

const TABLE_CLASS = 'w-full border-collapse text-sm';

const TH_CLASS = 'text-left px-3 py-2 border-b-2 border-border text-ink-muted font-semibold';

const TD_CLASS = 'px-3 py-2 border-b border-surface-sunken text-ink align-middle';

// ---------------------------------------------------------------------------
// PlanAcknowledgmentView — presentational (HR table view)
// ---------------------------------------------------------------------------

interface PlanAcknowledgmentViewProps {
  state: {
    data: AssignmentRow[] | null;
    loading: boolean;
    error: string | null;
  };
}

export function PlanAcknowledgmentView({ state }: PlanAcknowledgmentViewProps) {
  if (state.loading) {
    return (
      <PortalCard title="Commission Plan Acknowledgment">
        <LoadingState label="plan assignments" />
      </PortalCard>
    );
  }

  if (state.error) {
    return (
      <PortalCard title="Commission Plan Acknowledgment">
        <ErrorState message={state.error} />
      </PortalCard>
    );
  }

  if (!state.data || state.data.length === 0) {
    return (
      <PortalCard title="Commission Plan Acknowledgment">
        <EmptyState message="No plan assignments found. Assign producers to plan versions to track acknowledgments." />
      </PortalCard>
    );
  }

  return (
    <PortalCard title="Commission Plan Acknowledgment">
      <table className={TABLE_CLASS} data-testid="acknowledgment-table">
        <thead>
          <tr>
            <th className={TH_CLASS}>Plan</th>
            <th className={TH_CLASS}>Producer</th>
            <th className={TH_CLASS}>Version</th>
            <th className={TH_CLASS}>Assigned</th>
            <th className={TH_CLASS}>Status</th>
            <th className={TH_CLASS}>Acknowledged At</th>
          </tr>
        </thead>
        <tbody>
          {state.data.map((row) => (
            <tr key={row.id} data-testid={`ack-row-${row.id}`}>
              <td className={TD_CLASS}>{row.plan_name}</td>
              <td className={TD_CLASS} data-testid={`producer-${row.id}`}>
                {row.producer_id}
              </td>
              <td className={TD_CLASS} data-testid={`version-${row.id}`}>
                {row.plan_version_id.slice(0, 8)}…
              </td>
              <td className={TD_CLASS}>{formatDate(row.assigned_at)}</td>
              <td className={TD_CLASS}>
                {row.acknowledged_at ? (
                  <StatusChip variant="green" data-testid={`status-acknowledged-${row.id}`}>
                    Acknowledged
                  </StatusChip>
                ) : (
                  <StatusChip variant="amber" data-testid={`status-pending-${row.id}`}>
                    Pending
                  </StatusChip>
                )}
              </td>
              <td className={TD_CLASS} data-testid={`ack-at-${row.id}`}>
                {row.acknowledged_at ? formatDate(row.acknowledged_at) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// PlanAcknowledgment — connected container (HR role)
// ---------------------------------------------------------------------------

/** Fetch all plans and their assignments, merge into AssignmentRow[]. */
async function fetchAllAssignments(): Promise<AssignmentRow[]> {
  const plans = await apiGet<Plan[]>('/plans');
  if (!plans || plans.length === 0) return [];

  const assignmentArrays = await Promise.all(
    plans.map(async (plan) => {
      try {
        const rows = await apiGet<PlanAssignment[]>(`/plans/${plan.id}/assignments`);
        return rows.map(
          (a): AssignmentRow => ({
            ...a,
            plan_name: plan.name,
            plan_id: plan.id,
          }),
        );
      } catch {
        return [] as AssignmentRow[];
      }
    }),
  );

  return assignmentArrays.flat();
}

export function PlanAcknowledgment() {
  const state = useAsync<AssignmentRow[]>(fetchAllAssignments, []);

  return (
    <div data-testid="plan-acknowledgment" className="min-h-surface bg-surface-muted px-4 py-8">
      <div className="max-w-report mx-auto">
        <header className="mb-8">
          <h1
            data-testid="plan-acknowledgment-heading"
            className="text-xl font-semibold tracking-tight text-ink m-0"
          >
            HR / People Ops — Plan Acknowledgment
          </h1>
          <p className="text-sm text-ink-subtle mt-1 mb-0">
            Commission plan acknowledgment status per producer and plan version.
          </p>
        </header>

        <PlanAcknowledgmentView state={state} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProducerAcknowledgeAction — presentational (Producer action)
// ---------------------------------------------------------------------------

interface ProducerAcknowledgeActionProps {
  planId: string;
  versionId: string;
  /** Whether the producer has already acknowledged this version. */
  alreadyAcknowledged: boolean;
  acknowledgedAt: string | null;
  onAcknowledged: (record: AcknowledgmentRecord) => void;
}

export function ProducerAcknowledgeAction({
  planId,
  versionId,
  alreadyAcknowledged,
  acknowledgedAt,
  onAcknowledged,
}: ProducerAcknowledgeActionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(alreadyAcknowledged);
  const [ackAt, setAckAt] = useState<string | null>(acknowledgedAt);

  async function handleAcknowledge() {
    setLoading(true);
    setError(null);
    try {
      const record = await apiPost<AcknowledgmentRecord>(
        `/plans/${planId}/versions/${versionId}/acknowledge`,
        {},
      );
      setAcknowledged(true);
      setAckAt(record.acknowledged_at);
      onAcknowledged(record);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to acknowledge plan');
      }
    } finally {
      setLoading(false);
    }
  }

  if (acknowledged) {
    return (
      <div data-testid="acknowledge-confirmed" className="p-4">
        <StatusChip variant="green">
          Plan acknowledged{ackAt ? ` on ${formatDate(ackAt)}` : ''}
        </StatusChip>
      </div>
    );
  }

  return (
    <div data-testid="acknowledge-action" className="p-4">
      {error && (
        <div
          data-testid="acknowledge-error"
          role="alert"
          className="mb-3 px-3 py-2 bg-bad-bg border border-bad-fg/30 rounded-md text-bad-fg text-sm"
        >
          {error}
        </div>
      )}
      <Button data-testid="acknowledge-btn" onClick={handleAcknowledge} disabled={loading}>
        {loading ? 'Acknowledging…' : 'Acknowledge Commission Plan'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProducerPlanAcknowledgment — connected container (Producer portal section)
// ---------------------------------------------------------------------------

/** Fetch the producer's own plan assignment (scoped by the server to their user_id). */
async function fetchProducerAssignment(): Promise<{
  assignment: AssignmentRow;
  planId: string;
} | null> {
  const plans = await apiGet<Plan[]>('/plans');
  if (!plans || plans.length === 0) return null;

  for (const plan of plans) {
    try {
      const rows = await apiGet<PlanAssignment[]>(`/plans/${plan.id}/assignments`);
      if (rows && rows.length > 0) {
        const assignment: AssignmentRow = {
          ...rows[0],
          plan_name: plan.name,
          plan_id: plan.id,
        };
        return { assignment, planId: plan.id };
      }
    } catch {
      // skip plans without assignments visible to this user
    }
  }
  return null;
}

export function ProducerPlanAcknowledgment() {
  const state = useAsync(fetchProducerAssignment, []);
  const [ackRecord, setAckRecord] = useState<AcknowledgmentRecord | null>(null);

  if (state.loading) {
    return (
      <PortalCard title="My Commission Plan">
        <LoadingState label="commission plan" />
      </PortalCard>
    );
  }

  if (state.error) {
    return (
      <PortalCard title="My Commission Plan">
        <ErrorState message={state.error} />
      </PortalCard>
    );
  }

  if (!state.data) {
    return (
      <PortalCard title="My Commission Plan">
        <EmptyState message="No commission plan is currently assigned to you." />
      </PortalCard>
    );
  }

  const { assignment, planId } = state.data;
  const alreadyAcknowledged = ackRecord !== null || assignment.acknowledged_at !== null;
  const ackAt = ackRecord?.acknowledged_at ?? assignment.acknowledged_at;

  return (
    <PortalCard title="My Commission Plan">
      <div data-testid="producer-plan-acknowledgment">
        <p className="text-sm text-ink-muted mb-3">
          <strong>Plan:</strong> {assignment.plan_name}
        </p>
        <p className="text-sm text-ink-muted mb-3">
          <strong>Assigned:</strong> {formatDate(assignment.assigned_at)}
        </p>
        <ProducerAcknowledgeAction
          planId={planId}
          versionId={assignment.plan_version_id}
          alreadyAcknowledged={alreadyAcknowledged}
          acknowledgedAt={ackAt}
          onAcknowledged={setAckRecord}
        />
      </div>
    </PortalCard>
  );
}

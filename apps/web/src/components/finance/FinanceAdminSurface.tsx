/**
 * FinanceAdminSurface — Adjustments & Payroll Export section of Finance Home.
 *
 * UX overhaul (#203, docs/ux-review.md §1): the raw "Placement UUID…" and
 * "Commission run UUID…" text inputs are replaced with name-based pickers fed
 * by list endpoints — placements by client/candidate/role, and recent
 * commission runs by period + status. No user types a UUID here anymore; the
 * run picker also carries the run's status, so the manual status dropdown is
 * gone.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin); docs/ux-review.md §1
 * Issues:
 *   - feat: Finance Admin UI — adjustment ledger (#104)
 *   - feat: Finance Admin UI — payroll-ready export (#105)
 *   - feat: webapp — UX overhaul: entity pickers (#203)
 */

import { useState } from 'react';
import { AdjustmentLedger } from './AdjustmentLedger';
import { PayrollExport } from './PayrollExport';
import { EntityPicker } from '../EntityPicker';
import { apiGet } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { colors } from 'ui';

// Shared list-row shapes returned by the list endpoints.
interface PlacementListItem {
  id: string;
  job_title?: string | null;
  position_title?: string | null;
  candidate_name?: string | null;
  client_name?: string | null;
}

interface CommissionRunListItem {
  id: string;
  status: string;
  period_start: string;
  period_end: string;
  record_count: number;
}

const sectionStyle: React.CSSProperties = { marginBottom: '2rem' };

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  color: colors.ink,
  margin: '0 0 0.75rem',
};

function placementOptionLabel(p: PlacementListItem): string {
  const title = p.position_title ?? p.job_title ?? null;
  const parts: string[] = [];
  if (title) parts.push(title);
  if (p.candidate_name) parts.push(p.candidate_name);
  if (p.client_name) parts.push(`@ ${p.client_name}`);
  return parts.length > 0 ? parts.join(' — ') : p.id;
}

function runOptionLabel(r: CommissionRunListItem): string {
  return `${r.period_start} → ${r.period_end} · ${r.status} (${r.record_count} records)`;
}

export function FinanceAdminSurface() {
  const [placementId, setPlacementId] = useState<string | null>(null);
  const [payrollRun, setPayrollRun] = useState<{ id: string; status: string } | null>(null);

  // GET /placements returns a bare array of placements.
  const placements = useAsync<PlacementListItem[]>(
    () => apiGet<PlacementListItem[]>('/placements'),
    [],
  );
  const runs = useAsync<CommissionRunListItem[]>(
    () =>
      apiGet<{ commission_runs: CommissionRunListItem[] }>('/commission-runs').then(
        (r) => r.commission_runs,
      ),
    [],
  );

  return (
    <div data-testid="finance-home">
      <section style={sectionStyle} aria-labelledby="adjustment-ledger-heading">
        <h2 id="adjustment-ledger-heading" style={sectionHeadingStyle}>
          Adjustment ledger
        </h2>
        <EntityPicker
          name="adjustment-placement"
          label="Placement"
          state={placements}
          value={placementId}
          onChange={setPlacementId}
          toOption={(p) => ({ id: p.id, label: placementOptionLabel(p) })}
          placeholder="Select a placement…"
          emptyMessage="No placements available."
        />

        {placementId && <AdjustmentLedger placementId={placementId} />}
      </section>

      <section style={sectionStyle} aria-labelledby="payroll-export-heading">
        <h2 id="payroll-export-heading" style={sectionHeadingStyle}>
          Payroll export
        </h2>
        <EntityPicker
          name="run"
          label="Commission run"
          state={runs}
          value={payrollRun?.id ?? null}
          onChange={(id) => {
            const run = (runs.data ?? []).find((r) => r.id === id);
            if (run) setPayrollRun({ id: run.id, status: run.status });
          }}
          toOption={(r) => ({ id: r.id, label: runOptionLabel(r) })}
          placeholder="Select a commission run…"
          emptyMessage="No commission runs yet."
        />

        {payrollRun && <PayrollExport runId={payrollRun.id} runStatus={payrollRun.status} />}
      </section>
    </div>
  );
}

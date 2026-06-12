/**
 * DealSimulator — producer-facing deal simulation surface.
 *
 * Two tabs:
 *   - "Actual Deals": lists the producer's registered deals (GET
 *     /producer/simulations history seeds the deal list) and lets the producer
 *     run POST /producer/simulations/actual against a selected deal.
 *   - "Hypothetical Builder": a form (amount, tier, bonus-season flag, accrual
 *     percent) that calls POST /producer/simulations/hypothetical.
 *
 * Each run renders a result card with the payout estimate, dispute-risk score,
 * and plain-language AI reasoning. The reasoning is presented verbatim from the
 * API, which (per PRD §9 explainability) is traceable to the producer's own
 * plan version and fee-rate structure — the portal never invents numbers, it
 * only displays what the simulation API returns for the signed-in producer.
 *
 * All network logic is funnelled through apiClient; the component is otherwise
 * self-contained and exposes explicit loading/error/empty/result states so the
 * flow is testable in a real browser.
 *
 * Canonical docs: docs/prd.md §5.9, §9; docs/arbitration-simulation.md
 * Issue: feat: webapp — UI surfaces for AI dispute arbitration + deal simulation (#199)
 */

import { useState } from 'react';
import type {
  ActualDealSimulationRequest,
  DealSimulationForecast,
  HypotheticalDealSimulationRequest,
  SimulationRunHistoryResponse,
  SimulationRunRecord,
} from 'core/producer-simulation';
import { apiGet, apiPost } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { formatCurrency } from '../../lib/format';
import { PortalCard, EmptyState, LoadingState, ErrorState } from './states';
import { Button } from 'ui';

type Tab = 'actual' | 'hypothetical';

const FIELD_CLASS =
  'w-full px-3 py-2.5 border border-border-strong rounded-lg text-sm box-border mb-3.5';

function tabButtonClass(active: boolean): string {
  return [
    'px-4 py-2 border-none bg-none text-sm font-semibold cursor-pointer',
    active
      ? 'border-b-2 border-accent text-accent'
      : 'border-b-2 border-transparent text-ink-subtle',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// SimulationResultCard — payout / dispute-risk / reasoning
// ---------------------------------------------------------------------------

function SimulationResultCard({ forecast }: { forecast: DealSimulationForecast }) {
  return (
    <div
      data-testid="simulation-result"
      className="mt-4 p-5 bg-surface-sunken border border-border rounded-lg"
    >
      <div className="flex gap-8 mb-3">
        <div>
          <div className="text-xs text-ink-subtle font-semibold">Payout estimate</div>
          <div data-testid="simulation-payout" className="text-xl font-bold text-ink">
            {formatCurrency(forecast.payout_estimate)}
          </div>
        </div>
        <div>
          <div className="text-xs text-ink-subtle font-semibold">Dispute risk</div>
          <div data-testid="simulation-dispute-risk" className="text-xl font-bold text-ink">
            {forecast.dispute_risk}
          </div>
        </div>
      </div>
      <div>
        <div className="text-xs text-ink-subtle font-semibold">
          Reasoning (traceable to your plan version and fee-rate structure)
        </div>
        <p
          data-testid="simulation-reasoning"
          className="text-sm text-ink-muted mt-1 mb-0 leading-normal"
        >
          {forecast.reasoning}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActualDealsTab — list of registered deals with Simulate buttons
// ---------------------------------------------------------------------------

function ActualDealsTab() {
  const history = useAsync<SimulationRunRecord[]>(
    () =>
      apiGet<SimulationRunHistoryResponse>('/producer/simulations').then((r) => r.simulation_runs),
    [],
  );

  const [busyDeal, setBusyDeal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DealSimulationForecast | null>(null);

  async function simulate(dealId: string) {
    setBusyDeal(dealId);
    setError(null);
    try {
      const body: ActualDealSimulationRequest = { deal_id: dealId };
      const forecast = await apiPost<DealSimulationForecast>('/producer/simulations/actual', body);
      setResult(forecast);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to run simulation');
    } finally {
      setBusyDeal(null);
    }
  }

  if (history.loading) return <LoadingState label="your deals" />;
  if (history.error) return <ErrorState message={history.error} />;

  // Distinct deals derived from prior simulation runs' input params.
  const deals = Array.from(
    new Set(
      (history.data ?? [])
        .map((run) => String(run.input_params.deal_id ?? ''))
        .filter((id) => id !== ''),
    ),
  );

  if (deals.length === 0) {
    return <EmptyState message="No registered deals available to simulate yet." />;
  }

  return (
    <div data-testid="actual-deals">
      {deals.map((dealId) => (
        <div
          key={dealId}
          data-testid={`actual-deal-${dealId}`}
          className="border-b border-border py-3 flex justify-between items-center gap-4"
        >
          <div className="text-sm text-ink">Deal {dealId}</div>
          <Button
            data-testid={`simulate-btn-${dealId}`}
            onClick={() => simulate(dealId)}
            disabled={busyDeal !== null}
          >
            {busyDeal === dealId ? 'Simulating…' : 'Simulate'}
          </Button>
        </div>
      ))}

      {error && <ErrorState message={error} />}
      {result && <SimulationResultCard forecast={result} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HypotheticalBuilderTab — custom deal-params form
// ---------------------------------------------------------------------------

function HypotheticalBuilderTab() {
  const [amount, setAmount] = useState('');
  const [tier, setTier] = useState('standard');
  const [bonusSeason, setBonusSeason] = useState(false);
  const [accrualPercent, setAccrualPercent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DealSimulationForecast | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(amount);
    const accrualNum = Number(accrualPercent);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Enter a compensation amount greater than zero.');
      return;
    }
    if (!Number.isFinite(accrualNum)) {
      setError('Enter a valid accrual percent.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: HypotheticalDealSimulationRequest = {
        amount: amountNum,
        tier,
        bonus_season_flag: bonusSeason,
        accrual_percent: accrualNum,
      };
      const forecast = await apiPost<DealSimulationForecast>(
        '/producer/simulations/hypothetical',
        body,
      );
      setResult(forecast);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to run simulation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form data-testid="hypothetical-form" onSubmit={handleSubmit}>
      <label className="block text-[0.8125rem] text-ink-muted">
        Compensation amount
        <input
          data-testid="hypothetical-amount"
          type="number"
          step="any"
          className={FIELD_CLASS}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 50000"
        />
      </label>
      <label className="block text-[0.8125rem] text-ink-muted">
        Tier
        <select
          data-testid="hypothetical-tier"
          className={FIELD_CLASS}
          value={tier}
          onChange={(e) => setTier(e.target.value)}
        >
          <option value="standard">Standard</option>
          <option value="senior">Senior</option>
          <option value="principal">Principal</option>
        </select>
      </label>
      <label className="block text-[0.8125rem] text-ink-muted">
        Accrual percent
        <input
          data-testid="hypothetical-accrual"
          type="number"
          step="any"
          className={FIELD_CLASS}
          value={accrualPercent}
          onChange={(e) => setAccrualPercent(e.target.value)}
          placeholder="e.g. 5"
        />
      </label>
      <label className="flex items-center gap-2 text-[0.8125rem] text-ink-muted mb-3.5">
        <input
          data-testid="hypothetical-bonus"
          type="checkbox"
          checked={bonusSeason}
          onChange={(e) => setBonusSeason(e.target.checked)}
        />
        Bonus season
      </label>

      {error && <ErrorState message={error} />}

      <Button type="submit" data-testid="hypothetical-submit" disabled={submitting}>
        {submitting ? 'Simulating…' : 'Run simulation'}
      </Button>

      {result && <SimulationResultCard forecast={result} />}
    </form>
  );
}

// ---------------------------------------------------------------------------
// DealSimulator — tabbed card
// ---------------------------------------------------------------------------

export function DealSimulator() {
  const [tab, setTab] = useState<Tab>('actual');

  return (
    <PortalCard title="Deal simulator">
      <div data-testid="simulator-tabs" className="flex gap-2 border-b border-border mb-4">
        <button
          data-testid="tab-actual"
          onClick={() => setTab('actual')}
          className={tabButtonClass(tab === 'actual')}
        >
          Actual Deals
        </button>
        <button
          data-testid="tab-hypothetical"
          onClick={() => setTab('hypothetical')}
          className={tabButtonClass(tab === 'hypothetical')}
        >
          Hypothetical Builder
        </button>
      </div>

      {tab === 'actual' ? <ActualDealsTab /> : <HypotheticalBuilderTab />}
    </PortalCard>
  );
}

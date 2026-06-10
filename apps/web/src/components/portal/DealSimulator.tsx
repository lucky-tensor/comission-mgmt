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
 * Canonical docs: docs/prd.md §5.8, §9; docs/arbitration-simulation.md
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

type Tab = 'actual' | 'hypothetical';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  marginBottom: '0.875rem',
};

const tabButtonStyle = (active: boolean): React.CSSProperties => ({
  padding: '0.5rem 1rem',
  border: 'none',
  borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
  background: 'none',
  color: active ? '#1d4ed8' : '#6b7280',
  fontSize: '0.875rem',
  fontWeight: 600,
  cursor: 'pointer',
});

const submitButtonStyle = (busy: boolean): React.CSSProperties => ({
  padding: '0.5rem 1.25rem',
  background: busy ? '#93c5fd' : '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: '0.5rem',
  cursor: busy ? 'not-allowed' : 'pointer',
  fontSize: '0.875rem',
  fontWeight: 600,
});

// ---------------------------------------------------------------------------
// SimulationResultCard — payout / dispute-risk / reasoning
// ---------------------------------------------------------------------------

function SimulationResultCard({ forecast }: { forecast: DealSimulationForecast }) {
  return (
    <div
      data-testid="simulation-result"
      style={{
        marginTop: '1rem',
        padding: '1.25rem',
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600 }}>
            Payout estimate
          </div>
          <div
            data-testid="simulation-payout"
            style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}
          >
            {formatCurrency(forecast.payout_estimate)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600 }}>Dispute risk</div>
          <div
            data-testid="simulation-dispute-risk"
            style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}
          >
            {forecast.dispute_risk}
          </div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600 }}>
          Reasoning (traceable to your plan version and fee-rate structure)
        </div>
        <p
          data-testid="simulation-reasoning"
          style={{ fontSize: '0.875rem', color: '#374151', margin: '0.25rem 0 0', lineHeight: 1.5 }}
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
          style={{
            borderBottom: '1px solid #e5e7eb',
            padding: '0.75rem 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div style={{ fontSize: '0.875rem', color: '#111827' }}>Deal {dealId}</div>
          <button
            data-testid={`simulate-btn-${dealId}`}
            onClick={() => simulate(dealId)}
            disabled={busyDeal !== null}
            style={submitButtonStyle(busyDeal === dealId)}
          >
            {busyDeal === dealId ? 'Simulating…' : 'Simulate'}
          </button>
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
      <label style={{ display: 'block', fontSize: '0.8125rem', color: '#374151' }}>
        Compensation amount
        <input
          data-testid="hypothetical-amount"
          type="number"
          step="any"
          style={fieldStyle}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 50000"
        />
      </label>
      <label style={{ display: 'block', fontSize: '0.8125rem', color: '#374151' }}>
        Tier
        <select
          data-testid="hypothetical-tier"
          style={fieldStyle}
          value={tier}
          onChange={(e) => setTier(e.target.value)}
        >
          <option value="standard">Standard</option>
          <option value="senior">Senior</option>
          <option value="principal">Principal</option>
        </select>
      </label>
      <label style={{ display: 'block', fontSize: '0.8125rem', color: '#374151' }}>
        Accrual percent
        <input
          data-testid="hypothetical-accrual"
          type="number"
          step="any"
          style={fieldStyle}
          value={accrualPercent}
          onChange={(e) => setAccrualPercent(e.target.value)}
          placeholder="e.g. 5"
        />
      </label>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.8125rem',
          color: '#374151',
          marginBottom: '0.875rem',
        }}
      >
        <input
          data-testid="hypothetical-bonus"
          type="checkbox"
          checked={bonusSeason}
          onChange={(e) => setBonusSeason(e.target.checked)}
        />
        Bonus season
      </label>

      {error && <ErrorState message={error} />}

      <button
        type="submit"
        data-testid="hypothetical-submit"
        disabled={submitting}
        style={submitButtonStyle(submitting)}
      >
        {submitting ? 'Simulating…' : 'Run simulation'}
      </button>

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
      <div
        data-testid="simulator-tabs"
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid #e5e7eb',
          marginBottom: '1rem',
        }}
      >
        <button
          data-testid="tab-actual"
          onClick={() => setTab('actual')}
          style={tabButtonStyle(tab === 'actual')}
        >
          Actual Deals
        </button>
        <button
          data-testid="tab-hypothetical"
          onClick={() => setTab('hypothetical')}
          style={tabButtonStyle(tab === 'hypothetical')}
        >
          Hypothetical Builder
        </button>
      </div>

      {tab === 'actual' ? <ActualDealsTab /> : <HypotheticalBuilderTab />}
    </PortalCard>
  );
}

/**
 * Producer deal simulation API contract types.
 *
 * These are the stub-era shared types for the producer-facing simulation seam
 * introduced for issue #187. The transport names follow the current worker
 * infrastructure contract (`producer_simulation` / `simulation_agent`) even
 * though the feature issue body uses broader user-facing wording.
 *
 * Canonical docs:
 *   - docs/prd.md §5.9
 *   - docs/arbitration-simulation.md
 * Issue: feat: Producer Deal Simulation — payout + dispute-risk forecasting (#187)
 */

/** Request body for POST /producer/simulations/actual. */
export interface ActualDealSimulationRequest {
  deal_id: string;
  producer_id?: string;
  client_id?: string;
}

/** Request body for POST /producer/simulations/hypothetical. */
export interface HypotheticalDealSimulationRequest {
  amount: number;
  tier: string;
  bonus_season_flag: boolean;
  accrual_percent: number;
  producer_id?: string;
  client_id?: string;
}

/** Shared simulation forecast returned by the API. */
export interface DealSimulationForecast {
  payout_estimate: number;
  dispute_risk: string;
  reasoning: string;
}

/**
 * Async-enqueue envelope returned by POST /producer/simulations/{actual,hypothetical}.
 * The forecast is produced asynchronously by the simulation worker; clients poll
 * GET /producer/simulations and read result_json for `simulation_id`.
 */
export interface SimulationPendingResponse {
  status: 'pending';
  /** simulation_run id to poll for the forecast. */
  simulation_id: string;
  /** task_queue id of the enqueued producer_simulation job. */
  job_id: string;
  /** Single-use delegated token (demo worker convenience; not used by the UI). */
  result_token?: string;
}

/** History row planned for the simulation_run table. */
export interface SimulationRunRecord {
  id: string;
  producer_id: string;
  org_id: string;
  job_id: string;
  input_params: Record<string, unknown>;
  result_json: DealSimulationForecast | null;
  created_at: string;
  ttl_expires_at: string;
}

/** GET /producer/simulations response envelope. */
export interface SimulationRunHistoryResponse {
  simulation_runs: SimulationRunRecord[];
}

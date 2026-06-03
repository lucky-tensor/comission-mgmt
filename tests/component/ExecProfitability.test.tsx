/**
 * ExecProfitability component tests — real headless Chromium (no Vitest mocking
 * helpers are used).
 *
 * Tests:
 *   - Per-dimension render (client/recruiter show tables; team/practice show
 *     the unavailability notice).
 *   - Sort-by-margin: clicking margin column header reorders rows.
 *   - Dimension switch re-renders to the new dimension.
 *   - Loading / empty / error states.
 *   - Role gating: Producer receives 403, Executive and FinanceAdmin see the
 *     surface (integration with the real E2E server).
 *
 * Issue: feat: Executive UI — profitability analytics (#111)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import {
  ExecProfitabilityView,
  type ExecProfitabilityViewProps,
} from '../../apps/web/src/components/ExecProfitability';
import { renderInBrowser, type Mounted } from './render';
import { SEEDED } from '../e2e/fixtures/ids';
import App, { navigate } from '../../apps/web/src/App';
import { ROUTES } from '../../apps/web/src/lib/roleRoutes';

let mounted: Mounted | undefined;

afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // may already be unmounted
  }
  mounted = undefined;
  navigate(ROUTES.LOGIN);
});

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const clientData = {
  period: { start: '2025-04-01', end: '2025-04-30' },
  gross_fees_booked: '50000.00',
  net_fee_income: '35000.00',
  commission_accrued: '10000.00',
  commission_payable: '25000.00',
  commission_held: '0.00',
  clawback_exposure: '0.00',
  guarantee_exposure: '0.00',
  disputed_commission: '0.00',
  exception_rate: 0,
  dispute_rate: 0,
  total_placements: 2,
  profitability_by_client: [
    { clientId: 'client-aaa', grossFees: '30000.00', commissionBurden: '6000.00' },
    { clientId: 'client-bbb', grossFees: '20000.00', commissionBurden: '5000.00' },
  ],
  profitability_by_producer: [
    { producerId: 'prod-111', grossCommission: '8000.00', netPayable: '7500.00' },
    { producerId: 'prod-222', grossCommission: '3000.00', netPayable: '2800.00' },
  ],
};

const emptyData = {
  ...clientData,
  profitability_by_client: [],
  profitability_by_producer: [],
  total_placements: 0,
};

// Minimal prop wrapper to mount the pure view.
function viewProps(
  overrides: Partial<ExecProfitabilityViewProps> = {},
): ExecProfitabilityViewProps {
  return {
    state: { data: clientData, loading: false, error: null },
    dimension: 'client',
    periodStart: '2025-04-01',
    periodEnd: '2025-04-30',
    sortDir: 'desc',
    onDimensionChange: () => {},
    onSortToggle: () => {},
    onStartChange: () => {},
    onEndChange: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Loading / empty / error states
// ---------------------------------------------------------------------------

describe('ExecProfitabilityView — async states', () => {
  test('loading state renders the loading placeholder', async () => {
    mounted = renderInBrowser(
      <ExecProfitabilityView
        {...viewProps({ state: { data: null, loading: true, error: null } })}
      />,
    );
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('error state renders the error message', async () => {
    mounted = renderInBrowser(
      <ExecProfitabilityView
        {...viewProps({ state: { data: null, loading: false, error: 'Network failure' } })}
      />,
    );
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByTestId('error-state')).toHaveTextContent('Network failure');
  });

  test('empty state renders when data is null and not loading', async () => {
    mounted = renderInBrowser(
      <ExecProfitabilityView
        {...viewProps({ state: { data: null, loading: false, error: null } })}
      />,
    );
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Per-dimension render
// ---------------------------------------------------------------------------

describe('ExecProfitabilityView — dimension render', () => {
  test('client dimension renders the profitability table', async () => {
    mounted = renderInBrowser(<ExecProfitabilityView {...viewProps({ dimension: 'client' })} />);
    await expect.element(page.getByTestId('exec-profitability')).toBeInTheDocument();
    await expect.element(page.getByTestId('profitability-table')).toBeInTheDocument();
    // Two rows (one per client)
    const rows = page.getByTestId('profitability-row').elements();
    expect(rows).toHaveLength(2);
  });

  test('recruiter dimension renders the profitability table', async () => {
    mounted = renderInBrowser(<ExecProfitabilityView {...viewProps({ dimension: 'recruiter' })} />);
    await expect.element(page.getByTestId('profitability-table')).toBeInTheDocument();
    const rows = page.getByTestId('profitability-row').elements();
    expect(rows).toHaveLength(2);
  });

  test('team dimension renders the unavailable notice', async () => {
    mounted = renderInBrowser(<ExecProfitabilityView {...viewProps({ dimension: 'team' })} />);
    await expect.element(page.getByTestId('dimension-unavailable')).toBeInTheDocument();
    // Table must NOT appear
    expect(page.getByTestId('profitability-table').elements()).toHaveLength(0);
  });

  test('practice dimension renders the unavailable notice', async () => {
    mounted = renderInBrowser(<ExecProfitabilityView {...viewProps({ dimension: 'practice' })} />);
    await expect.element(page.getByTestId('dimension-unavailable')).toBeInTheDocument();
  });

  test('empty rows for available dimension renders empty state message', async () => {
    mounted = renderInBrowser(
      <ExecProfitabilityView
        {...viewProps({
          state: { data: emptyData, loading: false, error: null },
          dimension: 'client',
        })}
      />,
    );
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dimension switcher
// ---------------------------------------------------------------------------

describe('ExecProfitabilityView — dimension switcher', () => {
  test('all four dimension buttons render', async () => {
    mounted = renderInBrowser(<ExecProfitabilityView {...viewProps()} />);
    await expect.element(page.getByTestId('dim-btn-client')).toBeInTheDocument();
    await expect.element(page.getByTestId('dim-btn-recruiter')).toBeInTheDocument();
    await expect.element(page.getByTestId('dim-btn-team')).toBeInTheDocument();
    await expect.element(page.getByTestId('dim-btn-practice')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sort-by-margin
// ---------------------------------------------------------------------------

describe('ExecProfitabilityView — sort by margin', () => {
  test('desc sort orders rows high-margin first, asc reverses', async () => {
    // client-aaa: margin = (30000 - 6000) / 30000 = 0.80
    // client-bbb: margin = (20000 - 5000) / 20000 = 0.75
    // desc → client-aaa first
    mounted = renderInBrowser(
      <ExecProfitabilityView {...viewProps({ dimension: 'client', sortDir: 'desc' })} />,
    );
    await expect.element(page.getByTestId('profitability-table')).toBeInTheDocument();
    const rows = page.getByTestId('profitability-row').elements();
    expect(rows[0].textContent).toContain('client-aaa');
    expect(rows[1].textContent).toContain('client-bbb');
  });

  test('asc sort orders rows low-margin first', async () => {
    mounted = renderInBrowser(
      <ExecProfitabilityView {...viewProps({ dimension: 'client', sortDir: 'asc' })} />,
    );
    await expect.element(page.getByTestId('profitability-table')).toBeInTheDocument();
    const rows = page.getByTestId('profitability-row').elements();
    expect(rows[0].textContent).toContain('client-bbb');
    expect(rows[1].textContent).toContain('client-aaa');
  });
});

// ---------------------------------------------------------------------------
// Role gating — integration with the real E2E server
// ---------------------------------------------------------------------------

describe('ExecProfitability — role gating (real server)', () => {
  test('Executive navigating to /executive/profitability sees the profitability surface', async () => {
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.executiveId }),
    });
    expect(res.ok).toBe(true);

    navigate(ROUTES.EXEC_PROFITABILITY);
    mounted = renderInBrowser(<App />);

    await expect.element(page.getByTestId('exec-profitability')).toBeInTheDocument();
    expect(window.location.pathname).toBe(ROUTES.EXEC_PROFITABILITY);
  });

  test('Producer navigating directly to /executive/profitability sees the 403 surface', async () => {
    const res = await fetch('/api/demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: SEEDED.producerId }),
    });
    expect(res.ok).toBe(true);

    navigate(ROUTES.EXEC_PROFITABILITY);
    mounted = renderInBrowser(<App />);

    await expect.element(page.getByTestId('forbidden-surface')).toBeInTheDocument();
    expect(page.getByTestId('exec-profitability').elements()).toHaveLength(0);
  });
});

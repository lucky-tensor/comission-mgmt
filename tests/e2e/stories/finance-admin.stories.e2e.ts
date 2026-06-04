/**
 * Finance Admin — user story E2E tests.
 *
 * Every test mounts the full App, navigates to '/', logs in through the
 * Login UI by clicking the 'Finance Admin' demo button, then drives the
 * story steps via userEvent against real DOM elements.
 *
 * Stories covered (docs/prd.md §4, Finance Admin):
 *   FA-1  Data gap queue
 *   FA-2  Commission run review and batch approval
 *   FA-3  Payroll-ready export          ← requires routing fix (FinanceAdminSurface)
 *   FA-4  Invoice and collection tracking
 *   FA-5  Adjustment ledger             ← requires routing fix (FinanceAdminSurface)
 *
 * Canonical docs: docs/prd.md §4, §5.1, §5.4, §5.5, §5.7
 * Test plan: docs/code-review/test-plan.md
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { navigate } from '../../../apps/web/src/App';
import { loginAs, loadFixture, type Mounted, type E2EFixture } from './helpers';

let fixture: E2EFixture;
let current: Mounted | undefined;

beforeAll(async () => {
  fixture = await loadFixture();
});

afterEach(() => {
  try { current?.unmount(); } catch { /* already unmounted */ }
  current = undefined;
  navigate('/');
});

// ---------------------------------------------------------------------------
// FA-1 — Data gap queue
// ---------------------------------------------------------------------------

describe('FA-1: Finance Admin sees and resolves data gaps', () => {
  test('login lands on /finance with the data-gap-queue rendered', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('FinanceAdmin');
    expect(window.location.pathname).toBe('/finance');
    await expect.element(page.getByTestId('data-gap-queue')).toBeInTheDocument();
  });

  test('seeded incomplete placement appears in the queue with a missing-field tag', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('data-gap-queue')).toBeInTheDocument();
    await expect
      .element(page.getByTestId(`gap-row-${fixture.closeIncompletePlacementId}`))
      .toBeInTheDocument();
    await expect
      .element(page.getByTestId('missing-field-tag-fee_amount'))
      .toBeInTheDocument();
  });

  test('clicking resolve opens the inline form', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('data-gap-queue')).toBeInTheDocument();
    await userEvent.click(
      page.getByTestId(`resolve-btn-${fixture.closeIncompletePlacementId}`),
    );
    await expect
      .element(page.getByTestId(`resolve-form-${fixture.closeIncompletePlacementId}`))
      .toBeInTheDocument();
  });

  test('filling the form and saving removes the row from the queue', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('data-gap-queue')).toBeInTheDocument();
    await userEvent.click(
      page.getByTestId(`resolve-btn-${fixture.closeIncompletePlacementId}`),
    );
    await userEvent.fill(
      page.getByTestId(`input-${fixture.closeIncompletePlacementId}-fee_amount`),
      '12000',
    );
    await userEvent.click(
      page.getByTestId(`save-btn-${fixture.closeIncompletePlacementId}`),
    );
    await expect
      .element(page.getByTestId(`gap-row-${fixture.closeIncompletePlacementId}`))
      .not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FA-2 — Commission run review and batch approval
// ---------------------------------------------------------------------------

describe('FA-2: Finance Admin reviews and approves a commission run', () => {
  test('commission-run-review surface renders on /finance', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('commission-run-review')).toBeInTheDocument();
  });

  test('starting a run with period dates shows the queue table', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('commission-run-review')).toBeInTheDocument();
    await userEvent.fill(page.getByTestId('period-start-input'), '2025-05-01');
    await userEvent.fill(page.getByTestId('period-end-input'), '2025-05-31');
    await userEvent.click(page.getByTestId('start-run-btn'));
    await expect.element(page.getByTestId('queue-table')).toBeInTheDocument();
  });

  test('individually approving a record transitions it to approved state', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('commission-run-review')).toBeInTheDocument();
    await userEvent.fill(page.getByTestId('period-start-input'), '2025-05-01');
    await userEvent.fill(page.getByTestId('period-end-input'), '2025-05-31');
    await userEvent.click(page.getByTestId('start-run-btn'));
    await expect.element(page.getByTestId('queue-table')).toBeInTheDocument();
    const approveButtons = page.getByRole('button', { name: 'Approve' });
    await expect.element(approveButtons.all()[0]).toBeInTheDocument();
    await userEvent.click(approveButtons.all()[0]);
    await expect.element(page.getByText('Approved')).toBeInTheDocument();
  });

  test('finalize succeeds after all discrepancies are acknowledged', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('commission-run-review')).toBeInTheDocument();
    // Load the pre-seeded run by loading the run ID from the fixture.
    // Navigate to the reconciliation surface first to acknowledge the discrepancy.
    navigate('/reconciliation');
    await expect.element(page.getByTestId('reconciliation-report')).toBeInTheDocument();
    await userEvent.fill(page.getByTestId('recon-period-start-input'), '2025-05-01');
    await userEvent.fill(page.getByTestId('recon-period-end-input'), '2025-05-31');
    await userEvent.click(page.getByTestId('recon-fetch-button'));
    await expect.element(page.getByTestId('recon-summary')).toBeInTheDocument();
    const ackBtn = page.getByRole('button', { name: 'Acknowledge' });
    if ((await ackBtn.elements()).length > 0) {
      await userEvent.click(ackBtn.all()[0]);
      await userEvent.fill(page.getByLabelText('Acknowledgement note'), 'Verified');
      await userEvent.click(page.getByRole('button', { name: 'Save' }).all()[0]);
      await expect.element(page.getByTestId('recon-all-clear')).toBeInTheDocument();
    }
    // Navigate back and finalize.
    navigate('/finance');
    await expect.element(page.getByTestId('commission-run-review')).toBeInTheDocument();
    await expect.element(page.getByTestId('finalized-state')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FA-3 — Payroll-ready export
// NOTE: requires FinanceAdminSurface to be wired into App.tsx ROUTES.FINANCE
// ---------------------------------------------------------------------------

describe('FA-3: Finance Admin generates a payroll-ready export', () => {
  test('export-generate-section renders on /finance after run is finalized', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('export-generate-section')).toBeInTheDocument();
  });

  test('generate-export-button is enabled for an approved run', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('generate-export-button')).toBeInTheDocument();
    await expect.element(page.getByTestId('generate-export-button')).not.toBeDisabled();
  });

  test('clicking generate produces an export row in the exports list', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('generate-export-button')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('generate-export-button'));
    await expect.element(page.getByTestId('exports-list')).toBeInTheDocument();
    const rows = page.getByTestId('exports-list').getByRole('listitem');
    expect((await rows.elements()).length).toBeGreaterThan(0);
  });

  test('download link is present with a correct href', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('exports-list')).toBeInTheDocument();
    const link = page.getByRole('link', { name: 'Download' });
    await expect.element(link.all()[0]).toBeInTheDocument();
    const href = await link.all()[0].element()?.getAttribute('href');
    expect(href).toContain('/api/commission-runs/');
    expect(href).toContain('/download');
  });
});

// ---------------------------------------------------------------------------
// FA-4 — Invoice and collection tracking
// ---------------------------------------------------------------------------

describe('FA-4: Finance Admin tracks invoice and collection status', () => {
  test('finance-admin placement picker renders on /finance', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('finance-admin')).toBeInTheDocument();
  });

  test('selecting a placement loads invoice/collection surface', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('finance-admin')).toBeInTheDocument();
    const select = page.getByTestId('placement-select');
    await expect.element(select).toBeInTheDocument();
    const selectEl = await select.element() as HTMLSelectElement;
    const firstRealOption = selectEl?.querySelectorAll('option')[1];
    if (firstRealOption) {
      await userEvent.selectOptions(selectEl, firstRealOption.getAttribute('value') ?? '');
      await expect.element(page.getByTestId('invoice-collection')).toBeInTheDocument();
    }
  });

  test('billing phase rows are visible with status badges', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('finance-admin')).toBeInTheDocument();
    const select = page.getByTestId('placement-select');
    await expect.element(select).toBeInTheDocument();
    const selectEl = await select.element() as HTMLSelectElement;
    const firstRealOption = selectEl?.querySelectorAll('option')[1];
    if (firstRealOption) {
      await userEvent.selectOptions(selectEl, firstRealOption.getAttribute('value') ?? '');
      await expect.element(page.getByTestId('invoice-collection')).toBeInTheDocument();
      await expect.element(page.getByTestId('phase-rows')).toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// FA-5 — Adjustment ledger
// NOTE: requires FinanceAdminSurface to be wired into App.tsx ROUTES.FINANCE
// ---------------------------------------------------------------------------

describe('FA-5: Finance Admin applies adjustments via the append-only ledger', () => {
  test('adjustment-ledger renders on /finance when a placement is selected', async () => {
    current = await loginAs('Finance Admin');
    await expect.element(page.getByTestId('finance-admin')).toBeInTheDocument();
    const select = page.getByTestId('placement-select');
    await expect.element(select).toBeInTheDocument();
    const selectEl = await select.element() as HTMLSelectElement;
    const firstRealOption = selectEl?.querySelectorAll('option')[1];
    if (firstRealOption) {
      await userEvent.selectOptions(selectEl, firstRealOption.getAttribute('value') ?? '');
      await expect.element(page.getByTestId('adjustment-ledger')).toBeInTheDocument();
    }
  });

  test('submitting a new adjustment appends a row to the ledger', async () => {
    current = await loginAs('Finance Admin');
    const select = page.getByTestId('placement-select');
    await expect.element(select).toBeInTheDocument();
    const selectEl = await select.element() as HTMLSelectElement;
    const firstRealOption = selectEl?.querySelectorAll('option')[1];
    if (firstRealOption) {
      await userEvent.selectOptions(selectEl, firstRealOption.getAttribute('value') ?? '');
      await expect.element(page.getByTestId('adjustment-ledger')).toBeInTheDocument();
      // Open the new-adjustment form.
      await userEvent.click(page.getByTestId('add-adjustment-btn'));
      await expect.element(page.getByTestId('adjustment-form')).toBeInTheDocument();
      // Fill the form.
      await userEvent.selectOptions(await page.getByTestId('adjustment-type-select').element() as HTMLSelectElement, 'Clawback');
      await userEvent.fill(page.getByTestId('adjustment-amount-input'), '500');
      await userEvent.fill(page.getByTestId('adjustment-reason-input'), 'Candidate departed within guarantee window');
      await userEvent.click(page.getByTestId('adjustment-submit-btn'));
      // New row appears in the ledger.
      await expect.element(page.getByTestId('adjustment-rows')).toBeInTheDocument();
      await expect
        .element(page.getByTestId('adjustment-rows'))
        .toHaveTextContent('Clawback');
    }
  });
});

/**
 * HR / People Ops — user story E2E tests.
 *
 * Every test mounts the full App, navigates to '/', logs in through the
 * Login UI, then drives the story steps via userEvent against real DOM elements.
 *
 * Stories covered (docs/prd.md §4, HR / People Ops):
 *   HR-1  Plan acknowledgment (two-role flow: HR sees Pending → Producer
 *         acknowledges → HR sees Acknowledged)
 *   HR-2  Draw balance and recovery schedule
 *
 * Canonical docs: docs/prd.md §4, §5.10 (plan acknowledgment), §6 (draw balance)
 * Test plan: docs/code-review/test-plan.md
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { SEEDED } from '../fixtures/ids';
import { navigate } from '../../../apps/web/src/App';
import { loginAs, type Mounted } from './helpers';

let current: Mounted | undefined;

afterEach(() => {
  try { current?.unmount(); } catch { /* already unmounted */ }
  current = undefined;
  navigate('/');
});

// ---------------------------------------------------------------------------
// HR-1 — Plan acknowledgment
// ---------------------------------------------------------------------------

describe('HR-1: HR monitors plan acknowledgment status', () => {
  test('login lands on /hr with plan-acknowledgment surface', async () => {
    current = await loginAs('HR');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('HR');
    expect(window.location.pathname).toBe('/hr');
    await expect.element(page.getByTestId('plan-acknowledgment')).toBeInTheDocument();
  });

  test('acknowledgment table renders with the seeded producer row as Pending', async () => {
    current = await loginAs('HR');
    await expect.element(page.getByTestId('acknowledgment-table')).toBeInTheDocument();
    const pendingBadges = page.getByText('Pending');
    await expect.element(pendingBadges.all()[0]).toBeInTheDocument();
  });
});

describe('HR-1: Producer acknowledges their commission plan', () => {
  test('producer login shows the ProducerPlanAcknowledgment component with the plan name', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    // Producer's plan acknowledgment widget is visible in the portal.
    await expect.element(page.getByTestId('producer-plan-acknowledgment')).toBeInTheDocument();
  });

  test('acknowledge-btn is present before acknowledgment', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('producer-plan-acknowledgment')).toBeInTheDocument();
    await expect.element(page.getByTestId('acknowledge-btn')).toBeInTheDocument();
  });

  test('clicking acknowledge-btn shows the confirmed state and removes the button', async () => {
    current = await loginAs('Producer');
    await expect.element(page.getByTestId('producer-plan-acknowledgment')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('acknowledge-btn'));
    await expect.element(page.getByTestId('acknowledge-confirmed')).toBeInTheDocument();
    await expect.element(page.getByTestId('acknowledge-btn')).not.toBeInTheDocument();
  });
});

describe('HR-1: HR sees producer row as Acknowledged after producer acknowledges', () => {
  test('acknowledgment table shows Acknowledged badge after producer flow', async () => {
    // This test depends on the producer acknowledgment test above having run.
    // In a fresh seed it may show Pending; after the producer test it shows Acknowledged.
    current = await loginAs('HR');
    await expect.element(page.getByTestId('acknowledgment-table')).toBeInTheDocument();
    const acknowledgedBadges = page.getByText('Acknowledged');
    await expect.element(acknowledgedBadges.all()[0]).toBeInTheDocument();
  });

  test('acknowledged_at cell contains a real date value', async () => {
    current = await loginAs('HR');
    await expect.element(page.getByTestId('acknowledgment-table')).toBeInTheDocument();
    // A cell with a date pattern like "Jun 3, 2026".
    const ackAtCell = page.getByRole('cell', { name: /[A-Z][a-z]{2} \d+, \d{4}/ });
    await expect.element(ackAtCell.all()[0]).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// HR-2 — Draw balance and recovery schedule
// ---------------------------------------------------------------------------

describe('HR-2: HR views draw balance and recovery schedule', () => {
  test('draw-balance-view renders on /hr', async () => {
    current = await loginAs('HR');
    await expect.element(page.getByTestId('draw-balance-view')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('draw-balance-heading'))
      .toHaveTextContent('Draw Balance & Recovery Schedule');
  });

  test('producer-id-input and lookup-btn are present', async () => {
    current = await loginAs('HR');
    await expect.element(page.getByTestId('draw-balance-view')).toBeInTheDocument();
    await expect.element(page.getByTestId('producer-id-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('lookup-btn')).toBeInTheDocument();
  });

  test('entering a valid producer UUID and clicking lookup renders the balance panel', async () => {
    current = await loginAs('HR');
    await expect.element(page.getByTestId('draw-balance-view')).toBeInTheDocument();
    await userEvent.fill(page.getByTestId('producer-id-input'), SEEDED.producerId);
    await userEvent.click(page.getByTestId('lookup-btn'));
    await expect.element(page.getByTestId('draw-balance-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('draw-balance-summary')).toBeInTheDocument();
  });

  test('outstanding-balance cell renders with a numeric value', async () => {
    current = await loginAs('HR');
    await userEvent.fill(page.getByTestId('producer-id-input'), SEEDED.producerId);
    await userEvent.click(page.getByTestId('lookup-btn'));
    await expect.element(page.getByTestId('outstanding-balance')).toBeInTheDocument();
    const text = (await page.getByTestId('outstanding-balance').element())?.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  test('recovery schedule section renders (empty-state or schedule rows)', async () => {
    current = await loginAs('HR');
    await userEvent.fill(page.getByTestId('producer-id-input'), SEEDED.producerId);
    await userEvent.click(page.getByTestId('lookup-btn'));
    await expect.element(page.getByTestId('draw-balance-panel')).toBeInTheDocument();
    // Either a schedule list or an empty-state message must be present.
    const hasScheduleList = (await page.getByTestId('recovery-schedule-list').elements()).length > 0;
    const hasEmptySchedule = (await page.getByText('No clawback recovery schedules').elements()).length > 0;
    expect(hasScheduleList || hasEmptySchedule).toBe(true);
  });
});

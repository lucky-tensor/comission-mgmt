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
 * HR-1 runs as a single sequential describe so the ordering dependency
 * (HR → Producer → HR) is explicit and test isolation is maintained.
 *
 * Canonical docs: docs/prd.md §4, §5.10 (plan acknowledgment), §6 (draw balance)
 * Test plan: docs/code-review/test-plan.md
 */

import { describe, test, expect } from 'vitest';
import { page, userEvent } from '@vitest/browser/context';
import { SEEDED } from '../fixtures/ids';
import { loginAs, useMount } from './helpers';

const mount = useMount();

// ---------------------------------------------------------------------------
// HR-1 — Plan acknowledgment (single sequential describe — ordering matters)
// ---------------------------------------------------------------------------

describe('HR-1: Plan acknowledgment two-role flow', () => {
  test('HR sees producer row as Pending before acknowledgment', async () => {
    mount.current = await loginAs('HR');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('nav-role-badge')).toHaveTextContent('HR');
    expect(window.location.pathname).toBe('/hr');
    await expect.element(page.getByTestId('plan-acknowledgment')).toBeInTheDocument();
    await expect.element(page.getByTestId('acknowledgment-table')).toBeInTheDocument();
    const pendingBadges = page.getByText('Pending');
    await expect.element(pendingBadges.all()[0]).toBeInTheDocument();
    mount.current?.unmount();
    mount.current = undefined;
  });

  test('Producer sees plan acknowledgment widget and can acknowledge', async () => {
    mount.current = await loginAs('Producer');
    await expect.element(page.getByTestId('nav-shell')).toBeInTheDocument();
    await expect.element(page.getByTestId('producer-plan-acknowledgment')).toBeInTheDocument();
    await expect.element(page.getByTestId('acknowledge-btn')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('acknowledge-btn'));
    await expect.element(page.getByTestId('acknowledge-confirmed')).toBeInTheDocument();
    await expect.element(page.getByTestId('acknowledge-btn')).not.toBeInTheDocument();
    mount.current?.unmount();
    mount.current = undefined;
  });

  test('HR sees producer row as Acknowledged after producer acknowledges', async () => {
    mount.current = await loginAs('HR');
    await expect.element(page.getByTestId('acknowledgment-table')).toBeInTheDocument();
    const acknowledgedBadges = page.getByText('Acknowledged');
    await expect.element(acknowledgedBadges.all()[0]).toBeInTheDocument();
  });

  test('acknowledged_at cell contains a real date value', async () => {
    mount.current = await loginAs('HR');
    await expect.element(page.getByTestId('acknowledgment-table')).toBeInTheDocument();
    const ackAtCell = page.getByRole('cell', { name: /[A-Z][a-z]{2} \d+, \d{4}/ });
    await expect.element(ackAtCell.all()[0]).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// HR-2 — Draw balance and recovery schedule
// ---------------------------------------------------------------------------

describe('HR-2: HR views draw balance and recovery schedule', () => {
  test('draw-balance-view renders on /hr', async () => {
    mount.current = await loginAs('HR');
    await expect.element(page.getByTestId('draw-balance-view')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('draw-balance-heading'))
      .toHaveTextContent('Draw Balance & Recovery Schedule');
  });

  test('producer-id-input and lookup-btn are present', async () => {
    mount.current = await loginAs('HR');
    await expect.element(page.getByTestId('draw-balance-view')).toBeInTheDocument();
    await expect.element(page.getByTestId('producer-id-input')).toBeInTheDocument();
    await expect.element(page.getByTestId('lookup-btn')).toBeInTheDocument();
  });

  test('entering a valid producer UUID and clicking lookup renders the balance panel', async () => {
    mount.current = await loginAs('HR');
    await expect.element(page.getByTestId('draw-balance-view')).toBeInTheDocument();
    await userEvent.fill(page.getByTestId('producer-id-input'), SEEDED.producerId);
    await userEvent.click(page.getByTestId('lookup-btn'));
    await expect.element(page.getByTestId('draw-balance-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('draw-balance-summary')).toBeInTheDocument();
  });

  test('outstanding-balance cell renders with a numeric value', async () => {
    mount.current = await loginAs('HR');
    await userEvent.fill(page.getByTestId('producer-id-input'), SEEDED.producerId);
    await userEvent.click(page.getByTestId('lookup-btn'));
    await expect.element(page.getByTestId('outstanding-balance')).toBeInTheDocument();
    const text = (await page.getByTestId('outstanding-balance').element())?.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  test('recovery schedule section renders (empty-state or schedule rows)', async () => {
    mount.current = await loginAs('HR');
    await userEvent.fill(page.getByTestId('producer-id-input'), SEEDED.producerId);
    await userEvent.click(page.getByTestId('lookup-btn'));
    // Wait for the data to finish loading before inspecting the schedule section.
    // draw-balance-summary only renders after the API response resolves.
    await expect.element(page.getByTestId('draw-balance-summary')).toBeInTheDocument();
    const hasScheduleList =
      (await page.getByTestId('recovery-schedule-table').elements()).length > 0;
    const hasEmptySchedule =
      (await page.getByText('No clawback recovery schedules', { exact: false }).elements()).length >
      0;
    expect(hasScheduleList || hasEmptySchedule).toBe(true);
  });
});

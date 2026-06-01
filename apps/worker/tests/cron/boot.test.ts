/**
 * Cron boot smoke tests — verify that startCronScheduler() initialises without
 * throwing against a real ephemeral Postgres.
 *
 * The guarantee-expiry cron job (and future jobs) are registered in boot.ts.
 * A misconfigured import or broken registration would fail at this point, so
 * the boot test acts as the first line of defence for scheduler wiring.
 *
 * Boot does NOT require a live DB connection to start — the scheduler only
 * enqueues tasks when its handler fires on a tick. These tests verify that the
 * registration and start cycle completes successfully and that the scheduler can
 * be stopped cleanly.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, Cron scheduler
 * Issue: test: cron/scheduler integration tests — scheduler wiring (#89)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { startCronScheduler, stopCronScheduler } from '../../../../apps/server/src/cron/boot';

afterEach(() => {
  // Always stop the scheduler between tests to avoid leaked intervals.
  stopCronScheduler();
});

describe('boot — startCronScheduler()', () => {
  test('resolves without throwing', () => {
    expect(() => startCronScheduler()).not.toThrow();
  });

  test('returns a CronScheduler instance that is started', () => {
    const scheduler = startCronScheduler();
    expect(scheduler).toBeDefined();
    expect(scheduler.isStarted()).toBe(true);
  });

  test('registers at least one job', () => {
    const scheduler = startCronScheduler();
    const names = scheduler.getJobNames();
    expect(names.length).toBeGreaterThanOrEqual(1);
  });

  test('is idempotent — calling twice returns the same scheduler instance', () => {
    const first = startCronScheduler();
    const second = startCronScheduler();
    expect(first).toBe(second);
  });

  test('stopCronScheduler() stops all jobs cleanly', () => {
    const scheduler = startCronScheduler();
    expect(scheduler.isStarted()).toBe(true);
    stopCronScheduler();
    expect(scheduler.isStarted()).toBe(false);
  });
});

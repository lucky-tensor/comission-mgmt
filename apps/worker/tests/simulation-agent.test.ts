/**
 * Producer Deal Simulator — worker executeSimulationTask tests (issue #262).
 *
 * Hermetic: the `claude` CLI subprocess is mocked via the injectable
 * ClaudeCliSpawn so no real binary is invoked. Covers:
 *   - success: mocked CLI stdout parsed into { payout_estimate, dispute_risk, reasoning }
 *   - timeout: subprocess timeout → graceful failed task (no partial forecast)
 *   - spawn_error: binary missing → graceful failed task, retriable
 *   - parse_error: malformed CLI output → graceful failed task
 *   - prompt: references the producer's plan context (explainability)
 *
 * Canonical docs: docs/prd.md §5.9, §9; docs/arbitration-simulation.md
 */

import { describe, test, expect } from 'vitest';
import type { ClaudeCliSpawn } from 'db';
import {
  executeSimulationTask,
  buildSimulationPrompt,
  parseSimulationForecast,
  type SimulationTaskPayload,
} from '../src/agents/simulation';

const actualPayload: SimulationTaskPayload = {
  kind: 'actual',
  simulation_run_id: crypto.randomUUID(),
  deal_id: crypto.randomUUID(),
  bonus_season_flag: false,
  plan_context: { plan_version_id: 'pv-1', plan_name: 'Standard Plan', base_rate: 0.25 },
  deal_context: { job_title: 'Senior Recruiter', fee_amount: '20000' },
};

/** A mocked CLI that emits the given stdout with a clean exit. */
function okSpawn(stdout: string): ClaudeCliSpawn {
  return async () => ({ code: 0, timedOut: false, stdout, stderr: '' });
}

describe('executeSimulationTask (mocked CLI subprocess)', () => {
  test('parses a clean JSON forecast from CLI stdout', async () => {
    const spawn = okSpawn(
      JSON.stringify({
        payout_estimate: 5000,
        dispute_risk: 'low',
        reasoning: 'Standard Plan 25% on the $20,000 fee yields $5,000.',
      }),
    );
    const result = await executeSimulationTask('task-1', actualPayload, 'tok', spawn);
    expect(result.status).toBe('success');
    expect(result.result_or_error.payout_estimate).toBe(5000);
    expect(result.result_or_error.dispute_risk).toBe('low');
    expect(result.result_or_error.reasoning).toContain('Standard Plan');
  });

  test('tolerates code-fenced JSON output', async () => {
    const spawn = okSpawn(
      '```json\n{"payout_estimate": 7500, "dispute_risk": "moderate", "reasoning": "Tiered rate applied."}\n```',
    );
    const result = await executeSimulationTask('task-2', actualPayload, 'tok', spawn);
    expect(result.status).toBe('success');
    expect(result.result_or_error.payout_estimate).toBe(7500);
  });

  test('subprocess timeout yields a graceful failed task (retriable, no partial forecast)', async () => {
    const spawn: ClaudeCliSpawn = async () => ({
      code: null,
      timedOut: true,
      stdout: '',
      stderr: '',
    });
    const result = await executeSimulationTask('task-3', actualPayload, 'tok', spawn);
    expect(result.status).toBe('error');
    expect(result.result_or_error.payout_estimate).toBeUndefined();
    expect(result.result_or_error.retriable).toBe(true);
    expect(result.result_or_error.error).toContain('exceeded');
  });

  test('spawn failure (binary missing) yields a graceful failed task', async () => {
    const spawn: ClaudeCliSpawn = async () => ({
      code: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      spawnError: new Error('ENOENT'),
    });
    const result = await executeSimulationTask('task-4', actualPayload, 'tok', spawn);
    expect(result.status).toBe('error');
    expect(result.result_or_error.retriable).toBe(true);
  });

  test('malformed CLI output yields a parse-error failed task (no partial forecast)', async () => {
    const result = await executeSimulationTask(
      'task-5',
      actualPayload,
      'tok',
      okSpawn('not json at all'),
    );
    expect(result.status).toBe('error');
    expect(result.result_or_error.payout_estimate).toBeUndefined();
  });

  test('non-zero exit yields a failed task', async () => {
    const spawn: ClaudeCliSpawn = async () => ({
      code: 1,
      timedOut: false,
      stdout: '',
      stderr: 'boom',
    });
    const result = await executeSimulationTask('task-6', actualPayload, 'tok', spawn);
    expect(result.status).toBe('error');
  });
});

describe('buildSimulationPrompt + parseSimulationForecast', () => {
  test('prompt references the producer plan context for explainability', () => {
    const prompt = buildSimulationPrompt(actualPayload);
    expect(prompt).toContain('plan_context');
    expect(prompt).toContain('Standard Plan');
    expect(prompt).toContain('base_rate');
  });

  test('hypothetical prompt carries the scenario terms', () => {
    const prompt = buildSimulationPrompt({
      kind: 'hypothetical',
      amount: 80000,
      tier: 'senior',
      bonus_season_flag: true,
      accrual_percent: 5,
      plan_context: { base_rate: 0.2 },
    });
    expect(prompt).toContain('hypothetical');
    expect(prompt).toContain('80000');
    expect(prompt).toContain('senior');
  });

  test('parseSimulationForecast rejects missing fields', () => {
    expect(() => parseSimulationForecast('{"payout_estimate": 1}')).toThrow();
    expect(() => parseSimulationForecast('{}')).toThrow();
    expect(() =>
      parseSimulationForecast('{"payout_estimate": 1, "dispute_risk": "low", "reasoning": ""}'),
    ).toThrow();
  });
});

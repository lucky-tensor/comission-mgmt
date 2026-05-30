/**
 * Unit tests for packages/core/clawback-ledger.ts
 *
 * Verifies that the stub enums and no-op implementation compile and return safe defaults.
 *
 * No database required — pure in-memory stub assertions.
 *
 * Test plan (issue #27):
 *   Compile test: build step exits 0 with all stubs
 */

import { describe, it, expect } from 'vitest';
import {
  CLAWBACK_EVENT_TYPES,
  CLAWBACK_RULES,
  NoOpClawbackLedgerAdjuster,
  type ClawbackEventType,
  type ClawbackRule,
  type ClawbackTriggerEvent,
} from '../clawback-ledger';

describe('CLAWBACK_EVENT_TYPES', () => {
  it('includes candidate_departure', () => {
    expect(CLAWBACK_EVENT_TYPES).toContain('candidate_departure' satisfies ClawbackEventType);
  });

  it('includes refund', () => {
    expect(CLAWBACK_EVENT_TYPES).toContain('refund' satisfies ClawbackEventType);
  });

  it('has no duplicate values', () => {
    const unique = new Set(CLAWBACK_EVENT_TYPES);
    expect(unique.size).toBe(CLAWBACK_EVENT_TYPES.length);
  });
});

describe('CLAWBACK_RULES', () => {
  it('includes clawback', () => {
    expect(CLAWBACK_RULES).toContain('clawback' satisfies ClawbackRule);
  });

  it('includes holdback', () => {
    expect(CLAWBACK_RULES).toContain('holdback' satisfies ClawbackRule);
  });

  it('includes refund_credit', () => {
    expect(CLAWBACK_RULES).toContain('refund_credit' satisfies ClawbackRule);
  });

  it('includes replacement_search', () => {
    expect(CLAWBACK_RULES).toContain('replacement_search' satisfies ClawbackRule);
  });

  it('has no duplicate values', () => {
    const unique = new Set(CLAWBACK_RULES);
    expect(unique.size).toBe(CLAWBACK_RULES.length);
  });
});

describe('NoOpClawbackLedgerAdjuster', () => {
  const adjuster = new NoOpClawbackLedgerAdjuster();

  const sampleEvent: ClawbackTriggerEvent = {
    placementId: 'placement-123',
    orgId: 'org-456',
    eventType: 'candidate_departure',
    rule: 'clawback',
    occurredAt: '2026-01-15T10:00:00Z',
    triggeredBy: 'user-789',
  };

  it('applyClawback returns empty array without side-effects', async () => {
    const result = await adjuster.applyClawback(sampleEvent);
    expect(result).toEqual([]);
  });

  it('getProducerClawbackExposure returns 0 without side-effects', async () => {
    const result = await adjuster.getProducerClawbackExposure('producer-abc', 'org-456');
    expect(result).toBe(0);
  });
});

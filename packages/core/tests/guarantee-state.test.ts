/**
 * Unit tests for packages/core/guarantee-state.ts
 *
 * Verifies that all 3 PRD guarantee lifecycle states are present (Active, ExpiredClean, Triggered)
 * and that the no-op transition table is structurally sound.
 *
 * No database required — pure in-memory enum assertions.
 *
 * Test plan (issue #27):
 *   Enum test: Guarantee.STATES includes Active, ExpiredClean, Triggered
 */

import { describe, it, expect } from 'vitest';
import {
  GUARANTEE_STATES,
  GUARANTEE_TRANSITIONS,
  canTransitionGuarantee,
  type GuaranteeState,
} from '../guarantee-state';

describe('GUARANTEE_STATES', () => {
  it('contains exactly 3 PRD lifecycle states', () => {
    expect(GUARANTEE_STATES.length).toBe(3);
  });

  it('includes Active', () => {
    expect(GUARANTEE_STATES).toContain('Active' satisfies GuaranteeState);
  });

  it('includes ExpiredClean', () => {
    expect(GUARANTEE_STATES).toContain('ExpiredClean' satisfies GuaranteeState);
  });

  it('includes Triggered', () => {
    expect(GUARANTEE_STATES).toContain('Triggered' satisfies GuaranteeState);
  });

  it('has no duplicate state values', () => {
    const unique = new Set(GUARANTEE_STATES);
    expect(unique.size).toBe(GUARANTEE_STATES.length);
  });
});

describe('GUARANTEE_TRANSITIONS', () => {
  it('has an entry for every state', () => {
    for (const state of GUARANTEE_STATES) {
      expect(GUARANTEE_TRANSITIONS).toHaveProperty(state);
    }
  });

  it('all transition targets are valid states', () => {
    for (const [, targets] of Object.entries(GUARANTEE_TRANSITIONS)) {
      for (const target of targets) {
        expect(GUARANTEE_STATES).toContain(target);
      }
    }
  });

  it('Active can transition to ExpiredClean (happy path)', () => {
    expect(GUARANTEE_TRANSITIONS.Active).toContain('ExpiredClean');
  });

  it('Active can transition to Triggered (clawback path)', () => {
    expect(GUARANTEE_TRANSITIONS.Active).toContain('Triggered');
  });

  it('ExpiredClean is a terminal state', () => {
    expect(GUARANTEE_TRANSITIONS.ExpiredClean).toHaveLength(0);
  });

  it('Triggered is a terminal state', () => {
    expect(GUARANTEE_TRANSITIONS.Triggered).toHaveLength(0);
  });
});

describe('canTransitionGuarantee', () => {
  it('allows Active → ExpiredClean (clean expiry)', () => {
    expect(canTransitionGuarantee('Active', 'ExpiredClean')).toBe(true);
  });

  it('allows Active → Triggered (clawback)', () => {
    expect(canTransitionGuarantee('Active', 'Triggered')).toBe(true);
  });

  it('rejects ExpiredClean → Active (no backward transition)', () => {
    expect(canTransitionGuarantee('ExpiredClean', 'Active')).toBe(false);
  });

  it('rejects Triggered → Active (no backward transition)', () => {
    expect(canTransitionGuarantee('Triggered', 'Active')).toBe(false);
  });

  it('rejects ExpiredClean → Triggered (terminal state)', () => {
    expect(canTransitionGuarantee('ExpiredClean', 'Triggered')).toBe(false);
  });

  it('rejects Triggered → ExpiredClean (terminal state)', () => {
    expect(canTransitionGuarantee('Triggered', 'ExpiredClean')).toBe(false);
  });
});

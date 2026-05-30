/**
 * Unit tests for packages/core/placement-state.ts
 *
 * Verifies that all 12 PRD lifecycle states are present and that the
 * no-op transition table is structurally sound.
 *
 * No database required — pure in-memory enum assertions.
 *
 * Test plan (issue #23):
 *   Enum test: assert PLACEMENT_STATES.length == 12 (all PRD lifecycle states present)
 */

import { describe, it, expect } from 'vitest';
import {
  PLACEMENT_STATES,
  PLACEMENT_TRANSITIONS,
  canTransition,
  type PlacementState,
} from '../placement-state';

describe('PLACEMENT_STATES', () => {
  it('contains exactly 12 PRD lifecycle states', () => {
    expect(PLACEMENT_STATES.length).toBe(12);
  });

  it('contains all PRD happy-path states', () => {
    const happyPath: PlacementState[] = [
      'Created',
      'ContributorsAssigned',
      'PendingApproval',
      'Active',
      'Invoiced',
      'Collected',
      'GuaranteeActive',
      'GuaranteeExpired',
      'Closed',
    ];
    for (const state of happyPath) {
      expect(PLACEMENT_STATES).toContain(state);
    }
  });

  it('contains all PRD alternate-path states', () => {
    const alternatePath: PlacementState[] = ['Refunded', 'Disputed', 'ClawbackTriggered'];
    for (const state of alternatePath) {
      expect(PLACEMENT_STATES).toContain(state);
    }
  });

  it('has no duplicate state values', () => {
    const unique = new Set(PLACEMENT_STATES);
    expect(unique.size).toBe(PLACEMENT_STATES.length);
  });
});

describe('PLACEMENT_TRANSITIONS', () => {
  it('has an entry for every state', () => {
    for (const state of PLACEMENT_STATES) {
      expect(PLACEMENT_TRANSITIONS).toHaveProperty(state);
    }
  });

  it('all transition targets are valid states', () => {
    for (const [, targets] of Object.entries(PLACEMENT_TRANSITIONS)) {
      for (const target of targets) {
        expect(PLACEMENT_STATES).toContain(target);
      }
    }
  });
});

describe('canTransition', () => {
  it('allows Created → ContributorsAssigned', () => {
    expect(canTransition('Created', 'ContributorsAssigned')).toBe(true);
  });

  it('allows Active → Refunded (alternate path)', () => {
    expect(canTransition('Active', 'Refunded')).toBe(true);
  });

  it('allows GuaranteeActive → ClawbackTriggered (alternate path)', () => {
    expect(canTransition('GuaranteeActive', 'ClawbackTriggered')).toBe(true);
  });

  it('rejects Created → Closed (skipping states)', () => {
    expect(canTransition('Created', 'Closed')).toBe(false);
  });

  it('rejects Closed → Active (backward transition)', () => {
    expect(canTransition('Closed', 'Active')).toBe(false);
  });
});

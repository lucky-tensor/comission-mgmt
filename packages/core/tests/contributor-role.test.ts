/**
 * Unit tests for packages/core/contributor-role.ts
 *
 * Verifies that all 8 PRD contributor role values are present and that
 * the helper utilities are structurally correct.
 *
 * No database required — pure in-memory enum assertions.
 *
 * Test plan (issue #23):
 *   Enum test: assert ContributorRole.values.length == 8 (all PRD roles present)
 */

import { describe, it, expect } from 'vitest';
import {
  CONTRIBUTOR_ROLES,
  CONTRIBUTOR_ROLE_LABELS,
  isContributorRole,
  type ContributorRole,
} from '../contributor-role';

describe('CONTRIBUTOR_ROLES', () => {
  it('contains exactly 8 PRD role values', () => {
    expect(CONTRIBUTOR_ROLES.length).toBe(8);
  });

  it('contains all eight PRD-defined roles', () => {
    const expectedRoles: ContributorRole[] = [
      'ClientOriginator',
      'AccountOwner',
      'JobOwner',
      'CandidateSourcer',
      'CandidateOwner',
      'DeliveryCredit',
      'ManagerOverride',
      'ExternalPartner',
    ];
    for (const role of expectedRoles) {
      expect(CONTRIBUTOR_ROLES).toContain(role);
    }
  });

  it('has no duplicate role values', () => {
    const unique = new Set(CONTRIBUTOR_ROLES);
    expect(unique.size).toBe(CONTRIBUTOR_ROLES.length);
  });
});

describe('CONTRIBUTOR_ROLE_LABELS', () => {
  it('has a label for every role', () => {
    for (const role of CONTRIBUTOR_ROLES) {
      expect(CONTRIBUTOR_ROLE_LABELS).toHaveProperty(role);
      expect(typeof CONTRIBUTOR_ROLE_LABELS[role]).toBe('string');
      expect(CONTRIBUTOR_ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });

  it('has no extra labels beyond defined roles', () => {
    expect(Object.keys(CONTRIBUTOR_ROLE_LABELS).length).toBe(CONTRIBUTOR_ROLES.length);
  });
});

describe('isContributorRole', () => {
  it('returns true for valid roles', () => {
    for (const role of CONTRIBUTOR_ROLES) {
      expect(isContributorRole(role)).toBe(true);
    }
  });

  it('returns false for invalid role strings', () => {
    expect(isContributorRole('InvalidRole')).toBe(false);
    expect(isContributorRole('')).toBe(false);
    expect(isContributorRole('bd')).toBe(false);
    expect(isContributorRole('owner')).toBe(false);
  });
});

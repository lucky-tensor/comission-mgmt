/**
 * Contributor role enum — no-op stubs for the Placement and Attribution phase.
 *
 * ## Purpose (dev-scout)
 * This file defines the canonical eight contributor role values from PRD §5.2 so that
 * the contributors table, commission rule engine, and split-approval workflow all reference
 * a single authoritative source. No calculation or routing logic is implemented here.
 *
 * ## Canonical docs
 * - docs/prd.md §5.2 Contribution Assignment
 * - docs/architecture/phase-placement.md — scout decision record
 * - docs/architecture/decisions.md — contributors table ER schema
 *
 * ## PRD roles (verbatim, §5.2)
 * "client originator, account owner, job owner, candidate sourcer, candidate owner,
 *  delivery credit, manager override, external partner"
 *
 * ## Integration seams discovered during scout
 * 1. `role_code` in the contributors table (decisions.md ER) must map 1-to-1 to these values.
 *    Feature issues must migrate the column to use a Postgres CHECK constraint or enum
 *    constraining to these eight values (see phase-placement.md §Decision 2).
 * 2. Commission plan rules reference roles by code — the rule engine (separate issue) must
 *    import ContributorRole to validate plan config at load time.
 * 3. Manager Override and External Partner have distinct visibility scopes (PRD §5.10, §3)
 *    that the RBAC layer must enforce per role.
 */

// ---------------------------------------------------------------------------
// ContributorRole — all 8 PRD role values
// ---------------------------------------------------------------------------

/**
 * All valid contributor role codes as defined in PRD §5.2.
 */
export const CONTRIBUTOR_ROLES = [
  'ClientOriginator',
  'AccountOwner',
  'JobOwner',
  'CandidateSourcer',
  'CandidateOwner',
  'DeliveryCredit',
  'ManagerOverride',
  'ExternalPartner',
] as const;

/** Union type of all valid contributor role codes. */
export type ContributorRole = (typeof CONTRIBUTOR_ROLES)[number];

/**
 * Human-readable label for each contributor role, suitable for display in the UI.
 *
 * @stub — i18n/locale support is not yet implemented.
 */
export const CONTRIBUTOR_ROLE_LABELS: Record<ContributorRole, string> = {
  ClientOriginator: 'Client Originator',
  AccountOwner: 'Account Owner',
  JobOwner: 'Job Owner',
  CandidateSourcer: 'Candidate Sourcer',
  CandidateOwner: 'Candidate Owner',
  DeliveryCredit: 'Delivery Credit',
  ManagerOverride: 'Manager Override',
  ExternalPartner: 'External Partner',
};

/**
 * Returns true if the given string is a valid ContributorRole.
 */
export function isContributorRole(value: string): value is ContributorRole {
  return (CONTRIBUTOR_ROLES as readonly string[]).includes(value);
}

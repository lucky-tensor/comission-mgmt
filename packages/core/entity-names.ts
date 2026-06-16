/**
 * Entity display names — deterministic, human-readable labels for entities.
 *
 * The data model has no clients or candidates tables yet — both `client_entity_id`
 * and `candidate_id` are opaque surrogate UUIDs minted at placement-create time
 * (see the ATS-integration TODOs in apps/server/src/api/placements.ts). Until
 * real directories exist, surfaces still must not show raw UUIDs, so we derive
 * deterministic readable names from the ids: a fixed adjective+noun pair selected
 * by hashing the id, plus a short id suffix to keep it unique.
 *
 * Deterministic: the same id always yields the same name. Never empty.
 * Used across: executive profitability, placement ledger (#203, #247).
 */

// ---------------------------------------------------------------------------
// Shared naming pools
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  'Summit',
  'Atlas',
  'Beacon',
  'Cardinal',
  'Pioneer',
  'Meridian',
  'Vertex',
  'Harbor',
  'Keystone',
  'Northwind',
  'Granite',
  'Sterling',
  'Evergreen',
  'Lighthouse',
  'Ironwood',
  'Brightline',
];

const COMPANY_SUFFIXES = [
  'Partners',
  'Group',
  'Holdings',
  'Industries',
  'Labs',
  'Systems',
  'Ventures',
  'Solutions',
];

const PERSON_SUFFIXES = [
  'Andrews',
  'Bennett',
  'Chen',
  'Davis',
  'Edwards',
  'Franklin',
  'Garcia',
  'Harrison',
  'Jackson',
  'Kumar',
  'Lewis',
  'Martin',
  'Nelson',
  'Patterson',
  'Quinn',
  'Rodriguez',
];

// ---------------------------------------------------------------------------
// Internal hash function
// ---------------------------------------------------------------------------

/**
 * Deterministic hash over id characters (FNV-1a style).
 * Used to select adjectives and suffixes reproducibly.
 */
function hashId(id: string): number {
  if (!id) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Short slug from the id to make visually distinct hashes separable.
 */
function slugFromId(id: string): string {
  return id
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 4)
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stable, human-readable label for a client entity id.
 *
 * Format: "[Adjective] [Company Suffix] ([ID Slug])"
 * Example: "Summit Partners (AB12)"
 */
export function clientDisplayName(clientId: string): string {
  if (!clientId) return 'Unknown Client';
  const h = hashId(clientId);
  const adjective = ADJECTIVES[h % ADJECTIVES.length];
  const suffix = COMPANY_SUFFIXES[(h >>> 8) % COMPANY_SUFFIXES.length];
  const slug = slugFromId(clientId);
  return `${adjective} ${suffix} (${slug})`;
}

/**
 * Stable, human-readable label for a candidate entity id.
 *
 * Format: "[Adjective] [Person Suffix] ([ID Slug])"
 * Example: "Beacon Davis (AB12)"
 */
export function candidateDisplayName(candidateId: string): string {
  if (!candidateId) return 'Unknown Candidate';
  const h = hashId(candidateId);
  const adjective = ADJECTIVES[h % ADJECTIVES.length];
  const suffix = PERSON_SUFFIXES[(h >>> 8) % PERSON_SUFFIXES.length];
  const slug = slugFromId(candidateId);
  return `${adjective} ${suffix} (${slug})`;
}

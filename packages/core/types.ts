/**
 * Commission management domain entity types and core interfaces.
 *
 * These types define the commission-specific entity taxonomy used throughout
 * the application. The EntityType union drives encryption key derivation
 * (SENSITIVE_FIELDS in encryption.ts), audit log scoping, and RLS policies.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 */

/** Commission management entity types. */
export type EntityType =
  | 'user'
  | 'placement'
  | 'contributor'
  | 'commission'
  | 'invoice'
  | 'task';

export interface Entity {
  id: string;
  type: EntityType;
  properties: Record<string, unknown>;
  tenant_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

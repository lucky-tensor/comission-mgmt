/**
 * Arbitration result data contracts.
 *
 * DORMANT_BY_DESIGN
 * depends_on: issue #186
 * reason: The dispute arbitration result write-path is being scaffolded as a
 * shared schema and type seam before the live task/result flow is implemented.
 * reviewed_at: 2026-06-09
 *
 * Canonical docs: docs/arbitration-simulation.md, docs/architecture.md
 */

export interface ArbitrationRecommendation {
  recommendation: string;
  reasoning: string;
  edge_cases: string[];
  payout_adjustment: number;
}

export interface ArbitrationResultRow extends ArbitrationRecommendation {
  id: string;
  org_id: string;
  dispute_id: string;
  correlation_id: string;
  created_at: Date;
}

export interface CreateArbitrationResultInput extends ArbitrationRecommendation {
  org_id: string;
  dispute_id: string;
  correlation_id: string;
}

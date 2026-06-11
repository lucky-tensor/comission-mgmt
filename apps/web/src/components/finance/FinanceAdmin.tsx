/**
 * Invoice & Collection Tracking — Finance Home section.
 *
 * Shows a placement picker (by client/candidate/role, not a UUID — #203) and
 * the invoice/collection tracking view for the selected placement.
 *
 * Exports:
 *   - InvoiceCollectionSection — the picker + tracking view, no page chrome;
 *     composed into FinancePage as the "Invoice & Collection Tracking" section.
 *   - FinanceAdmin — thin backwards-compatible wrapper around the section.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.5; docs/ux-review.md §1
 * Issue: feat: Finance Admin UI — invoice and collection tracking (#103);
 *        feat: webapp — UX overhaul: entity pickers + page composition (#203)
 */

import { useState } from 'react';
import { apiGet } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { InvoiceCollection } from './InvoiceCollection';
import { EntityPicker } from '../EntityPicker';

interface PlacementListItem {
  id: string;
  position_title: string | null;
  candidate_name: string | null;
  client_name: string | null;
}

function placementLabel(p: PlacementListItem): string {
  const parts: string[] = [];
  if (p.position_title) parts.push(p.position_title);
  if (p.candidate_name) parts.push(p.candidate_name);
  if (p.client_name) parts.push(`@ ${p.client_name}`);
  return parts.length > 0 ? parts.join(' — ') : p.id;
}

export function InvoiceCollectionSection() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // GET /placements returns a bare array of placements.
  const placements = useAsync<PlacementListItem[]>(
    () => apiGet<PlacementListItem[]>('/placements'),
    [],
  );

  return (
    <div data-testid="finance-admin">
      <EntityPicker
        name="placement"
        label="Placement"
        state={placements}
        value={selectedId}
        onChange={setSelectedId}
        toOption={(p) => ({ id: p.id, label: placementLabel(p) })}
        placeholder="Select a placement…"
        emptyMessage="No placements found."
      />

      {selectedId ? (
        <div style={{ marginTop: '1.25rem' }}>
          <InvoiceCollection placementId={selectedId} />
        </div>
      ) : (
        <div
          data-testid="placement-prompt"
          style={{
            fontSize: '0.875rem',
            color: '#9ca3af',
            textAlign: 'center',
            padding: '2rem',
            fontStyle: 'italic',
          }}
        >
          Select a placement above to view invoice and collection status.
        </div>
      )}
    </div>
  );
}

/** Backwards-compatible alias — the section now lives inside FinancePage. */
export function FinanceAdmin() {
  return <InvoiceCollectionSection />;
}

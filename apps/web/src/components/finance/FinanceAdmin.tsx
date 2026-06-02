/**
 * FinanceAdmin — Finance Admin home surface.
 *
 * Shows a placement picker and the invoice/collection tracking view for the
 * selected placement. Replaces the placeholder FinanceHome stub.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin), §5.5
 * Issue: feat: Finance Admin UI — invoice and collection tracking (per billing phase) (#103)
 */

import { useState } from 'react';
import { apiGet } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { InvoiceCollection } from './InvoiceCollection';

interface PlacementListItem {
  id: string;
  position_title: string | null;
  candidate_name: string | null;
  client_name: string | null;
}

const containerStyle: React.CSSProperties = {
  minHeight: 'calc(100vh - 3.25rem)',
  background: '#f9fafb',
  fontFamily: 'system-ui, sans-serif',
  padding: '2rem 1rem',
};

const innerStyle: React.CSSProperties = {
  maxWidth: '880px',
  margin: '0 auto',
};

const headingStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 700,
  color: '#111827',
  margin: 0,
};

const subStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
  margin: '0.25rem 0 2rem',
};

const selectWrapStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '0.75rem',
  padding: '1.25rem',
  marginBottom: '1.5rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#374151',
  marginBottom: '0.5rem',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  background: '#ffffff',
};

function placementLabel(p: PlacementListItem): string {
  const parts: string[] = [];
  if (p.position_title) parts.push(p.position_title);
  if (p.candidate_name) parts.push(p.candidate_name);
  if (p.client_name) parts.push(`@ ${p.client_name}`);
  return parts.length > 0 ? parts.join(' — ') : p.id;
}

export function FinanceAdmin() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const placements = useAsync<PlacementListItem[]>(
    () => apiGet<{ placements: PlacementListItem[] }>('/placements').then((r) => r.placements),
    [],
  );

  return (
    <div data-testid="finance-admin" style={containerStyle}>
      <div style={innerStyle}>
        <header>
          <h1 style={headingStyle}>Finance Admin</h1>
          <p style={subStyle}>Invoice and collection tracking per placement and billing phase.</p>
        </header>

        <div style={selectWrapStyle}>
          <label htmlFor="placement-select" style={labelStyle}>
            Select placement
          </label>
          {placements.loading ? (
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Loading placements…</div>
          ) : placements.error ? (
            <div
              role="alert"
              style={{ fontSize: '0.875rem', color: '#b91c1c' }}
              data-testid="placements-error"
            >
              {placements.error}
            </div>
          ) : !placements.data || placements.data.length === 0 ? (
            <div
              data-testid="no-placements"
              style={{ fontSize: '0.875rem', color: '#6b7280', fontStyle: 'italic' }}
            >
              No placements found.
            </div>
          ) : (
            <select
              id="placement-select"
              data-testid="placement-select"
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              style={selectStyle}
            >
              <option value="">— Choose a placement —</option>
              {placements.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {placementLabel(p)}
                </option>
              ))}
            </select>
          )}
        </div>

        {selectedId ? (
          <InvoiceCollection placementId={selectedId} />
        ) : (
          <div
            data-testid="placement-prompt"
            style={{
              fontSize: '0.875rem',
              color: '#9ca3af',
              textAlign: 'center',
              padding: '3rem',
              fontStyle: 'italic',
            }}
          >
            Select a placement above to view invoice and collection status.
          </div>
        )}
      </div>
    </div>
  );
}

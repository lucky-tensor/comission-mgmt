/**
 * FinanceAdminSurface — top-level Finance Admin home page.
 *
 * Landing surface for the FinanceAdmin role. Provides a placement-ID input
 * to load the adjustment ledger (clawback/holdback entries) for any placement.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin)
 * Issue: feat: Finance Admin UI — adjustment ledger (clawback/holdback, append-only) (#104)
 */

import { useState } from 'react';
import { AdjustmentLedger } from './AdjustmentLedger';

const pageStyle: React.CSSProperties = {
  minHeight: 'calc(100vh - 3.25rem)',
  background: '#f9fafb',
  padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
};

const headerStyle: React.CSSProperties = {
  fontSize: '1.375rem',
  fontWeight: 700,
  color: '#111827',
  marginTop: 0,
  marginBottom: '0.5rem',
};

const subheadStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
  marginBottom: '1.5rem',
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  alignItems: 'flex-end',
  marginBottom: '2rem',
  flexWrap: 'wrap',
};

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  minWidth: '22rem',
};

const buttonStyle: React.CSSProperties = {
  padding: '0.5rem 1.25rem',
  background: '#111827',
  color: '#fff',
  border: 'none',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
};

export function FinanceAdminSurface() {
  const [inputValue, setInputValue] = useState('');
  const [placementId, setPlacementId] = useState<string | null>(null);

  function handleLoadLedger(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) {
      setPlacementId(trimmed);
    }
  }

  return (
    <div style={pageStyle} data-testid="finance-home">
      <h1 style={headerStyle}>Finance Admin</h1>
      <p style={subheadStyle}>
        Enter a placement UUID to view its adjustment ledger and post clawback/holdback adjustments.
      </p>

      <form style={formStyle} onSubmit={handleLoadLedger} data-testid="placement-id-form">
        <input
          type="text"
          data-testid="placement-id-input"
          style={inputStyle}
          placeholder="Placement UUID…"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
        <button type="submit" data-testid="placement-id-submit" style={buttonStyle}>
          Load ledger
        </button>
      </form>

      {placementId && <AdjustmentLedger placementId={placementId} />}
    </div>
  );
}

/**
 * FinanceAdminSurface — top-level Finance Admin home page.
 *
 * Landing surface for the FinanceAdmin role. Provides finance workflow inputs
 * for adjustment ledger review and payroll-ready export generation.
 *
 * Canonical docs: docs/prd.md §4 (Finance Admin)
 * Issues:
 *   - feat: Finance Admin UI — adjustment ledger (clawback/holdback, append-only) (#104)
 *   - feat: Finance Admin UI — payroll-ready export (#105)
 */

import { useState } from 'react';
import { AdjustmentLedger } from './AdjustmentLedger';
import { PayrollExport } from './PayrollExport';

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

const sectionStyle: React.CSSProperties = {
  marginBottom: '2rem',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  color: '#111827',
  margin: '0 0 0.75rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  minWidth: '22rem',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  minWidth: '12rem',
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
  const [runInputValue, setRunInputValue] = useState('');
  const [runStatusInput, setRunStatusInput] = useState('Approved');
  const [payrollRun, setPayrollRun] = useState<{ id: string; status: string } | null>(null);

  function handleLoadLedger(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) {
      setPlacementId(trimmed);
    }
  }

  function handleLoadPayrollRun(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = runInputValue.trim();
    if (trimmed) {
      setPayrollRun({ id: trimmed, status: runStatusInput });
    }
  }

  return (
    <div style={pageStyle} data-testid="finance-home">
      <h1 style={headerStyle}>Finance Admin</h1>
      <p style={subheadStyle}>
        Review adjustment ledgers and generate payroll-ready exports for approved commission runs.
      </p>

      <section style={sectionStyle} aria-labelledby="adjustment-ledger-heading">
        <h2 id="adjustment-ledger-heading" style={sectionHeadingStyle}>
          Adjustment ledger
        </h2>
        <form style={formStyle} onSubmit={handleLoadLedger} data-testid="placement-id-form">
          <input
            type="text"
            data-testid="placement-id-input"
            style={inputStyle}
            placeholder="Placement UUID..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button type="submit" data-testid="placement-id-submit" style={buttonStyle}>
            Load ledger
          </button>
        </form>

        {placementId && <AdjustmentLedger placementId={placementId} />}
      </section>

      <section style={sectionStyle} aria-labelledby="payroll-export-heading">
        <h2 id="payroll-export-heading" style={sectionHeadingStyle}>
          Payroll export
        </h2>
        <form style={formStyle} onSubmit={handleLoadPayrollRun} data-testid="payroll-run-form">
          <input
            type="text"
            data-testid="run-id-input"
            style={inputStyle}
            placeholder="Commission run UUID..."
            value={runInputValue}
            onChange={(e) => setRunInputValue(e.target.value)}
          />
          <select
            data-testid="run-status-select"
            style={selectStyle}
            value={runStatusInput}
            onChange={(e) => setRunStatusInput(e.target.value)}
          >
            <option value="Approved">Approved</option>
            <option value="Draft">Draft</option>
            <option value="Pending">Pending</option>
            <option value="Finalized">Finalized</option>
          </select>
          <button type="submit" data-testid="load-run-button" style={buttonStyle}>
            Load run
          </button>
        </form>

        {payrollRun && <PayrollExport runId={payrollRun.id} runStatus={payrollRun.status} />}
      </section>
    </div>
  );
}
